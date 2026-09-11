// Hand-placed pixel motifs. Coordinates wrap at the tile edge; no random grain.
// Run with --check to verify the committed, directly editable pixel rows.
import { readFileSync, writeFileSync } from 'node:fs';

const SIZE = 32;
const art = {};
let pixels;
const dot = (x, y, ink) => { pixels[(y & 31) * SIZE + (x & 31)] = ink; };
function line(points, ink) {
  for (let i = 1; i < points.length; i++) {
    let [x, y] = points[i - 1];
    const [ex, ey] = points[i], dx = Math.abs(ex - x), dy = -Math.abs(ey - y);
    const sx = x < ex ? 1 : -1, sy = y < ey ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      dot(x, y, ink);
      if (x === ex && y === ey) break;
      const twice = error * 2;
      if (twice >= dy) { error += dy; x += sx; }
      if (twice <= dx) { error += dx; y += sy; }
    }
  }
}
function stamp(x, y, rows) {
  rows.forEach((row, j) => [...row].forEach((c, i) => { if (c !== '.') dot(x + i, y + j, Number(c)); }));
}
function rect(x, y, w, h, ink) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) dot(x + i, y + j, ink);
}
function facet(points, ink) {
  const ys = points.map(p => p[1]);
  for (let y = Math.min(...ys); y < Math.max(...ys); y++) {
    const cuts = [];
    for (let i = 0; i < points.length; i++) {
      const [ax, ay] = points[i], [bx, by] = points[(i + 1) % points.length];
      if ((ay <= y && by > y) || (by <= y && ay > y)) cuts.push(ax + (y - ay) * (bx - ax) / (by - ay));
    }
    cuts.sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i += 2) {
      for (let x = Math.ceil(cuts[i]); x < cuts[i + 1]; x++) dot(x, y, ink);
    }
  }
}
function tile(name, palette, paint, note) {
  pixels = new Uint8Array(SIZE * SIZE).fill(2);
  paint();
  art[name] = { note, palette: palette.split(' ').map(c => `#${c}`), rows: Array.from({ length: SIZE }, (_, y) => [...pixels.slice(y * SIZE, (y + 1) * SIZE)].join('')) };
}

