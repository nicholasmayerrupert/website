// Buffer-local actor packets are meaningful only after a peer has installed the
// matching full world window.
export function canSendBufferLocalFrame(peer, maxBufferedBytes) {
  return !peer.needsWorld &&
    peer.ws.readyState === 1 &&
    peer.ws.bufferedAmount <= maxBufferedBytes;
}
