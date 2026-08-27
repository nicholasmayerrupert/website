import { decodeReplayCapsule, encodeReplayCapsule } from './replayCapsule.js';
import { createReplayTimeline } from './replayTimeline.js';

export async function materializeReplayFallback(capture, encode = encodeReplayCapsule) {
  if (!capture?.fallback)
    throw new Error('No completed authority turn is available to capture yet.');
  return {
    capsule: capture.fallback,
    text: await encode(capture.fallback),
  };
}

const buttonStyle = [
  'border:2px solid #080a0c',
  'padding:8px 11px',
  'background:#3a424b',
  'color:#f3f4f6',
  'font:800 11px/1 system-ui,sans-serif',
  'letter-spacing:.06em',
  'text-transform:uppercase',
  'cursor:pointer',
  'box-shadow:inset 0 0 0 1px #69737e,3px 3px 0 #080a0c',
].join(';');

/** @param {import('./runtimeContext.js').SandRuntimeContext} ctx */
export function createReplayPanel(ctx) {
  const overlay = document.createElement('section');
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Authority logs');
  overlay.style.cssText = [
    'position:absolute', 'inset:12px', 'z-index:100', 'display:none',
    'place-items:center', 'background:rgba(7,9,12,.82)', 'padding:12px',
    'pointer-events:auto', 'touch-action:manipulation',
  ].join(';');

  const panel = document.createElement('div');
  panel.style.cssText = [
    'width:min(760px,100%)', 'max-height:calc(100% - 8px)', 'display:grid',
    'grid-template-rows:auto auto minmax(120px,1fr) auto', 'gap:10px',
    'padding:14px', 'background:#20262c', 'border:3px solid #080a0c',
    'box-shadow:inset 0 0 0 1px #59636c,7px 7px 0 rgba(0,0,0,.5)',
    'color:#f3f4f6', 'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'LOGS';
  title.style.cssText = 'color:#f0d465;font:900 13px/1 system-ui,sans-serif;letter-spacing:.16em';
  const status = document.createElement('div');
  status.textContent = 'Collecting the authority log…';
  status.style.cssText = 'min-height:18px;color:#cbd2d9';
  const textarea = document.createElement('textarea');
  textarea.spellcheck = false;
  textarea.setAttribute('aria-label', 'Replay capsule text');
  textarea.style.cssText = [
    'box-sizing:border-box', 'width:100%', 'height:100%', 'min-height:120px',
    'resize:none', 'border:2px solid #080a0c', 'outline:none', 'padding:10px',
    'background:#101418', 'color:#dce8d8', 'font:10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
    'user-select:text', '-webkit-user-select:text',
  ].join(';');

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px';
  const makeButton = (label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = buttonStyle;
    return button;
  };
  const copy = makeButton('Copy');
  const replay = makeButton('Run replay');
  const inspect = makeButton('Inspect paused');
  const close = makeButton('Resume & close');
  replay.style.background = '#a37c28';
  inspect.style.background = '#315b5d';
  actions.append(copy, replay, inspect, close);
  panel.append(title, status, textarea, actions);
  overlay.appendChild(panel);
  ctx.container.appendChild(overlay);

  const timeline = createReplayTimeline(ctx, {
    onResumed(turn) {
      status.style.color = '#b9e6b1';
      status.textContent = `Live simulation resumed from replay turn ${turn.toLocaleString()}.`;
    },
  });

  let openGeneration = 0;
  let busy = false;
  const currentView = () => {
    const engine = ctx.engine;
    const cam = engine?.getCam();
    return {
      cameraWorldX: engine && cam ? engine.getWorldOffsetX() + cam.x : 0,
      cameraWorldY: engine && cam ? engine.getWorldOffsetY() + cam.y : 0,
      viewCols: ctx.viewCols,
      viewRows: ctx.viewRows,
      zoom: ctx.zoom,
    };
  };
  const setBusy = (on) => {
    busy = on;
    overlay.setAttribute('aria-busy', String(on));
    copy.disabled = on;
    replay.disabled = on;
  };
  const showError = (error) => {
    status.textContent = error?.message || String(error);
    status.style.color = '#ff9a8f';
  };
  const fallbackStatus = (capsule) => {
    const journal = capsule.final?.diagnostics?.journal || {};
    const marker = journal.progress;
    const progress = marker
      ? ` Last authority marker: turn ${marker.turns.toLocaleString()}, ${marker.phase}, world tick ${marker.worldTick.toLocaleString()}, ACK ${marker.awaitingAck ? 'pending' : 'clear'}.`
      : '';
    if (journal.truncated || journal.discontinuous) {
      const reason = journal.truncated ? 'hit its size limit' : 'became discontinuous';
      return `The independent capture ${reason}; its exact ${capsule.turns.toLocaleString()}-turn prefix is copyable but incomplete.${progress}`;
    }
    return `${capsule.turns.toLocaleString()} accepted authority turns and ${capsule.events.length.toLocaleString()} events are copyable now.${progress} Waiting for the authority's final-state export…`;
  };
  const setVisible = (visible) => {
    overlay.hidden = !visible;
    overlay.style.display = visible ? 'grid' : 'none';
  };
  const open = async () => {
    if (timeline.visible) return;
    if (!overlay.hidden || busy) return;
    setVisible(true);
    status.style.color = '#cbd2d9';
    status.textContent = 'Freezing this tick and collecting the authority log…';
    textarea.value = '';
    setBusy(true);
    const generation = ++openGeneration;
    try {
      if (!ctx.worldWorker) throw new Error('The local simulation is not ready yet.');
      const capture = ctx.worldWorker.captureReplay(currentView());
      // Install both continuations before compression yields. A worker failure
      // or a superseding capture must never turn into an unhandled rejection.
      const authority = Promise.resolve(capture.verified);
      const authorityUpdate = authority
        .then(async (capsule) => ({
          ok: true,
          capsule,
          text: await encodeReplayCapsule(capsule),
        }))
        .catch((error) => ({ ok: false, error }));
      const fallback = await materializeReplayFallback(capture);
      if (generation !== openGeneration) return;
      textarea.value = fallback.text;
      status.style.color = '#ffca78';
      status.textContent = fallbackStatus(fallback.capsule);
      setBusy(false);
      replay.disabled = true;
      textarea.focus({ preventScroll: true });
      textarea.select();
      void authorityUpdate.then((result) => {
        if (generation !== openGeneration) return;
        if (!result.ok) {
          replay.disabled = false;
          status.style.color = '#ffca78';
          status.textContent = `The independent capture remains copyable; the authority did not provide a final-state export: ${result.error?.message || String(result.error)}`;
          return;
        }
        const { capsule, text } = result;
        replay.disabled = false;
        const untouched = textarea.value === fallback.text;
        if (untouched) textarea.value = text;
        status.style.color = '#b9e6b1';
        status.textContent = `${capsule.turns.toLocaleString()} authority turns and ${capsule.events.length.toLocaleString()} events captured with the authority's final state.${untouched ? ' Paste another capsule here to replay it.' : ' The text was edited, so it was not replaced.'}`;
      });
    } catch (error) {
      if (generation === openGeneration) showError(error);
      if (generation === openGeneration) setBusy(false);
    }
  };
  const hide = (resume) => {
    openGeneration++;
    setBusy(false);
    setVisible(false);
    if (resume) ctx.worldWorker?.config({ paused: false });
    ctx.container.focus({ preventScroll: true });
  };
  const runCapsule = async (capsule) => {
    status.textContent = `Preparing ${capsule.turns.toLocaleString()} replay turns…`;
    setVisible(false);
    ctx.container.focus({ preventScroll: true });
    await ctx.worldWorker.startBufferedReplay(capsule);
    timeline.show();
    status.style.color = '#b9e6b1';
    status.textContent = 'Buffered replay opened.';
  };
  const playFromText = async () => {
    if (busy) return;
    openGeneration++;
    setBusy(true);
    status.style.color = '#cbd2d9';
    status.textContent = 'Decoding replay capsule…';
    let panelHiddenForPlayback = false;
    try {
      const capsule = await decodeReplayCapsule(textarea.value);
      panelHiddenForPlayback = true;
      await runCapsule(capsule);
    } catch (error) {
      if (panelHiddenForPlayback) setVisible(true);
      showError(error);
    } finally {
      setBusy(false);
    }
  };
  const startReplay = async () => {
    if (timeline.visible) return;
    if (!overlay.hidden) {
      if (textarea.value.trim()) await playFromText();
      return;
    }
    if (busy) return;
    const generation = ++openGeneration;
    setBusy(true);
    status.style.color = '#cbd2d9';
    status.textContent = 'Capturing this session for replay…';
    try {
      if (!ctx.worldWorker) throw new Error('The local simulation is not ready yet.');
      const capture = ctx.worldWorker.captureReplay(currentView());
      let capsule;
      try {
        capsule = await capture.verified;
      } catch {
        capsule = (await materializeReplayFallback(capture)).capsule;
      }
      if (generation !== openGeneration) return;
      await runCapsule(capsule);
    } catch (error) {
      if (generation === openGeneration) {
        setVisible(true);
        showError(error);
      }
    } finally {
      if (generation === openGeneration) setBusy(false);
    }
  };

  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(textarea.value);
      status.style.color = '#b9e6b1';
      status.textContent = 'Replay capsule copied.';
    } catch {
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      status.textContent = 'Replay capsule selected and copied.';
    }
  });
  replay.addEventListener('click', () => { void playFromText(); });
  inspect.addEventListener('click', () => hide(false));
  close.addEventListener('click', () => hide(true));
  overlay.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (event.key === 'Escape' || key === 'l') {
      event.preventDefault();
      event.stopPropagation();
      hide(true);
      return;
    }
    if (key === 'r' && event.target !== textarea) {
      event.preventDefault();
      event.stopPropagation();
      void startReplay();
    }
  });

  return {
    open,
    startReplay,
    togglePlayback: () => timeline.togglePlayback(),
    stepPlayback: (delta) => timeline.stepPlayback(delta),
    destroy() {
      openGeneration++;
      timeline.destroy();
      overlay.remove();
    },
  };
}
