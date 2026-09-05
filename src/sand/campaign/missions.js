import { MAT } from '../materials.js';
import { ITEM_KIND } from '../wasmBridge/abi.generated.js';

export const AGENCY = Object.freeze({
  shortName: 'IRIS',
  name: 'Interstellar Rescue & Intervention Service',
});

export const SHIP_NAME = 'Kestrel';

export const LOADOUT_SUPPLIES = Object.freeze([
  Object.freeze({
    id: 'brick',
    name: 'Building Blocks',
    detail: 'Stable brick for bridges, cover, and emergency shafts.',
    material: MAT.BRICK,
    packSize: 160,
    packCost: 1,
    maxPacks: 3,
    color: '#b87a57',
  }),
  Object.freeze({
    id: 'tnt',
    name: 'TNT',
    detail: 'Controlled demolition charges. Keep clear after ignition.',
    material: MAT.TNT,
    packSize: 24,
    packCost: 2,
    maxPacks: 2,
    color: '#d94a37',
  }),
  Object.freeze({
    id: 'water',
    name: 'Water',
    detail: 'Suppresses fire, cools lava, and creates safe descents.',
    material: MAT.WATER,
    packSize: 180,
    packCost: 1,
    maxPacks: 2,
    color: '#4d8dcc',
  }),
  Object.freeze({
    id: 'acid',
    name: 'Acid',
    detail: 'Cuts vulnerable terrain when ordinary tools are too slow.',
    material: MAT.ACID,
    packSize: 100,
    packCost: 2,
    maxPacks: 2,
    color: '#7fc957',
  }),
  Object.freeze({
    id: 'sand',
    name: 'Sand',
    detail: 'Fast bulk fill for ramps, fire breaks, and pressure traps.',
    material: MAT.SAND,
    packSize: 220,
    packCost: 1,
    maxPacks: 2,
    color: '#d5b56d',
  }),
]);

export const RECOVERABLE_WEAPONS = Object.freeze([
  Object.freeze({ itemKind: ITEM_KIND.DYNAMITE_SATCHEL, name: 'Dynamite Satchel', ammo: 10 }),
  Object.freeze({ itemKind: ITEM_KIND.BORE_CANNON, name: 'Bore Cannon', ammo: 15 }),
  Object.freeze({ itemKind: ITEM_KIND.ACID_MORTAR, name: 'Acid Mortar', ammo: 20 }),
  Object.freeze({ itemKind: ITEM_KIND.CLUSTER_LAUNCHER, name: 'Cluster Launcher', ammo: 15 }),
  Object.freeze({ itemKind: ITEM_KIND.MINIGUN, name: 'Minigun', ammo: 250 }),
]);

const mission = (definition) => Object.freeze({
  ...definition,
  objectives: Object.freeze(definition.objectives.map(Object.freeze)),
  hazards: Object.freeze(definition.hazards),
  defaultPacks: Object.freeze(definition.defaultPacks),
});

export const CAMPAIGN_MISSIONS = Object.freeze([
  mission({
    id: 'greenfall-recovery',
    planet: 'earth',
    planetName: 'Earth',
    operation: 'Greenfall Relay',
    title: 'Greenfall Relay',
    duration: '8–12 min',
    gravity: 1,
    gravityLabel: '1.00 G',
    coordinates: 'Pacific Ecological Zone · E-17',
    briefing: 'Disable the jammer, open the shelters, and rescue three researchers.',
    objectives: [
      'Disable the signal jammer in the lower gallery.',
      'Hold the rescue beam on each researcher.',
      'Reach the surface recovery beacon.',
    ],
    hazards: ['Fire', 'Cave-ins', 'Armed demolition crews'],
    loadoutBudget: 6,
    defaultPacks: { brick: 2, tnt: 1, water: 1 },
    accent: '#63b87a',
    sky: 'linear-gradient(145deg,#193f50 0%,#397b82 48%,#c9a46b 100%)',
  }),
  mission({
    id: 'silent-quarry',
    planet: 'moon',
    planetName: 'The Moon',
    operation: 'Operation Silent Quarry',
    title: 'Silent Quarry',
    duration: '18–22 min',
    gravity: 0.33,
    gravityLabel: '0.33 G',
    coordinates: 'Shackleton Mining Reach · L-04',
    briefing: 'The Silent Quarry has gone dark. Two shield anchors protect an illegal command bunker beneath the mine. Disable both, defeat the foreman, and signal Kestrel from the emergency pickup point.',
    objectives: [
      'Disable two shield anchors in separate mine branches.',
      'Defeat the quarry foreman.',
      'Reach the emergency pickup point.',
    ],
    hazards: ['Vacuum breaches', 'Long falls', 'Bore sentinels'],
    loadoutBudget: 7,
    defaultPacks: { brick: 1, tnt: 1, water: 1, acid: 1 },
    accent: '#bac5d2',
    sky: 'linear-gradient(145deg,#07090e 0%,#171b25 55%,#494b50 100%)',
  }),
  mission({
    id: 'red-furnace',
    planet: 'mars',
    planetName: 'Mars',
    operation: 'Operation Red Furnace',
    title: 'Red Furnace',
    duration: '20–25 min',
    gravity: 0.76,
    gravityLabel: '0.76 G',
    coordinates: 'Noctis Reactor Basin · M-31',
    briefing: 'A buried reactor is feeding weapons production beneath Noctis. Traverse the complex, disable its three anchors, defeat the reactor warden, and breach the core before the basin collapses.',
    objectives: [
      'Disable all three reactor anchors.',
      'Defeat the reactor warden and breach the core.',
      'Escape the destabilized basin.',
    ],
    hazards: ['Lava', 'Acid', 'Reactor fire', 'Severe cave-ins'],
    loadoutBudget: 8,
    defaultPacks: { brick: 1, tnt: 2, acid: 1 },
    accent: '#dc7657',
    sky: 'linear-gradient(145deg,#351715 0%,#8f3f2f 52%,#d98a58 100%)',
  }),
]);

