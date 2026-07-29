// Framework-free multiplayer controls. The panel owns no network state; it reads
// status and forwards join/disconnect requests to the game runtime.

import { injectStyleOnce, swallowEvents } from './uiShared.js';

const STYLE = `
.mp-wrap { position:absolute; top:10px; right:10px; z-index:73; pointer-events:auto;
  font-family:ui-monospace,"SFMono-Regular",Menlo,monospace; color:#e5e7eb; }
.mp-toggle { padding:7px 10px; font-size:9px; font-weight:800; line-height:1; letter-spacing:.1em;
  text-transform:uppercase; border-radius:0; cursor:pointer; border:2px solid #080a0c;
  background:#252b31; color:#cbd2d8; box-shadow:inset 0 0 0 1px #59636c,4px 4px 0 rgba(0,0,0,.42); }
.mp-toggle:hover { color:#fff; border-color:#080a0c; background:#30373e; }
.mp-toggle .mp-dot { display:inline-block; width:7px; height:7px; margin-right:7px;
  background:#6b7280; vertical-align:middle; box-shadow:0 0 0 2px #111418; }
.mp-toggle.online .mp-dot { background:#53d697; box-shadow:0 0 0 2px #111418,0 0 6px #34d399; }
.mp-panel { display:none; margin-top:7px; width:230px; padding:11px; border-radius:0;
  background:rgba(20,24,29,.96); border:3px solid #080a0c;
  box-shadow:inset 0 0 0 2px #515b65,7px 7px 0 rgba(0,0,0,.5); }
.mp-panel.open { display: block; }
.mp-row { display: flex; gap: 6px; margin-bottom: 6px; }
.mp-field { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.mp-field label { font-size:8px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; color:#8e98a1; }
.mp-field input { width:100%; box-sizing:border-box; padding:7px; font-family:inherit; font-size:10px; border-radius:0;
  border:2px solid #080a0c; background:#101317; color:#f1f5f9; box-shadow:inset 2px 2px 0 #272e34; }
.mp-field input:focus { outline:2px solid #fde68a; outline-offset:0; border-color:#080a0c; }
.mp-btn { width:100%; padding:8px; font-family:inherit; font-size:10px; font-weight:900; letter-spacing:.1em;
  text-transform:uppercase; border-radius:0; cursor:pointer; border:2px solid #080a0c;
  background:#496b88; color:#fff; box-shadow:inset 0 0 0 1px #7796ae,3px 3px 0 #080a0c; }
.mp-btn:hover { background:#587c99; }
.mp-btn:disabled { cursor: wait; opacity: .7; }
.mp-btn.leave { background: #b91c1c; }
.mp-btn.leave:hover { background: #991b1b; }
.mp-status { margin-top:8px; font-size:9px; color:#aeb7bf; min-height:12px; word-break:break-word; }
`;

export function createConnectPanel(root, { join, disconnect, getStatus, focusSurface } = {}) {
  injectStyleOnce(root, 'data-sand-connect', STYLE);

  const wrap = document.createElement('div');
  wrap.className = 'mp-wrap';
  wrap.innerHTML = `
    <button class="mp-toggle" type="button"><span class="mp-dot"></span>Multiplayer</button>
    <div class="mp-panel">
      <div class="mp-row">
        <div class="mp-field" style="flex:2"><label>Host / IP</label><input class="mp-host" value="localhost" spellcheck="false" autocomplete="off"></div>
        <div class="mp-field" style="flex:1"><label>Port</label><input class="mp-port" value="5191" spellcheck="false" inputmode="numeric" autocomplete="off"></div>
      </div>
      <div class="mp-row">
        <div class="mp-field"><label>Room</label><input class="mp-room" value="main" spellcheck="false" autocomplete="off"></div>
      </div>
      <button class="mp-btn connect" type="button">Connect</button>
      <div class="mp-status"></div>
    </div>`;

  const toggle = wrap.querySelector('.mp-toggle');
  const panel = wrap.querySelector('.mp-panel');
  const hostIn = wrap.querySelector('.mp-host');
  const portIn = wrap.querySelector('.mp-port');
  const roomIn = wrap.querySelector('.mp-room');
  const btn = wrap.querySelector('.mp-btn');
  const statusEl = wrap.querySelector('.mp-status');

  // Don't let clicks/keys inside the panel reach the game (movement, tool use).
  swallowEvents(wrap, ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup', 'wheel']);

  let connected = false, connecting = false, lastError = '';
  const refresh = () => {
    const st = getStatus?.() || { connected: false, status: 'offline' };
    connected = !!st.connected;
    toggle.classList.toggle('online', connected);
    btn.classList.toggle('leave', connected);
    btn.disabled = connecting;
    btn.textContent = connecting ? 'Connecting…' : connected ? 'Disconnect' : 'Connect';
    hostIn.disabled = portIn.disabled = roomIn.disabled = connected || connecting;
    const remotes = typeof st.remotes === 'number' ? st.remotes : 0;
    if (connecting) statusEl.textContent = st.status === 'connecting' ? 'connecting…' : (st.status || 'connecting…');
    else if (connected && !st.worldReady) statusEl.textContent = 'connected · waiting for world snapshot…';
    else if (connected) statusEl.textContent = `${st.status || 'connected'}${remotes ? ` · ${remotes} other player${remotes === 1 ? '' : 's'}` : ''}`;
    else if (lastError) statusEl.textContent = lastError;
    else statusEl.textContent = st.status && st.status !== 'offline' ? st.status : '';
  };

  toggle.addEventListener('click', () => { panel.classList.toggle('open'); refresh(); });

  btn.addEventListener('click', async () => {
    if (connected) {
      disconnect?.();
      refresh();
      focusSurface?.();
      return;
    }
    const host = (hostIn.value || 'localhost').trim();
    const port = (portIn.value || '5191').trim();
    const room = (roomIn.value || 'main').trim();
    const url = `ws://${host}:${port}`;
    connecting = true; lastError = '';
    refresh();
    let joined = false;
    try {
      await join?.(url, room);
      joined = true;
    } catch (e) {
      lastError = `failed: ${e?.message || e}`;
    } finally {
      connecting = false;
    }
    refresh();
    if (joined && connected) focusSurface?.();
  });

  // Light poll so the status line tracks (dis)connection events the panel didn't
  // initiate (server stop, peers joining/leaving). Cheap; UI-only.
  const timer = setInterval(refresh, 1000);
  refresh();

  root.appendChild(wrap);
  return {
    el: wrap,
    refresh,
    destroy() { clearInterval(timer); wrap.remove(); },
  };
}
