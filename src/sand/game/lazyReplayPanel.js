// Capture runs with the authority; only the replay interface loads on demand.
export function createLazyReplayPanel(ctx, options) {
  let panel = null;
  let pending = null;
  let destroyed = false;
  const load = () => {
    if (!pending) pending = import('./replayPanel.js').then(({ createReplayPanel }) => {
      if (!destroyed) panel = createReplayPanel(ctx, options);
      return panel;
    }).catch(error => { pending = null; throw error; });
    return pending;
  };
  const invoke = method => async () => {
    try { return await (await load())?.[method](); }
    catch (error) { console.error('The replay interface could not load. Try opening it again.', error); }
  };
  return {
    open: invoke('open'),
    startReplay: invoke('startReplay'),
    togglePlayback: () => panel?.togglePlayback(),
    stepPlayback: delta => panel?.stepPlayback(delta),
    destroy() { destroyed = true; panel?.destroy(); panel = null; },
  };
}
