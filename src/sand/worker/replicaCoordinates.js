// Authority snapshots use buffer-local coordinates. Convert them through absolute
// world space whenever the authority and presentation mirrors have different
// loaded-window offsets.

const translate = (value, delta) => Number.isFinite(value) ? value + delta : value;

export function translatePackedPositions(data, stride, xField, yField, dx, dy) {
  if (!data || (!dx && !dy)) return data;
  for (let o = 0; o + stride <= data.length; o += stride) {
    data[o + xField] += dx;
    data[o + yField] += dy;
  }
  return data;
}

export function mapActorPacketToOffset(packet, targetOffsetX, targetOffsetY) {
  const sourceOffsetX = Number.isFinite(packet?.worldOffsetX) ? packet.worldOffsetX : targetOffsetX;
  const sourceOffsetY = Number.isFinite(packet?.worldOffsetY) ? packet.worldOffsetY : targetOffsetY;
  const dx = sourceOffsetX - targetOffsetX;
  const dy = sourceOffsetY - targetOffsetY;
  const mapActor = (actor) => ({
    ...actor,
    x: translate(actor.x, dx),
    y: translate(actor.y, dy),
    aimX: translate(actor.aimX, dx),
    aimY: translate(actor.aimY, dy),
  });
  const mapPosition = (entity) => ({
    ...entity,
    x: translate(entity.x, dx),
    y: translate(entity.y, dy),
  });
  return {
    ...packet,
    worldOffsetX: targetOffsetX,
    worldOffsetY: targetOffsetY,
    players: Array.isArray(packet?.players) ? packet.players.map(mapActor) : packet?.players,
    mineTarget: packet?.mineTarget ? mapPosition(packet.mineTarget) : packet?.mineTarget,
  };
}
