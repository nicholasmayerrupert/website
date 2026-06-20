// Framework-free multiplayer connect panel for the sand game. Like inventoryHud.js
// and toolPalette.js it builds plain DOM into a host root (the Web Component's
// shadow root) with one injected <style> — no React. It owns NO net state: it
// reads game.netStatus() and calls game.netJoin(url, room) / game.netDisconnect().
//
// "Normal" multiplayer: someone runs the authoritative server
//   node scripts/sand-server.mjs <port>
// and everyone (including the host) connects from the browser by typing the
// server's IP/host + port + room. The panel is collapsed behind a small
// "Multiplayer" button so single-player UI is unchanged at rest.

const STYLE = `
.mp-wrap { position: absolute; top: 10px; right: 10px; z-index: 73; pointer-events: auto;
  font-family: ui-sans-serif, system-ui, sans-serif; color: #e5e7eb; }
.mp-toggle { padding: 6px 10px; font-size: 12px; font-weight: 700; border-radius: 8px; cursor: pointer;
  border: 1px solid rgba(255,255,255,.18); background: rgba(17,24,39,.6); color: #e5e7eb;
  backdrop-filter: blur(4px); box-shadow: 0 6px 12px -4px rgba(0,0,0,.4); }
.mp-toggle:hover { border-color: rgba(255,255,255,.4); }
.mp-toggle .mp-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px;
  background: #6b7280; vertical-align: middle; }
.mp-toggle.online .mp-dot { background: #34d399; }
.mp-panel { display: none; margin-top: 6px; width: 220px; padding: 10px; border-radius: 10px;
  background: rgba(3,7,18,.86); border: 1px solid rgba(255,255,255,.15);
  box-shadow: 0 20px 25px -5px rgba(0,0,0,.5); backdrop-filter: blur(4px); }
.mp-panel.open { display: block; }
.mp-row { display: flex; gap: 6px; margin-bottom: 6px; }
.mp-field { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.mp-field label { font-size: 10px; font-weight: 700; color: rgba(255,255,255,.55); }
.mp-field input { width: 100%; box-sizing: border-box; padding: 5px 6px; font-size: 12px; border-radius: 6px;
  border: 1px solid rgba(255,255,255,.18); background: rgba(10,14,22,.7); color: #f1f5f9; }
.mp-field input:focus { outline: none; border-color: #fde68a; }
.mp-btn { width: 100%; padding: 7px; font-size: 13px; font-weight: 800; border-radius: 8px; cursor: pointer;
  border: 1px solid rgba(255,255,255,.18); background: #2563eb; color: #fff; }
.mp-btn:hover { background: #1d4ed8; }
.mp-btn.leave { background: #b91c1c; }
.mp-btn.leave:hover { background: #991b1b; }
.mp-status { margin-top: 7px; font-size: 11px; color: rgba(255,255,255,.7); min-height: 14px; word-break: break-word; }
`;

export function createConnectPanel(root, { join, disconnect, getStatus } = {}) {
  const s = document.createElement('style');
  s.textContent = STYLE;
  root.appendChild(s);

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
  for (const ev of ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup', 'wheel']) {
    wrap.addEventListener(ev, (e) => e.stopPropagation());
  }

  let connected = false;
  const refresh = () => {
    const st = getStatus?.() || { connected: false, status: 'offline' };
    connected = !!st.connected;
    toggle.classList.toggle('online', connected);
    btn.classList.toggle('leave', connected);
    btn.textContent = connected ? 'Disconnect' : 'Connect';
    hostIn.disabled = portIn.disabled = roomIn.disabled = connected;
    const remotes = typeof st.remotes === 'number' ? st.remotes : 0;
    statusEl.textContent = connected
      ? `${st.status || 'connected'}${remotes ? ` · ${remotes} other player${remotes === 1 ? '' : 's'}` : ''}`
      : (st.status && st.status !== 'offline' ? st.status : '');
  };

  toggle.addEventListener('click', () => { panel.classList.toggle('open'); refresh(); });

  btn.addEventListener('click', async () => {
    if (connected) { disconnect?.(); refresh(); return; }
    const host = (hostIn.value || 'localhost').trim();
    const port = (portIn.value || '5191').trim();
    const room = (roomIn.value || 'main').trim();
    const url = `ws://${host}:${port}`;
    statusEl.textContent = `connecting to ${url} …`;
    try {
      await join?.(url, room);
    } catch (e) {
      statusEl.textContent = `failed: ${e?.message || e}`;
    }
    refresh();
  });

  // Light poll so the status line tracks (dis)connection events the panel didn't
  // initiate (server stop, peers joining/leaving). Cheap; UI-only.
  const timer = setInterval(refresh, 1000);
  refresh();

  root.appendChild(wrap);
  return {
    el: wrap,
    refresh,
    destroy() { clearInterval(timer); wrap.remove(); s.remove(); },
  };
}
