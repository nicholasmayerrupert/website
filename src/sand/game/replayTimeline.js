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
    'display:none', 'grid-template-columns:auto auto minmax(80px,1fr) auto',
    'align-items:center', 'gap:9px', 'padding:10px 11px',
    'background:rgba(8,11,14,.82)', 'border:1px solid rgba(255,255,255,.2)',
    'border-radius:6px', 'box-shadow:0 4px 20px rgba(0,0,0,.45)',
    'backdrop-filter:blur(5px)', 'color:#f3f4f6',
    'font:11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace',
    'pointer-events:auto', 'touch-action:manipulation',
  ].join(';');

  const play = document.createElement('button');
  play.type = 'button';
  play.style.cssText = `${controlStyle};min-width:42px;padding-inline:9px`;
  play.setAttribute('aria-label', 'Pause replay');

  const current = document.createElement('span');
  current.style.cssText = 'min-width:38px;text-align:right;color:#fff;font-variant-numeric:tabular-nums';

  const track = document.createElement('div');
  track.style.cssText = [
    'position:relative', 'height:22px', 'display:flex', 'align-items:center',
    'cursor:pointer', 'isolation:isolate',
  ].join(';');
  const rail = document.createElement('div');
  rail.style.cssText = [
    'position:absolute', 'left:0', 'right:0', 'top:9px', 'height:4px',
    'background:rgba(255,255,255,.16)', 'border-radius:999px', 'overflow:hidden',
  ].join(';');
  const buffered = document.createElement('div');
  buffered.style.cssText = 'position:absolute;inset:0 auto 0 0;width:0;background:rgba(255,255,255,.38)';
  const watched = document.createElement('div');
  watched.style.cssText = 'position:absolute;inset:0 auto 0 0;width:0;background:#e5b94d';
  rail.append(buffered, watched);
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
  track.append(rail, thumb, range);

  const total = document.createElement('span');
  total.style.cssText = 'min-width:38px;color:#cbd2d9;font-variant-numeric:tabular-nums';
  const resume = document.createElement('button');
  resume.type = 'button';
  resume.textContent = 'Resume here';
  resume.style.cssText = `${controlStyle};grid-column:4;grid-row:2;background:rgba(145,103,28,.94);border-color:#d9b95e;white-space:nowrap`;

  const status = document.createElement('div');
  status.style.cssText = [
    'grid-column:1/3', 'grid-row:2', 'min-height:13px', 'color:#cbd2d9',
    'font-size:10px', 'text-align:left', 'pointer-events:none',
  ].join(';');
  const ticks = document.createElement('span');
  ticks.setAttribute('aria-label', 'Replay tick');
  ticks.style.cssText = [
    'grid-column:3', 'grid-row:2', 'color:#fff', 'font-size:10px',
    'font-variant-numeric:tabular-nums', 'text-align:right', 'white-space:nowrap',
  ].join(';');
  root.append(play, current, track, total, resume, status, ticks);
  ctx.container.appendChild(root);

  let raf = 0;
  let scrubRaf = 0;
  let dragging = false;
  let dragWasPlaying = false;
  let previewTurn = 0;
  let keyboardTurn = null;
  let resuming = false;

  const draw = () => {
    if (root.hidden) return;
    const state = ctx.worldWorker?.state || {};
    const turns = Math.max(1, state.replayTurns | 0);
    const turn = dragging ? previewTurn : Math.max(0, state.replayTurn | 0);
    const bufferedTurn = Math.max(0, Math.min(turns, state.replayBufferedTurn | 0));
    const position = Math.max(0, Math.min(1, turn / turns));
    range.max = String(turns);
    if (!dragging) range.value = String(turn);
    watched.style.width = `${position * 100}%`;
    buffered.style.width = `${bufferedTurn / turns * 100}%`;
    thumb.style.left = `${position * 100}%`;
    current.textContent = formatTime(turn);
    total.textContent = formatTime(turns);
    ticks.textContent = `Tick ${turn.toLocaleString()} / ${turns.toLocaleString()}`;
    if (keyboardTurn === state.replayTurn) keyboardTurn = null;
    const paused = !!state.replayPaused;
    play.textContent = paused ? '▶' : 'Ⅱ';
    play.setAttribute('aria-label', paused ? 'Play replay' : 'Pause replay');
    resume.disabled = resuming || !!state.replayBuffering;
    if (!resuming) {
      if (state.replayBufferError)
        status.textContent = state.replayBufferError;
      else if (state.replayBufferLimitReached)
        status.textContent = 'The in-memory replay buffer is full; buffered turns remain seekable.';
      else if (state.replayBuffering)
        status.textContent = `Buffering ${formatTime(bufferedTurn)} / ${formatTime(turns)}…`;
      else if (state.replayBufferComplete)
        status.textContent = state.replayMatched === false
          ? 'Buffered replay completed with a verification difference.'
          : 'Replay fully buffered.';
      else
        status.textContent = `Buffered through ${formatTime(bufferedTurn)}.`;
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
    status.textContent = `Preparing turn ${turn.toLocaleString()} for live play…`;
    try {
      await ctx.worldWorker.resumeBufferedReplay(turn, (at, target) => {
        status.textContent = `Rebuilding authority ${at.toLocaleString()} / ${target.toLocaleString()}…`;
      });
      hide();
      ctx.container.focus({ preventScroll: true });
      onResumed?.(turn);
    } catch (error) {
      status.textContent = error?.message || String(error);
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
