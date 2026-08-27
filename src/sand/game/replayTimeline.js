import { SIM_HZ } from '../timing/fixedRateClock.js';

const controlStyle = [
  'border:1px solid rgba(255,255,255,.24)',
  'border-radius:4px',
  'padding:7px 10px',
  'background:rgba(12,16,19,.92)',
  'color:#f3f4f6',
  'font:800 11px/1 system-ui,sans-serif',
  'letter-spacing:.04em',
  'cursor:pointer',
].join(';');

const formatTime = (turn) => {
  const seconds = Math.max(0, Math.floor((turn | 0) / SIM_HZ));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
};

/** @param {import('./runtimeContext.js').SandRuntimeContext} ctx */
export function createReplayTimeline(ctx, { onResumed } = {}) {
  const root = document.createElement('section');
  root.hidden = true;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Replay timeline');
  root.style.cssText = [
    'position:absolute', 'left:10px', 'right:10px', 'bottom:10px', 'z-index:101',
    'display:none', 'grid-template-columns:minmax(0,1fr) auto auto',
    'grid-template-rows:auto auto', 'align-items:center', 'column-gap:9px',
    'row-gap:8px', 'padding:10px 11px',
    'background:rgba(8,11,14,.82)', 'border:1px solid rgba(255,255,255,.2)',
    'border-radius:6px', 'box-shadow:0 4px 20px rgba(0,0,0,.45)',
    'backdrop-filter:blur(5px)', 'color:#f3f4f6',
    'font:11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace',
    'pointer-events:auto', 'touch-action:manipulation',
  ].join(';');

  const controls = document.createElement('div');
  controls.style.cssText = [
    'grid-column:1/-1', 'display:grid',
    'grid-template-columns:auto auto minmax(0,1fr) auto',
    'align-items:center', 'gap:9px', 'min-width:0',
  ].join(';');

  const play = document.createElement('button');
  play.type = 'button';
  play.style.cssText = `${controlStyle};width:42px;min-width:42px;padding-inline:0;text-align:center`;
  play.setAttribute('aria-label', 'Pause replay');

  const current = document.createElement('span');
  current.style.cssText = 'min-width:38px;text-align:right;color:#fff;font-variant-numeric:tabular-nums';

  const track = document.createElement('div');
  track.style.cssText = [
    'position:relative', 'height:22px', 'min-width:0', 'display:flex',
    'align-items:center', 'cursor:pointer', 'isolation:isolate',
  ].join(';');
  const rail = document.createElement('div');
  rail.style.cssText = [
    'position:absolute', 'left:0', 'right:0', 'top:9px', 'height:4px',
    'background:rgba(255,255,255,.16)', 'border-radius:999px', 'overflow:hidden',
  ].join(';');
  const cached = document.createElement('div');
  cached.setAttribute('aria-label', 'Cached replay ranges');
  cached.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  const watched = document.createElement('div');
  watched.style.cssText = 'position:absolute;left:0;bottom:0;height:1px;width:0;background:#e5b94d;pointer-events:none';
  rail.append(cached, watched);
  const catchup = document.createElement('div');
  catchup.style.cssText = [
    'position:absolute', 'left:0', 'top:7px', 'width:4px', 'height:8px',
    'border-radius:2px', 'background:#fff', 'transform:translateX(-2px)',
    'box-shadow:0 0 5px rgba(255,255,255,.8)', 'pointer-events:none',
    'display:none', 'z-index:2',
  ].join(';');
  const thumb = document.createElement('div');
  thumb.style.cssText = [
    'position:absolute', 'left:0', 'top:5px', 'width:12px', 'height:12px',
    'border-radius:50%', 'background:#f0c75b', 'box-shadow:0 0 0 2px rgba(8,11,14,.8)',
    'transform:translateX(-6px)', 'pointer-events:none', 'z-index:2',
  ].join(';');
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = '1';
  range.step = '1';
  range.value = '0';
  range.setAttribute('aria-label', 'Replay position');
  range.style.cssText = [
    'position:absolute', 'inset:0', 'width:100%', 'height:100%', 'margin:0',
    'opacity:.001', 'cursor:pointer', 'z-index:3',
  ].join(';');
  track.append(rail, catchup, thumb, range);

  const total = document.createElement('span');
  total.style.cssText = 'min-width:38px;color:#cbd2d9;font-variant-numeric:tabular-nums';
  const resume = document.createElement('button');
  resume.type = 'button';
  resume.textContent = 'Resume here';
  resume.style.cssText = `${controlStyle};grid-column:3;grid-row:2;background:rgba(145,103,28,.94);border-color:#d9b95e;white-space:nowrap`;

  const status = document.createElement('div');
  status.setAttribute('aria-live', 'polite');
  status.style.cssText = [
    'grid-column:1', 'grid-row:2', 'min-width:0', 'min-height:13px', 'color:#cbd2d9',
    'font-size:10px', 'text-align:left', 'pointer-events:none',
    'overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap',
  ].join(';');
  const ticks = document.createElement('span');
  ticks.setAttribute('aria-label', 'Replay tick');
  ticks.style.cssText = [
    'grid-column:2', 'grid-row:2', 'color:#fff', 'font-size:10px',
    'font-variant-numeric:tabular-nums', 'text-align:right', 'white-space:nowrap',
  ].join(';');
  controls.append(play, current, track, total);
  root.append(controls, status, ticks, resume);
  ctx.container.appendChild(root);

  let raf = 0;
  let scrubRaf = 0;
  let dragging = false;
  let dragWasPlaying = false;
  let previewTurn = 0;
  let keyboardTurn = null;
  let resuming = false;
  let cachedSignature = '';

  const drawCachedRanges = (ranges, turns) => {
    const signature = `${turns}:${ranges.map((range) => range.join('-')).join(',')}`;
    if (signature === cachedSignature) return;
    cachedSignature = signature;
    cached.replaceChildren(...ranges.map(([rawStart, rawEnd]) => {
      const start = Math.max(0, Math.min(turns, rawStart | 0));
      const end = Math.max(start, Math.min(turns, rawEnd | 0));
      const span = document.createElement('div');
      span.style.cssText = [
        'position:absolute', 'top:0', 'bottom:0',
        `left:${start / turns * 100}%`,
        `width:${Math.max(1 / turns * 100, (end - start + 1) / turns * 100)}%`,
        'background:rgba(255,255,255,.42)',
      ].join(';');
      return span;
    }));
  };

  const draw = () => {
    if (root.hidden) return;
    const state = ctx.worldWorker?.state || {};
    const turns = Math.max(1, state.replayTurns | 0);
    const presentedTurn = Math.max(0, state.replayTurn | 0);
    const seekTarget = Number.isInteger(state.replaySeekTarget)
      ? Math.max(0, Math.min(turns, state.replaySeekTarget | 0)) : null;
    const turn = dragging ? previewTurn : (seekTarget ?? presentedTurn);
    const bufferedTurn = Math.max(0, Math.min(turns, state.replayBufferedTurn | 0));
    const buildTurn = Math.max(0, Math.min(turns, state.replayBuildTurn | 0));
    const position = Math.max(0, Math.min(1, turn / turns));
    range.max = String(turns);
    if (!dragging) range.value = String(turn);
    watched.style.width = `${Math.max(0, Math.min(1, presentedTurn / turns)) * 100}%`;
    drawCachedRanges(state.replayCachedRanges || [], turns);
    thumb.style.left = `${position * 100}%`;
    const catchingUp = seekTarget !== null && presentedTurn !== seekTarget;
    const catchupTurn = state.replayBuffering ? buildTurn : presentedTurn;
    catchup.style.display = catchingUp ? 'block' : 'none';
    catchup.style.left = `${Math.max(0, Math.min(1, catchupTurn / turns)) * 100}%`;
    current.textContent = formatTime(turn);
    total.textContent = formatTime(turns);
    ticks.textContent = catchingUp
      ? `Tick ${catchupTurn.toLocaleString()} -> ${seekTarget.toLocaleString()} / ${turns.toLocaleString()}`
      : `Tick ${turn.toLocaleString()} / ${turns.toLocaleString()}`;
    if (keyboardTurn === state.replayTurn) keyboardTurn = null;
    const paused = !!state.replayPaused;
    play.textContent = paused ? '▶' : 'Ⅱ';
    play.setAttribute('aria-label', paused ? 'Play replay' : 'Pause replay');
    resume.disabled = resuming || !!state.replayBuffering;
    if (!resuming) {
      if (state.replayBufferError)
        status.textContent = state.replayBufferError;
      else if (state.replayBuffering && seekTarget !== null)
        status.textContent = `Catching up ${buildTurn.toLocaleString()} / ${seekTarget.toLocaleString()} as fast as possible...`;
      else if (state.replayBuffering)
        status.textContent = `Processing ${formatTime(bufferedTurn)} / ${formatTime(turns)}...`;
      else if (state.replayBufferLimitReached)
        status.textContent = 'Browser replay storage is full; uncached gaps require deterministic reconstruction.';
      else if (state.replayBufferComplete)
        status.textContent = state.replayMatched === false
          ? 'Replay processing completed with a verification difference.'
          : 'Replay fully processed; highlighted ranges are cached.';
      else
        status.textContent = `Processed through ${formatTime(bufferedTurn)}; highlighted ranges are cached.`;
      status.title = status.textContent;
    }
    raf = requestAnimationFrame(draw);
  };

  const togglePlayback = () => {
    if (root.hidden || resuming) return false;
    keyboardTurn = null;
    const paused = !!ctx.worldWorker?.state?.replayPaused;
    return ctx.worldWorker?.pauseBufferedReplay(!paused) ?? false;
  };
  const stepPlayback = (delta) => {
    if (root.hidden || resuming || !delta) return false;
    const state = ctx.worldWorker?.state || {};
    const turns = Math.max(0, state.replayTurns | 0);
    if (keyboardTurn === null) keyboardTurn = Math.max(0, state.replayTurn | 0);
    keyboardTurn = Math.max(0, Math.min(turns, keyboardTurn + Math.sign(delta)));
    ctx.worldWorker?.pauseBufferedReplay(true);
    return ctx.worldWorker?.seekBufferedReplay(keyboardTurn, { playAfter: false }) ?? false;
  };
  play.addEventListener('click', togglePlayback);
  range.addEventListener('pointerdown', () => {
    keyboardTurn = null;
    dragging = true;
    dragWasPlaying = !ctx.worldWorker?.state?.replayPaused;
    previewTurn = Number(range.value) | 0;
    ctx.worldWorker?.pauseBufferedReplay(true);
  });
  const requestLiveSeek = () => {
    if (scrubRaf) return;
    scrubRaf = requestAnimationFrame(() => {
      scrubRaf = 0;
      if (dragging)
        ctx.worldWorker?.seekBufferedReplay(previewTurn, { playAfter: false });
    });
  };
  range.addEventListener('input', () => {
    keyboardTurn = null;
    if (!dragging) {
      dragWasPlaying = !ctx.worldWorker?.state?.replayPaused;
      ctx.worldWorker?.pauseBufferedReplay(true);
    }
    dragging = true;
    previewTurn = Number(range.value) | 0;
    requestLiveSeek();
  });
  const commitSeek = () => {
    if (!dragging) return;
    cancelAnimationFrame(scrubRaf);
    scrubRaf = 0;
    dragging = false;
    ctx.worldWorker?.seekBufferedReplay(previewTurn, { playAfter: dragWasPlaying });
  };
  range.addEventListener('change', commitSeek);
  range.addEventListener('pointerup', commitSeek);
  range.addEventListener('pointercancel', commitSeek);
  resume.addEventListener('click', async () => {
    if (resuming) return;
    resuming = true;
    resume.disabled = true;
    ctx.worldWorker?.pauseBufferedReplay(true);
    const turn = Math.max(0, ctx.worldWorker?.state?.replayTurn | 0);
    status.textContent = status.title = `Preparing turn ${turn.toLocaleString()} for live play…`;
    try {
      await ctx.worldWorker.resumeBufferedReplay(turn, (at, target) => {
        status.textContent = status.title =
          `Rebuilding authority ${at.toLocaleString()} / ${target.toLocaleString()}…`;
      });
      hide();
      ctx.container.focus({ preventScroll: true });
      onResumed?.(turn);
    } catch (error) {
      status.textContent = status.title = error?.message || String(error);
      status.style.color = '#ff9a8f';
      resuming = false;
      resume.disabled = false;
    }
  });

  const show = () => {
    root.hidden = false;
    root.style.display = 'grid';
    status.style.color = '#cbd2d9';
    resuming = false;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  };
  const hide = () => {
    root.hidden = true;
    root.style.display = 'none';
    dragging = false;
    keyboardTurn = null;
    cancelAnimationFrame(scrubRaf);
    scrubRaf = 0;
    cancelAnimationFrame(raf);
    raf = 0;
  };

  return {
    show,
    hide,
    togglePlayback,
    stepPlayback,
    get visible() { return !root.hidden; },
    destroy() {
      hide();
      root.remove();
    },
  };
}