// Pixel clusters share a light source at upper left. Empty symbols preserve the ground.
const pebble = ['.334.', '33221', '.2110'];
const chip = ['.43', '321', '.10'];
const leaf = ['...3..', '..343.', '.33321', '33221.', '.211..'];
const needle = ['...3...', '.3.3.3.', '..333..', '3.323.3', '.32223.', '..121..', '...1...'];
const knot = ['..111..', '.13321.', '1322321', '1321231', '1321231', '.13221.', '..111..'];
const crystal = ['...4..', '..453.', '.44531', '.43531', '.33511', '..311.'];
const ore = ['..65..', '.67551', '665511', '.5510.'];
const glint = ['.4.', '454', '.4.'];
const root = [[-2, 5], [3, 7], [7, 7], [12, 10], [18, 11], [22, 15], [30, 18], [34, 18]];
function rock(shadow = 5) {
  facet([[-4, 3], [4, 0], [13, 2], [17, 7], [10, 12], [1, 10], [-4, 7]], 3);
  facet([[17, 7], [24, 4], [30, 8], [29, 18], [23, 22], [16, 17]], shadow);
  facet([[-3, 22], [5, 17], [11, 18], [12, 22], [7, 25], [2, 29], [-3, 27]], 3);
  facet([[15, 25], [22, 23], [28, 26], [31, 32], [25, 34], [18, 31]], shadow);
  facet([[2, 3], [7, 2], [12, 3], [9, 5], [3, 5]], 4);
  facet([[1, 22], [5, 20], [10, 20], [7, 22]], 4);
  line([[12, 2], [17, 7], [16, 12], [18, 15]], 1);
  line([[17, 7], [22, 5], [24, 5]], 1);
  line([[0, 11], [5, 12], [8, 15]], shadow);
  line([[12, 19], [16, 23], [22, 22], [26, 19]], 1);
  line([[16, 24], [16, 28]], shadow);
  stamp(23, 12, ['33..', '.332', '..21']); stamp(7, 27, ['11.', '.12']);
  stamp(29, 1, ['33', '32']); stamp(4, 16, ['32', '.2']);
}
function strata(slant = 0) {
  for (const [y, width, ink] of [[2, 4, 3], [10, 3, 5], [17, 6, 3], [28, 2, 5]]) {
    const top = [[0, y], [6, y + 1], [14, y + 1 + slant], [22, y - 1 + slant], [28, y - 1], [32, y]];
    facet([...top, ...top.toReversed().map(([x, yy]) => [x, yy + width])], ink);
  }
  line([[0, 9], [5, 9], [8, 10], [13, 10 + slant]], 1);
  line([[18, 25 + slant], [22, 24 + slant], [28, 24], [31, 25]], 1);
  line([[4, 18], [10, 18 + slant], [15, 18 + slant]], 4);
  line([[20, 3 + slant], [24, 2], [28, 2]], 4);
  stamp(7, 6, ['55..', '.552']); stamp(17, 14, ['33.', '.32']);
  stamp(2, 28, ['35', '.5']); stamp(25, 13, ['15', '.5']);
}
function bark(wide = false) {
  for (const [x, width] of [[1, 4], [12, wide ? 6 : 3], [25, 3]]) {
    const path = [[x, 0], [x + 1, 5], [x - 1, 11], [x - 2, 18], [x + 1, 25], [x, 32]];
    facet([...path, ...path.toReversed().map(([xx, y]) => [xx + width, y])], 5);
    line(path, 1);
    line(path.map(([xx, y]) => [xx + width + 1, y]), 3);
  }
  facet([[6, 3], [10, 5], [9, 10], [6, 14], [4, 12], [6, 8]], 3);
  facet([[17, 20], [20, 16], [22, 21], [21, 29], [18, 33], [17, 28]], 3);
  line([[5, 2], [8, 6], [8, 10], [6, 14], [6, 19], [9, 23]], 3);
  line([[8, 7], [7, 11], [4, 15], [4, 18], [8, 24]], 1);
  stamp(5, 13, ['.31.', '3321', '3121', '3121', '.11.']);
  line([[20, 0], [20, 5], [18, 8], [18, 13]], 1);
  line([[20, 20], [20, 26], [19, 28]], 4);
  line([[29, 8], [28, 13], [29, 16]], 4);
  stamp(10, 27, ['3.', '31', '.1']);
}
function earth(wet = false) {
  facet([[-3, 2], [5, 1], [10, 5], [8, 10], [2, 12], [-3, 8]], 5);
  facet([[14, 5], [20, 3], [28, 6], [31, 11], [27, 15], [18, 13], [15, 10]], 3);
  facet([[2, 18], [9, 15], [15, 19], [16, 24], [11, 28], [4, 26]], 3);
  facet([[20, 23], [26, 19], [32, 22], [34, 28], [28, 31], [22, 29]], 5);
  stamp(4, 4, ['3355..', '322255', '.22552', '..552.']);
  stamp(19, 7, ['.3333.', '333222', '.22225', '..255.']);
  stamp(7, 19, ['.343..', '333222', '.22225', '..225.']);
  line([[0, 14], [3, 15], [7, 14]], 1);
  line([[18, 19], [22, 17], [25, 17]], wet ? 3 : 5);
  grains([[13, 1], [28, 3], [1, 29], [17, 27]], ['35', '.1']);
  stamp(11, 12, ['.3.', '351', '.1.']); stamp(25, 25, ['33', '21']);
}
function foliage(motif, placements) { for (const [x, y] of placements) stamp(x, y, motif); }
function canopy(motif, placements) {
  facet([[-3, 0], [6, 0], [10, 5], [7, 11], [0, 13], [-3, 8]], 1);
  facet([[11, 12], [19, 10], [27, 14], [28, 21], [20, 26], [13, 22]], 1);
  facet([[0, 18], [6, 14], [12, 17], [14, 22], [9, 27], [1, 26]], 5);
  facet([[15, -2], [23, 0], [25, 5], [21, 9], [14, 7], [11, 3]], 3);
  facet([[27, 24], [32, 22], [37, 26], [35, 30], [29, 33], [25, 29]], 3);
  foliage(motif, placements);
  foliage(motif, placements.map(([x, y], i) => [x + 3 + i % 3, y + 3]));
  stamp(16, 1, ['.33.', '3433', '.32.']); stamp(2, 21, ['33.', '321']);
}
function grains(positions, motif = chip) { foliage(motif, positions); }
function ripples() {
  line([[-3, 6], [1, 6], [3, 5], [9, 5], [11, 6], [14, 6]], 3);
  line([[0, 7], [4, 7], [6, 8], [11, 8]], 1);
  line([[17, 19], [21, 19], [23, 18], [29, 18], [31, 19], [34, 19]], 3);
  line([[20, 21], [25, 21], [27, 22], [31, 22]], 1);
  line([[10, 28], [14, 28], [16, 27], [20, 27]], 3);
}
function wisps() {
  stamp(0, 3, ['...33333...', '.333222233.', '33222222223', '32222222221', '.222222211.', '...11111...']);
  stamp(17, 18, ['...3333...', '.33222233.', '3322222223', '.222222221', '..2222211.', '....111...']);
}
function oreRock(placements, motif = ore) {
  rock(2);
  for (let i = 0; i < placements.length; i++) {
    const [x, y] = placements[i];
    facet([[x - 2, y + 1], [x + 2, y - 2], [x + 6, y], [x + 8, y + 4], [x + 3, y + 7], [x - 1, y + 5]], 5);
    line([[x - 4, y - 2], [x - 1, y], [x + 1, y + 4], [x + 6, y + 6], [x + 9, y + 5]], 5);
    line([[x - 2, y - 1], [x, y], [x + 2, y + 3]], 6);
    stamp(x, y, motif);
    stamp(x + 4, y + 3, i % 2 ? ['65.', '751', '.51'] : ['.76', '665', '.51']);
  }
}
const leaves = [[1, 2], [13, 0], [23, 7], [6, 13], [17, 18], [28, 24], [4, 26]];

