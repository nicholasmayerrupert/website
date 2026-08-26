import { Predictor } from '../src/sand/worker/playerPrediction.js';
import { mapActorPacketToOffset, translatePackedPositions } from '../src/sand/worker/replicaCoordinates.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
};

console.log('predictor coordinate-frame rebase');
{
  const engine = {
    state: {
      id: 7, x: 142, y: 34, vx: 1, vy: 0, facing: 1,
      grounded: true, jumpReady: true, jetpackFuel: 0.75, jetpackActive: false,
      aimX: 180, aimY: 44,
    },
    input: null,
    tick: 0,
    getPlayer() { return { ...this.state }; },
    setPlayerInput(_id, input) {
      this.input = { ...input };
      this.state.aimX = input.aimX;
      this.state.aimY = input.aimY;
    },
    stepPlayerOnly() { this.state.x += 1; },
    setPlayerState(_id, state) { this.state = { ...this.state, ...state }; },
    syncActorTick(tick) { this.tick = tick; },
  };
  const predictor = new Predictor(engine, 7);
  predictor.predict(41, { bits: 2, aimX: 180, aimY: 44, tool: 3 });
  predictor.smoothX = 2.5;
  predictor.smoothY = -1.25;
  const oldWorldX = 512 + predictor.state().x;
  const oldWorldAimX = 512 + engine.input.aimX;

  check('rebase succeeds', predictor.rebase(-128, 96));
  check('predicted player stays at one absolute world position',
    640 + predictor.state().x === oldWorldX);
  check('latest held aim stays at one absolute world position',
    640 + engine.input.aimX === oldWorldAimX && engine.input.aimY === 140);
  check('unacknowledged input is retained and translated',
    predictor.pending.length === 1 &&
      predictor.pending[0].seq === 41 &&
      predictor.pending[0].input.aimX === 52 &&
      predictor.pending[0].input.aimY === 140);
  check('correction smoothing survives the frame change',
    predictor.smoothX === 2.5 && predictor.smoothY === -1.25);
  const firstRender = predictor.renderState();
  const secondRender = predictor.renderState();
  check('repeated presentation reads do not decay smoothing',
    firstRender.x === secondRender.x && firstRender.y === secondRender.y &&
      predictor.smoothX === 2.5 && predictor.smoothY === -1.25);
  predictor.advanceRenderSmoothing();
  check('smoothing advances exactly when the presentation frame advances',
    predictor.smoothX === 1.875 && predictor.smoothY === -0.9375);
}

console.log('worker actor-packet offset mapping');
{
  const source = {
    epoch: 4, worldOffsetX: 512, worldOffsetY: -64,
    players: [{ id: 1, x: 10, y: 20, aimX: 35, aimY: 40 }],
    mineTarget: { x: 90, y: 100 },
  };
  const mapped = mapActorPacketToOffset(source, 640, -160);
  check('player body and aim map through absolute world coordinates',
    mapped.players[0].x === -118 && mapped.players[0].y === 116 &&
      mapped.players[0].aimX === -93 && mapped.players[0].aimY === 136);
  check('locked mine target uses the mirror frame',
    mapped.mineTarget.x === -38 && mapped.mineTarget.y === 196);
  check('mapping does not mutate the authority packet',
    source.players[0].x === 10 && source.mineTarget.x === 90);

  const packed = new Float32Array([1, 10, 20, 9, 2, 30, 40, 8]);
  translatePackedPositions(packed, 4, 1, 2, -128, 96);
  check('packed render actors rebase in place',
    packed[1] === -118 && packed[2] === 116 && packed[5] === -98 && packed[6] === 136);
}

if (failures) {
  console.error(`\n${failures} stream reconciliation check(s) failed`);
  process.exit(1);
}
console.log('\nall stream reconciliation checks passed');
