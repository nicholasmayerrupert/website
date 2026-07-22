// Multiplayer glue for the sand runtime. The browser is always a pure client;
// the authoritative engine runs in a headless server (scripts/sand-server.mjs).
// This module owns creating the gameNet instance (stored on ctx.net) and the
// join/disconnect/status operations the shell and dev hooks expose.

import { createGameNet } from '../net/gameNet';

export function createNetGlue(ctx, { fit, rebuildEngineForDims, currentLocalInput }) {
  ctx.net = createGameNet({
    getEngine: () => ctx.engine,
    getLocalInput: currentLocalInput,
    getViewport: () => ({
      viewCols: ctx.requestedViewCols || ctx.viewCols,
      viewRows: ctx.requestedViewRows || ctx.viewRows,
      bufferCols: ctx.requestedBufferCols || ctx.cols,
      bufferRows: ctx.requestedBufferRows || ctx.rows,
    }),
    rebuildEngine: rebuildEngineForDims,
  });

  const netJoin = async (url, room) => {
    try {
      await ctx.net.joinRoom(url, room);
    } catch (e) {
      const status = ctx.net.status;
      ctx.net.disconnect(status.startsWith('rejected:') ? status : 'offline');
      if (ctx.survival && !ctx.localPlayerId) { ctx.cols = 0; ctx.rows = 0; fit(); }
      throw e;
    }
  };
  const netDisconnect = () => {
    ctx.net.disconnect();
    // Return to single-player: rebuild the local INFINITE world at window dims
    // (the client engine was sized to the server's shared streamed window). Forcing a
    // dims mismatch makes fit() take the full-rebuild path, which respawns the
    // player.
    if (ctx.survival) { ctx.cols = 0; ctx.rows = 0; fit(); ctx.startLocalAuthority?.(); }
  };
  const netStatus = () => ({
    role: ctx.net.role,
    connected: ctx.net.connected,
    worldReady: ctx.net.worldReady,
    remotes: ctx.net.remoteCount,
    ownPlayerId: ctx.net.ownPlayerId,
    status: ctx.net.status,
  });

  return { netJoin, netDisconnect, netStatus };
}