tile('SAND', '9d784a b39360 c8ad76 d6bf89 e5d3a3 b9a06c', () => {
  line([[-4, 9], [3, 9], [7, 8], [13, 8]], 3);
  line([[17, 23], [23, 23], [27, 22], [35, 22]], 3);
  grains([[5, 17], [20, 4], [28, 29]], ['3.', '.1']);
}, 'Wind-combed ochre dunes; broad quiet ground with sparse paired grains.');
tile('WATER', '084b9c 086cd4 168fee 39cfff b3f5ff 126fca', ripples, 'Long broken blue ripples, with shadow only beneath each crest.');
tile('STONE', '354059 505f77 7b899a 9aa8b6 bdcbce 68788f', rock, 'Blue-gray stone with broad chipped facets, warm pale shoulders and deep cool seams.');
tile('OIL', '171329 2b2050 433263 7b50ac e58bcf 5ddccf', () => {
  ripples(); line([[4, 14], [7, 12], [12, 12], [15, 14], [12, 16], [7, 16]], 5);
  line([[7, 13], [11, 13], [13, 14]], 4);
}, 'Deep violet oil with bright turquoise and magenta interference colors.');
tile('FIRE', '9d302b c34a28 e36b2d f4a544 ffe2a0 f9c55b', () => {
  foliage(['...3...', '...43..', '..345..', '..3453.', '.334531', '3335531', '3355431', '2333321'], [[1, 1], [13, 18], [24, 7], [4, 25]]);
}, 'Upright amber tongues with cream cores, separated by warm ember ground.');
tile('STEAM', '869eaa a5bbc3 c3d4d5 d7e4df eaf0df b4c9ce', wisps, 'Soft blue-white vapor curls with quiet interiors.');
tile('SEED', '342b28 51402d 775833 987749 b8a275 826e41', () => {
  foliage(['.333.', '34421', '33221', '.211.'], [[2, 3], [17, 13], [7, 26], [28, 0]]);
}, 'Rounded umber seed husks with a single straw-colored ridge.');
tile('WOOD', '482a2b 703c2a a36a36 c18b49 e2b86d 8c512e', () => bark(true), 'Golden cut timber; flowing growth bands bend around dark elongated knots.');
tile('PLANT', '204737 356933 568e3f 7bb652 b5d977 447c37', () => canopy(leaf, leaves), 'Small rounded leaflets in loose interlocking clusters.');
tile('ACID', '28600b 529f0d 93dd18 c2fa3e f2ffc0 5cbc30', () => {
  ripples(); foliage(['.33.', '3421', '3211', '.11.'], [[5, 12], [24, 27]]); dot(15, 17, 4);
}, 'Chartreuse pools with tiny pale-rimmed bubbles.');
tile('LAVA', '631928 b82a0c ff650d ffad20 fff5a4 ffd14b', () => {
  stamp(1, 2, ['...333...', '.3355533.', '335444553', '354455533', '.3555332.', '..3332...']);
  stamp(20, 19, ['.33333.', '3355533', '3544533', '.35533.', '..333..']);
  line([[9, 5], [14, 5], [17, 7], [17, 12]], 3);
  line([[23, 24], [21, 28], [16, 29], [11, 27]], 3);
  stamp(23, 2, ['..11111..', '.1100001.', '110000001', '.10000011', '..11111..']);
  stamp(3, 17, ['..1111...', '.1000011.', '110000001', '.11000011', '...1111..']);
}, 'Incandescent orange melt, golden heat and pale yellow cores; burgundy cooling crust.');
tile('ICE', '4269a7 6fadd4 a1d9e8 c6edf2 effff1 80bfdc', () => {
  facet([[-2, 3], [10, 0], [17, 5], [9, 14], [1, 20], [-2, 13]], 3);
  facet([[15, 12], [24, 9], [32, 4], [34, 16], [26, 25], [19, 22]], 5);
  facet([[1, 26], [10, 17], [15, 22], [18, 32], [9, 34]], 3);
  line([[-3, 21], [7, 11], [10, 4], [17, -3]], 3);
  line([[7, 11], [15, 12], [21, 8], [29, 7], [34, 2]], 1);
  line([[15, 12], [18, 21], [25, 28], [28, 35]], 3);
  line([[3, 24], [7, 20], [9, 15]], 4); stamp(24, 17, glint);
}, 'Large glacial plates; a restrained branching fracture and sparse frost glint.');
tile('RIGID', '29364e 3f5872 5e829b 85adc1 bbd9df 4e708b', () => {
  facet([[0, 2], [31, 2], [25, 7], [4, 10], [0, 9]], 3);
  facet([[0, 18], [31, 18], [20, 24], [0, 26]], 5);
  for (const y of [0, 16]) { line([[0, y], [31, y]], 1); line([[0, y + 1], [31, y + 1]], 3); }
  for (const [x, y] of [[3, 3], [27, 3], [11, 19], [23, 19]]) stamp(x, y, ['43', '10']);
  line([[8, 7], [18, 7]], 3); line([[19, 25], [27, 25]], 1);
}, 'Blue steel plates with inset seams, chamfered rivets and brushed wear.');
tile('DRIFTWOOD', '51474d 756756 9d9272 bfb08a e1d2a5 897959', () => {
  bark(true); line([[18, 2], [18, 7], [20, 9]], 4); line([[2, 19], [1, 25], [1, 29]], 0);
}, 'Silvered driftwood; bleached raised grain and a split weathered end.');
tile('DIRT', '4f302c 70432e 98633b b57e4b d4a566 825334', earth, 'Rich sienna loam with layered clay clods, ochre grit and deep warm crevices.');
tile('SNOW', '9eb6c8 bed0da dee6e6 eaf0eb faf7e9 cddde3', () => {
  line([[-3, 11], [3, 11], [7, 9], [15, 9]], 3);
  line([[17, 25], [24, 25], [28, 23], [34, 23]], 3);
  stamp(6, 20, ['.3', '31']); stamp(25, 5, ['34', '.3']);
}, 'Cream-lit snowdrifts with shallow blue hollows; broad untouched areas.');
tile('MUD', '34272c 50382e 745236 926e46 b89b68 62462f', () => earth(true), 'Wet umber earth with flattened clay clods, pooled shadows and amber slicks.');
tile('CLAY', '803e3c a45b46 c98762 dca078 f0c293 b96f52', () => {
  strata(); line([[12, 4], [11, 8], [13, 11]], 1); line([[26, 24], [25, 29]], 1);
}, 'Terracotta deposits with soft sediment bands and fine drying cracks.');
tile('SANDSTONE', '986439 b78847 d6af66 e8c682 f5dfab c59a54', () => {
  strata(); stamp(4, 6, ['3.3', '.2.']); line([[15, 13], [15, 18], [13, 22]], 1);
}, 'Honey sandstone with interrupted bedding and rounded weathered edges.');
tile('MOSS', '294332 456531 668539 8ca744 bace70 557639', () => {
  canopy(['..333..', '.334331', '3333221', '.332211', '..211..'], [[0, 3], [7, 11], [14, 1], [23, 9], [17, 21], [1, 25], [28, 28]]);
}, 'Velvety olive cushions with moss lobes, shaded undersides and no glitter.');
tile('COPPER_ORE', '334c56 4d6b70 6e9391 8baca0 b0c9b1 a65a36 e49653 ffcc87', () => {
  oreRock([[4, 9], [10, 12], [23, 26]]); stamp(16, 16, ['65', '.5']);
}, 'Angular native copper lodes; warm metal clustered along cool rock fractures.');
tile('IRON_ORE', '3e4257 596779 819092 a0afa5 c2cbb3 8b4534 bc7043 e5a56b', () => {
  oreRock([[3, 14], [20, 3]], ['.555..', '566551', '675511', '.5510.']); line([[22, 10], [25, 13]], 5);
}, 'Blunt iron-rich ochre nodules with oxidized edges and pale fracture faces.');
tile('COAL_ORE', '242638 3d4960 657f90 879ead afc4c8 25283b 404862 737f9f', () => {
  oreRock([[1, 9], [8, 14], [22, 24]], ['.6555.', '665551', '655501', '.5500.']);
}, 'Graphite-black coal cleats with a narrow blue mineral sheen.');
tile('GOLD_ORE', '44334f 665674 8a7797 a890b3 cab2cc b88024 ebbb38 ffea89', () => {
  oreRock([[6, 9], [23, 25]]); line([[10, 13], [13, 16], [16, 15]], 6); dot(17, 14, 7);
}, 'Small buttery gold pockets with branching metallic threads, never uniform glitter.');
tile('BRICK', '653436 884739 b76344 d68a5e efb982 a5573e', () => {
  for (let y = 0; y < 32; y += 8) {
    const joint = y % 16 === 0 ? 5 : 21;
    rect(joint + 1, y + 1, 31, 7, y % 24 === 0 ? 5 : 2);
    facet([[joint + 2, y + 2], [joint + 23, y + 2], [joint + 18, y + 4], [joint + 5, y + 5]], 3);
    rect(0, y, 32, 1, 1);
    line([[joint + 2, y + 1], [joint + 28, y + 1]], 3);
    rect(joint, y + 1, 1, 7, 1); rect(joint + 1, y + 2, 1, 4, 3);
    line([[joint + 15, y + 6], [joint + 27, y + 6]], 5);
  }
  stamp(11, 4, ['43..', '..32']); stamp(25, 19, ['115', '.12']); line([[7, 28], [13, 28]], 3);
}, 'Hand-fired running-bond brick with thin umber mortar and chipped faces.');
tile('PINE_WOOD', '39262b 573528 81522b a47135 cf9e56 6a4127', () => {
  bark(); line([[9, -2], [8, 4], [10, 7]], 0); stamp(20, 14, ['34', '.3']);
}, 'Dark resinous pine; narrow furrows and amber resin cuts.');
tile('CACTUS', '254d3c 387045 5a9955 83bf6a d0de91 49834d', () => {
  for (const x of [2, 13, 24]) { rect(x, 0, 1, 32, 1); rect(x + 2, 0, 2, 32, 3); }
  foliage(['.4.', '434', '.1.'], [[3, 4], [14, 18], [25, 10], [3, 27]]);
}, 'Upright fleshy ribs with widely spaced ivory areoles.');
tile('MUSH_STEM', '938877 b5a891 d2c6ac e3d7bc f1e8cd bfb59f', () => {
  line([[5, -2], [5, 8], [7, 13], [7, 22], [5, 30]], 3);
  line([[21, 6], [20, 15], [22, 22], [22, 30]], 1);
  line([[13, 13], [13, 20]], 3); stamp(27, 2, ['31', '.1']);
}, 'Ivory mushroom fibers, gently bending rather than timber-like bark.');
tile('MUSH_CAP', '7d2f48 aa4253 ce615d e99075 f7d5a2 e5a684', () => {
  foliage(['.443.', '44531', '.331.'], [[3, 5], [20, 13], [10, 25], [30, 29]]);
  line([[15, 4], [18, 3], [22, 4]], 3);
}, 'Muted vermilion cap with irregular cream scales and a waxy curved highlight.');
tile('VINE', '204432 2f6238 488a43 71ac54 aad579 387440', () => {
  line([[3, -2], [9, 6], [10, 14], [17, 21], [21, 30], [27, 37]], 1);
  foliage(leaf, [[3, 4], [10, 14], [18, 26], [25, 8]]);
}, 'Alternating small vine leaves attached to a wandering dark stem.');
tile('ACRID_SMOKE', '79734d 96905a b4b174 c9c38c dcd8aa a3a574', () => {
  wisps(); line([[3, 16], [7, 15], [12, 16], [14, 18]], 1);
}, 'Sulfur smoke with curled ochre rims and dull olive hollows.');
tile('SALT', 'a2b5b5 c3d2cd e1e8d9 f0f2e0 fbf9eb cfdbd5', () => {
  grains([[3, 5], [18, 12], [9, 25], [28, 30]], ['.43', '432', '211']);
}, 'Small square salt facets separated by quiet chalk-white ground.');
tile('BRINE', '075d69 098e91 20bcb1 5ce8cb ccfff0 168f9c', () => {
  ripples(); stamp(7, 14, ['33.', '..3']); line([[24, 28], [28, 28]], 4);
}, 'Saturated turquoise brine with pale mint saline highlights.');
tile('GUNPOWDER', '2c2d33 3b3e45 4c5058 626570 85858b 41464d', () => {
  grains([[2, 2], [13, 7], [25, 2], [6, 18], [22, 22], [14, 29]], ['31', '10']);
}, 'Charcoal grains; small broken angular clusters with restrained cool highlights.');
tile('TNT', '622d35 8b3f42 b9554d d5745d e6b884 a89778', () => {
  for (const x of [1, 9, 17, 25]) { rect(x, 0, 1, 32, 1); rect(x + 1, 0, 1, 32, 3); }
  for (const y of [5, 23]) { rect(0, y, 32, 2, 5); rect(0, y + 2, 32, 1, 1); }
  stamp(12, 12, ['.44.', '4444', '4114', '4114', '.44.']);
}, 'Wax-red dynamite sticks, cloth binding and a small aged paper label.');
tile('DEBRIS', '383b40 51555a 6c706f 888b81 a4a496 605e57', () => {
  grains([[1, 1], [14, 5], [23, 17], [7, 22]], pebble); stamp(20, 29, chip);
}, 'Broken gray rubble: irregular fragments with chipped pale upper faces.');
tile('CRYSTAL', '557da9 7fb8cf aee1e5 d4f4e9 f5ffe0 8cccd9', () => {
  facet([[1, 12], [9, 4], [13, 7], [12, 21], [6, 27], [2, 23]], 5);
  facet([[18, 21], [24, 11], [28, 12], [29, 23], [24, 32], [20, 31]], 3);
  foliage(crystal, [[2, 3], [17, 15], [27, 28]]); line([[8, 10], [11, 13], [12, 18]], 3);
}, 'Pale prismatic crystal with sharp paired facets and warm white tips.');
tile('MYCELIUM', '382b3e 50394f 704a66 916882 c599af a57896', () => {
  line(root, 3); line([[7, 7], [9, 3], [8, -3]], 3); line([[18, 11], [17, 20], [12, 26], [13, 31]], 3);
  foliage(['.4.', '453', '.31'], [[2, 6], [15, 19], [25, 15]]);
}, 'Mauve fungal ground crossed by thin branching hyphae and tiny pearly nodes.');
tile('MYCELIUM_SPORE', '49334a 664562 855d7d a7799a d1a4bb b18bab', () => {
  foliage(['.43.', '4531', '3321', '.11.'], [[2, 3], [15, 15], [25, 28], [30, 10]]);
}, 'Dusty violet spore casings with a split pearlescent crown.');
tile('GLOWBERRY', '8c542c b77531 d9993c eeb74c f9db82 c08637', () => {
  foliage(['.343.', '34531', '33321', '.211.'], [[2, 3], [17, 15], [27, 28]]);
}, 'Golden fruit beads with amber shaded undersides and a compact glowing crown.');
tile('GLOWSHROOM', '4e8190 71a5b0 9acbd0 c0e2dd e3f1df 87b6c6', () => {
  foliage(['..44..', '.4433.', '433331', '.3211.', '..11..'], [[1, 1], [17, 14], [6, 26]]);
}, 'Opalescent blue mushroom scales, luminous without hard white speckle.');
tile('GRASS', '2d4d2d 427032 699a3c 93bf53 c5dd82 558437', () => {
  foliage(['3...3', '33.3.', '.333.', '..21.', '..1..'], [[1, 2], [13, 6], [24, 17], [7, 23], [29, 30]]);
}, 'Short folded blades with highlighted tips and darker overlapping roots.');
tile('METHANE', '607c6b 839d84 a1b89a b9caaa d7ddbb 92b29e', () => {
  wisps(); stamp(12, 12, ['333.', '...3']);
}, 'Pale sage gas in broad, barely outlined translucent curls.');
tile('PINE_NEEDLES', '193e34 275a3c 397d48 579e58 8bc57a 306c41', () => {
  canopy(needle, [[0, 0], [13, 4], [25, 13], [7, 18], [19, 27]]);
}, 'Sprays of radial pine needles; deep green between the lit branchlets.');
tile('WILLOW_LEAF', '2f5133 507d39 71a346 9cc563 d0e494 60913d', () => {
  canopy(['..3', '.33', '.43', '331', '321', '21.', '1..'], [[2, 1], [13, 7], [24, 1], [6, 19], [21, 23], [30, 14]]);
}, 'Long pendant willow leaves with a pale central fold and tapering tips.');
tile('BUSH_LEAF', '274f35 417b3c 63a147 89c25c c1de8a 528d40', () => {
  canopy(['.33..', '3433.', '33231', '.221.', '..1..'], [[2, 2], [10, 7], [23, 2], [19, 17], [2, 23], [28, 28]]);
}, 'Dense rounded shrub leaves grouped in small offset fans.');
tile('DEEPSTONE', '24223b 373450 504a6b 696382 8c83a0 443e60', () => {
  rock(); line([[21, 12], [23, 15], [23, 18]], 0);
}, 'Dense blue-violet bedrock with subdued slab edges and a deep fissure.');
tile('GLASS', '508ba1 7ebbc5 a8dedd cff2e6 efffe9 91cdd6', () => {
  facet([[0, 18], [18, 0], [23, 0], [0, 23]], 5);
  line([[0, 13], [12, 1]], 3); line([[2, 15], [10, 7]], 4);
  line([[19, 30], [29, 20]], 3); stamp(22, 8, ['3', '3']);
}, 'Clear sea-glass planes with sparse diagonal reflections and open interiors.');
tile('LIGHT', 'c5ad6c dfca8b f2e6ad faf2ca fffbe5 e9d99a', () => {
  foliage(['..3..', '.343.', '34443', '.343.', '..3..'], [[3, 4], [20, 21]]);
}, 'Warm frosted light with a soft five-pixel radiance motif.');
tile('NEUTRONIUM', '171b2c 24283e 343650 474761 68627d 71678c', () => {
  line([[0, 11], [7, 4], [13, 4], [18, 9]], 1);
  line([[12, 27], [18, 21], [25, 21], [31, 27]], 3);
  stamp(8, 14, ['.5.', '535', '.1.']);
}, 'Dense violet metal with broad dark facets and one muted gravitational glint.');
tile('STONE_DUST', '656467 7e7c7b 97938c aca79b c3bdad 888582', () => {
  grains([[4, 7], [21, 16], [12, 27]], ['3.', '.1']);
}, 'Fine warm-gray stone meal; much quieter and finer than rubble.');
tile('OAK_SEED', '453426 65492e 8b673e ac8854 d0b17b 796943', () => {
  foliage(['.111.', '13331', '34421', '33221', '.211.'], [[2, 4], [18, 18], [29, 1]]);
}, 'Acorn husks with a dark cap, golden shoulder and pointed base.');
tile('OAK_WOOD', '502c28 783f26 ab6a30 ce9146 ecc073 91502a', () => {
  bark(true); stamp(20, 10, knot); line([[12, 25], [12, 30]], 4);
}, 'Honey oak with prominent cathedral knots and broad warm growth fibers.');
tile('OAK_LEAF', '254b2e 417431 60933b 87b653 bbd782 4f8135', () => {
  canopy(['..3...', '.343..', '333331', '.3321.', '33231.', '.211..'], [[1, 2], [15, 4], [25, 17], [7, 20], [18, 29]]);
}, 'Broad lobed oak clusters, bright upper lobes and overlapping olive shadows.');
tile('VEIN_SOIL', '502c46 713e5b 975772 b77692 dfa3b7 844965', () => {
  earth(); line(root, 1); line([[18, 11], [20, 6], [25, 3]], 3);
}, 'Plum earth threaded with fine vascular roots and a few mauve clods.');
tile('EYE_WOOD', '57283f 803a51 a95168 cb7688 eaa5ae 934459', () => {
  bark(true); line([[20, 1], [18, 5], [18, 12]], 4);
}, 'Burgundy living trunks with pale sinewy ridges and long organic knots.');
tile('EYE_SCLERA', 'a59b94 c4bab0 dfd6c6 ece5d5 f8f1df c29b98', () => {
  line([[0, 8], [4, 10], [7, 10], [10, 13]], 5); line([[5, 10], [5, 6]], 5);
  line([[22, 24], [27, 25], [32, 29]], 1); line([[10, 3], [16, 3]], 3);
}, 'Warm porcelain sclera with very sparse branching rose capillaries.');
tile('EYE_IRIS', '36595b 4f7b76 71a397 99c0a8 c9d8b6 598d89', () => {
  foliage(['..3..', '.332.', '33211', '321..', '21...'], [[1, 2], [15, 8], [25, 21], [7, 26]]);
  stamp(20, 1, ['43', '.3']);
}, 'Jade iris tissue with slanting fibrous striations and pale limbal flecks.');
tile('EYE_PUPIL', '161823 24232e 302d3a 413b4b 665565 373441', () => {
  stamp(4, 6, ['333.', '3443', '.332']); line([[22, 25], [25, 25]], 1);
}, 'Nearly black plum pupil with a single quiet reflected window.');
tile('PALESTONE', '968273 b3a088 d1c4a0 e5dbb2 f8edcf c1b08e', () => {
  strata(1); line([[11, 5], [11, 9], [13, 11]], 1); stamp(24, 16, ['33', '.34']);
}, 'Old ivory limestone; smooth layered faces and occasional chalk inclusions.');
tile('EYE_SEED', '3c5050 5c7770 85a397 adc5ab dce3c5 73647a', () => {
  foliage(['.333.', '34431', '35121', '.211.'], [[2, 4], [18, 20], [28, 7]]);
}, 'Small jade seed eyes with a dark slit inside each polished pale shell.');
tile('BONE', '9b8c75 bcae91 d9cbae eaddc1 f5ecd5 c8b99c', () => {
  line([[6, -2], [5, 6], [7, 13], [7, 20], [5, 29], [5, 34]], 3);
  line([[22, 4], [21, 11], [23, 18], [23, 27]], 1);
  foliage(['31', '10'], [[11, 8], [27, 22], [15, 28]]);
}, 'Warm aged bone; long cortical fibers with a few small marrow pores.');
tile('RUST_BRAMBLE', '623c37 875044 ad6a4f c68a61 e0af7c 955c47', () => {
  line(root, 1); foliage(['..3.', '.343', '3321', '.21.'], [[3, 4], [16, 12], [24, 23]]);
  stamp(9, 25, ['3.', '31', '.1']);
}, 'Rust-red thorn leaves and crooked dark twigs, lit with dry copper edges.');
tile('OCHRE_REED', '76613b 9b7e43 be9f56 d7ba70 ebd39a ae9252', () => {
  for (const [x, y] of [[3, 0], [15, 11], [27, 20]]) {
    line([[x, y], [x, y + 8], [x + 1, y + 13]], 3); stamp(x - 1, y + 6, ['111', '.31']);
  }
}, 'Ochre reeds with long golden fibers and dark segmented joints.');
tile('TEAL_LICHEN', '2e5754 437873 62998d 83b5a0 b1d0ad 538b85', () => {
  foliage(['.333.', '34223', '321.1', '.311.', '..1..'], [[2, 2], [14, 10], [25, 22], [4, 26]]);
}, 'Blue-green lichen in tiny curled cups with pale mint rims.');
tile('VIOLET_FROND', '593f61 795580 9b72a0 b992b5 d4b6cd 89608e', () => {
  foliage(['...3...', '.3.43..', '..343..', '3.333.3', '.33231.', '..121..'], [[1, 2], [17, 12], [7, 24], [28, 28]]);
}, 'Violet fern fans with a pale lilac midrib and tapered paired leaflets.');
tile('SHALE', '65483f 8b6650 b18a62 cea776 e6c796 9c7858', () => {
  strata(1); line([[3, 16], [10, 18], [18, 18]], 1); line([[20, 29], [28, 30]], 3);
}, 'Warm thin shale laminae; stepped bedding and splintered flat chips.');
tile('SLATE', '354c67 4c7190 6d98b0 91b8c7 bfe0df 5d839f', () => {
  strata(-2); line([[8, 4], [7, 9]], 1); line([[24, 13], [21, 20]], 1);
}, 'Cold blue slate with tilted cleavage planes and short sharp cross fractures.');
tile('ROOTSTONE', '3f5544 587347 7c984f a1b76c cad79a 957044', () => {
  rock(); line(root, 5); line(root.map(([x, y]) => [x, y - 1]), 3);
  line([[12, 10], [11, 15], [7, 19]], 5);
}, 'Sage porous stone gripped by ochre branching fossil roots.');
tile('VEIN_ROCK', '51365e 724783 9b6bb0 bd8fca e2b8e5 d39ed5', () => {
  rock(); line(root, 5); line([[18, 11], [20, 5], [25, 2]], 3);
  stamp(16, 10, ['34', '.3']);
}, 'Amethyst host rock with a wandering pale mineral vein and violet fracture faces.');

const materials = JSON.parse(readFileSync('src/sand/materials.schema.json', 'utf8')).materials;
for (const material of materials.filter(m => m.id !== 0)) {
  if (!art[material.name]) throw new Error(`Missing art: ${material.name}`);
}
const ordered = Object.fromEntries(materials.filter(m => m.id !== 0).map(m => [m.name, art[m.name]]));
const output = `// Hand-authored material pixel tiles. Recipes: scripts/author-material-art.mjs.\n// Each symbol selects a palette color; one source pixel covers one simulation cell.\nexport default ${JSON.stringify(ordered, null, 2)};\n`;
const path = 'src/sand/content/materialArt.js';
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== output) throw new Error('Material art differs from its authoring recipes.');
} else writeFileSync(path, output);
console.log(`${Object.keys(ordered).length} hand-authored ${SIZE}×${SIZE} material tiles`);
