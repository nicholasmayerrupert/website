// Arm each timeout from a message task so repeated worker turns do not inherit
// the browser's nested-timer minimum delay. The absolute due time includes the
// message handoff; each callback still yields to the worker event loop.
export function createTurnTimer(host = globalThis) {
  const channel = new host.MessageChannel();
  let generation = 0;
  let timer = null;
  let pending = null;
  let closed = false;

  const cancel = () => {
    generation++;
    if (timer !== null) host.clearTimeout(timer);
    timer = null;
    pending = null;
  };
  channel.port1.onmessage = ({ data }) => {
    if (data !== generation || !pending) return;
    const fire = () => {
      if (data !== generation || !pending) return;
      const callback = pending.callback;
      pending = null;
      timer = null;
      callback();
    };
    const remaining = pending.due - host.performance.now();
    if (remaining > 0) timer = host.setTimeout(fire, remaining);
    else fire();
  };
  return {
    schedule(callback, delay) {
      cancel();
      if (closed) return;
      pending = { callback, due: host.performance.now() + Math.max(0, delay) };
      channel.port2.postMessage(generation);
    },
    cancel,
    close() {
      cancel();
      closed = true;
      channel.port1.close();
      channel.port2.close();
    },
  };
}
