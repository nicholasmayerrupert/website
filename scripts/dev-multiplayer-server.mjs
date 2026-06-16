// Local development WebSocket relay for sand multiplayer. Pure relay: it tracks
// room membership and forwards messages between peers in a room. The HOST browser
// (the first peer to join a room) runs the authoritative engine; the server never
// simulates anything — it only routes input up to the host and snapshots back
// down. This keeps the deployable transport (a Cloudflare Durable Object relay)
// a drop-in for the same protocol.
//
//   node scripts/dev-multiplayer-server.mjs [port]
//
// Exports startServer(port) so net-test.mjs can spin one up in-process.

import { WebSocketServer } from 'ws';
import { decode, encode, MSG, makeLeave } from '../src/sand/net/protocol.js';

export function startServer(port = 5191) {
  const wss = new WebSocketServer({ port });
  const rooms = new Map(); // roomId -> Map(clientId -> { ws, isHost })

  const roomOf = (id) => { let r = rooms.get(id); if (!r) { r = new Map(); rooms.set(id, r); } return r; };
  const broadcast = (roomId, fromClient, data) => {
    const room = rooms.get(roomId); if (!room) return;
    for (const [cid, peer] of room) if (cid !== fromClient && peer.ws.readyState === peer.ws.OPEN) peer.ws.send(data);
  };

  wss.on('connection', (ws) => {
    let joined = null; // { roomId, clientId }
    ws.on('message', (buf) => {
      const raw = buf.toString();
      const m = decode(raw);
      if (!m) return; // drop malformed
      if (m.t === MSG.JOIN) {
        const room = roomOf(m.room);
        const isHost = room.size === 0; // first peer hosts
        room.set(m.client, { ws, isHost });
        joined = { roomId: m.room, clientId: m.client };
        // ack the joiner with its role + current peer list; notify peers.
        ws.send(encode({ t: 'joined', room: m.room, client: m.client, host: isHost, peers: [...room.keys()].filter((c) => c !== m.client) }));
        broadcast(m.room, m.client, raw);
        return;
      }
      if (!joined) return; // must join before relaying
      broadcast(joined.roomId, joined.clientId, raw); // forward everything else
    });
    ws.on('close', () => {
      if (!joined) return;
      const room = rooms.get(joined.roomId);
      if (room) {
        room.delete(joined.clientId);
        broadcast(joined.roomId, joined.clientId, encode(makeLeave(joined.roomId, joined.clientId)));
        if (room.size === 0) rooms.delete(joined.roomId);
      }
    });
  });

  return {
    wss,
    port,
    close: () => new Promise((resolve) => wss.close(resolve)),
  };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2]) || 5191;
  startServer(port);
  console.log(`sand multiplayer relay listening on ws://localhost:${port}`);
}