export const CAMPAIGN_MISSION_IDS = Object.freeze(CAMPAIGN_MISSIONS.map(({ id }) => id));

const missionById = new Map(CAMPAIGN_MISSIONS.map((entry) => [entry.id, entry]));
const supplyById = new Map(LOADOUT_SUPPLIES.map((entry) => [entry.id, entry]));
const weaponByKind = new Map(RECOVERABLE_WEAPONS.map((entry) => [entry.itemKind, entry]));

export function getCampaignMission(id) {
  return missionById.get(id) || CAMPAIGN_MISSIONS[0];
}

export function getNextCampaignMission(id) {
  const index = CAMPAIGN_MISSION_IDS.indexOf(id);
  return index >= 0 && index + 1 < CAMPAIGN_MISSIONS.length
    ? CAMPAIGN_MISSIONS[index + 1]
    : null;
}

export function getRecoverableWeapon(itemKind) {
  return weaponByKind.get(itemKind | 0) || null;
}

export function defaultLoadoutSelection(missionId) {
  const entry = getCampaignMission(missionId);
  return {
    packs: Object.fromEntries(LOADOUT_SUPPLIES.map(({ id }) => [id, entry.defaultPacks[id] || 0])),
    weaponItemKind: null,
  };
}

export function loadoutSelectionCost(selection) {
  return LOADOUT_SUPPLIES.reduce((total, supply) => {
    const packs = Math.max(0, Math.min(supply.maxPacks, selection?.packs?.[supply.id] | 0));
    return total + packs * supply.packCost;
  }, 0);
}

export function normalizeLoadoutSelection(missionId, selection, unlockedWeapons = []) {
  const entry = getCampaignMission(missionId);
  const defaults = defaultLoadoutSelection(entry.id);
  const sourcePacks = selection?.packs && typeof selection.packs === 'object'
    ? selection.packs
    : defaults.packs;
  const packs = {};
  let remaining = entry.loadoutBudget;
  for (const supply of LOADOUT_SUPPLIES) {
    const requested = Number.isFinite(Number(sourcePacks[supply.id]))
      ? Math.floor(Number(sourcePacks[supply.id]))
      : 0;
    const affordable = Math.floor(remaining / supply.packCost);
    const count = Math.max(0, Math.min(supply.maxPacks, affordable, requested));
    packs[supply.id] = count;
    remaining -= count * supply.packCost;
  }
  const unlocked = new Set(unlockedWeapons.map((value) => value | 0));
  const requestedWeapon = selection?.weaponItemKind;
  const weaponItemKind = requestedWeapon !== null && requestedWeapon !== undefined &&
    unlocked.has(requestedWeapon | 0) && weaponByKind.has(requestedWeapon | 0)
    ? requestedWeapon | 0
    : null;
  return { packs, weaponItemKind };
}

export function buildMissionLoadout(missionId, selection, unlockedWeapons = []) {
  const normalized = normalizeLoadoutSelection(missionId, selection, unlockedWeapons);
  const stacks = [];
  for (const supply of LOADOUT_SUPPLIES) {
    const packs = normalized.packs[supply.id] || 0;
    if (!packs) continue;
    stacks.push({
      itemKind: ITEM_KIND.MATERIAL,
      material: supply.material,
      count: packs * supply.packSize,
      isTool: false,
      toolClass: 0,
      toolTier: 0,
      plantType: 0,
    });
  }
  const weapon = getRecoverableWeapon(normalized.weaponItemKind);
  if (weapon) {
    stacks.push({
      itemKind: weapon.itemKind,
      material: 0,
      count: weapon.ammo,
      isTool: false,
      toolClass: 0,
      toolTier: 0,
      plantType: 0,
    });
  }
  return stacks;
}

export function getLoadoutSupply(id) {
  return supplyById.get(id) || null;
}
