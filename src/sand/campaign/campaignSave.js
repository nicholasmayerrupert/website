import {
  CAMPAIGN_MISSIONS,
  CAMPAIGN_MISSION_IDS,
  RECOVERABLE_WEAPONS,
  defaultLoadoutSelection,
  getNextCampaignMission,
  normalizeLoadoutSelection,
} from './missions.js';

export const CAMPAIGN_SAVE_VERSION = 1;
export const CAMPAIGN_STORAGE_KEY = 'sand-campaign-v1';

const weaponKinds = new Set(RECOVERABLE_WEAPONS.map(({ itemKind }) => itemKind));

const uniqueInts = (values) => {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(values)) return out;
  for (const value of values) {
    const item = value | 0;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
};

export function createCampaignSave() {
  return {
    version: CAMPAIGN_SAVE_VERSION,
    completedMissionIds: [],
    selectedMissionId: CAMPAIGN_MISSION_IDS[0],
    preferredLoadouts: {},
    unlockedWeapons: [],
    bestTimes: {},
    interruptedRun: null,
  };
}

function completedPrefix(values) {
  const requested = new Set(Array.isArray(values) ? values : []);
  const completed = [];
  for (const id of CAMPAIGN_MISSION_IDS) {
    if (!requested.has(id)) break;
    completed.push(id);
  }
  return completed;
}

export function isCampaignMissionUnlocked(save, missionId) {
  const index = CAMPAIGN_MISSION_IDS.indexOf(missionId);
  if (index < 0) return false;
  return index === 0 || save.completedMissionIds.includes(CAMPAIGN_MISSION_IDS[index - 1]);
}

export function firstIncompleteMission(save) {
  return CAMPAIGN_MISSIONS.find(({ id }) => !save.completedMissionIds.includes(id)) ||
    CAMPAIGN_MISSIONS.at(-1);
}

export function sanitizeCampaignSave(value) {
  const clean = createCampaignSave();
  if (!value || typeof value !== 'object' || value.version !== CAMPAIGN_SAVE_VERSION) return clean;
  clean.completedMissionIds = completedPrefix(value.completedMissionIds);
  clean.unlockedWeapons = uniqueInts(value.unlockedWeapons).filter((kind) => weaponKinds.has(kind));

  const preferred = value.preferredLoadouts && typeof value.preferredLoadouts === 'object'
    ? value.preferredLoadouts
    : {};
  for (const { id } of CAMPAIGN_MISSIONS) {
    if (!preferred[id]) continue;
    clean.preferredLoadouts[id] = normalizeLoadoutSelection(id, preferred[id], clean.unlockedWeapons);
  }

  if (value.bestTimes && typeof value.bestTimes === 'object') {
    for (const id of CAMPAIGN_MISSION_IDS) {
      const ticks = Number(value.bestTimes[id]);
      if (Number.isFinite(ticks) && ticks > 0) clean.bestTimes[id] = Math.floor(ticks);
    }
  }

  const selected = CAMPAIGN_MISSION_IDS.includes(value.selectedMissionId)
    ? value.selectedMissionId
    : firstIncompleteMission(clean).id;
  clean.selectedMissionId = isCampaignMissionUnlocked(clean, selected)
    ? selected
    : firstIncompleteMission(clean).id;

  const interrupted = value.interruptedRun;
  if (interrupted && CAMPAIGN_MISSION_IDS.includes(interrupted.missionId) &&
      isCampaignMissionUnlocked(clean, interrupted.missionId)) {
    const seed = Number(interrupted.worldSeed);
    clean.interruptedRun = {
      missionId: interrupted.missionId,
      worldSeed: Number.isFinite(seed) ? seed >>> 0 : 0,
      loadout: normalizeLoadoutSelection(
        interrupted.missionId,
        interrupted.loadout,
        clean.unlockedWeapons,
      ),
    };
  }
  return clean;
}

function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readCampaignSave(storage = browserStorage()) {
  if (!storage?.getItem) return createCampaignSave();
  try {
    const raw = storage.getItem(CAMPAIGN_STORAGE_KEY);
    return raw ? sanitizeCampaignSave(JSON.parse(raw)) : createCampaignSave();
  } catch {
    return createCampaignSave();
  }
}

export function writeCampaignSave(save, storage = browserStorage()) {
  const clean = sanitizeCampaignSave(save);
  try {
    storage?.setItem?.(CAMPAIGN_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // Private browsing and embedded hosts may deny storage. The in-memory
    // campaign remains playable for the current page lifetime.
  }
  return clean;
}

export function updateCampaignSave(fallback, update, storage = browserStorage()) {
  let current = sanitizeCampaignSave(fallback);
  try {
    const raw = storage?.getItem?.(CAMPAIGN_STORAGE_KEY);
    if (raw) current = sanitizeCampaignSave(JSON.parse(raw));
  } catch {
    // Keep the current page's in-memory state when storage cannot be read.
  }
  return writeCampaignSave(update(current), storage);
}

export function setCampaignLoadout(save, missionId, selection) {
  const clean = sanitizeCampaignSave(save);
  if (!CAMPAIGN_MISSION_IDS.includes(missionId)) return clean;
  return {
    ...clean,
    preferredLoadouts: {
      ...clean.preferredLoadouts,
      [missionId]: normalizeLoadoutSelection(missionId, selection, clean.unlockedWeapons),
    },
  };
}

export function loadoutForCampaignMission(save, missionId) {
  const clean = sanitizeCampaignSave(save);
  return normalizeLoadoutSelection(
    missionId,
    clean.preferredLoadouts[missionId] || defaultLoadoutSelection(missionId),
    clean.unlockedWeapons,
  );
}

export function beginCampaignRun(save, missionId, worldSeed, selection) {
  const clean = setCampaignLoadout(save, missionId, selection);
  if (!isCampaignMissionUnlocked(clean, missionId)) return clean;
  const loadout = loadoutForCampaignMission(clean, missionId);
  return {
    ...clean,
    selectedMissionId: missionId,
    interruptedRun: { missionId, worldSeed: worldSeed >>> 0, loadout },
  };
}

function recoveredWeaponKinds(result) {
  const explicit = uniqueInts(result?.recoveredWeaponKinds).filter((kind) => weaponKinds.has(kind));
  const slots = Array.isArray(result?.inventory?.slots)
    ? result.inventory.slots
    : Array.isArray(result?.inventory)
      ? result.inventory
      : [];
  for (const slot of slots) {
    const itemKind = slot?.itemKind | 0;
    if (slot?.count > 0 && weaponKinds.has(itemKind) && !explicit.includes(itemKind)) {
      explicit.push(itemKind);
    }
  }
  return explicit;
}

export function completeCampaignMission(save, missionId, result = {}) {
  const clean = sanitizeCampaignSave(save);
  if (!isCampaignMissionUnlocked(clean, missionId)) return clean;
  const completedMissionIds = completedPrefix([...clean.completedMissionIds, missionId]);
  const unlockedWeapons = uniqueInts([
    ...clean.unlockedWeapons,
    ...recoveredWeaponKinds(result),
  ]).filter((kind) => weaponKinds.has(kind));
  const elapsedTicks = Number(result.elapsedTicks);
  const priorBest = clean.bestTimes[missionId];
  const bestTimes = { ...clean.bestTimes };
  if (Number.isFinite(elapsedTicks) && elapsedTicks > 0 &&
      (!priorBest || elapsedTicks < priorBest)) {
    bestTimes[missionId] = Math.floor(elapsedTicks);
  }
  const next = getNextCampaignMission(missionId);
  return sanitizeCampaignSave({
    ...clean,
    completedMissionIds,
    selectedMissionId: next?.id || missionId,
    unlockedWeapons,
    bestTimes,
    interruptedRun: null,
  });
}

export function abandonCampaignRun(save) {
  return { ...sanitizeCampaignSave(save), interruptedRun: null };
}
