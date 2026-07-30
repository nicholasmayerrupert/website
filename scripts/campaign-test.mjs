import assert from 'node:assert/strict';
import {
  CAMPAIGN_MISSIONS,
  LOADOUT_SUPPLIES,
  buildMissionLoadout,
  defaultLoadoutSelection,
  loadoutSelectionCost,
  normalizeLoadoutSelection,
} from '../src/sand/campaign/missions.js';
import {
  CAMPAIGN_SAVE_VERSION,
  CAMPAIGN_STORAGE_KEY,
  beginCampaignRun,
  completeCampaignMission,
  createCampaignSave,
  isCampaignMissionUnlocked,
  readCampaignSave,
  sanitizeCampaignSave,
  setCampaignLoadout,
  updateCampaignSave,
  writeCampaignSave,
} from '../src/sand/campaign/campaignSave.js';
import { ITEM_KIND as ABI_ITEM_KIND } from '../src/sand/wasmBridge/abi.generated.js';

let checks = 0;
const check = (name, fn) => {
  fn();
  checks++;
  console.log(`  ok   ${name}`);
};

const storage = () => {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
};

console.log('IRIS campaign metadata + persistence');

check('campaign order is Earth, Moon, then Mars with lower off-world gravity', () => {
  assert.deepEqual(
    CAMPAIGN_MISSIONS.map(({ id, planet }) => [id, planet]),
    [
      ['greenfall-recovery', 'earth'],
      ['silent-quarry', 'moon'],
      ['red-furnace', 'mars'],
    ],
  );
  assert.equal(CAMPAIGN_MISSIONS[1].objectives.length, 3);
  assert.match(CAMPAIGN_MISSIONS[1].objectives[0], /two shield anchors/i);
  assert.match(CAMPAIGN_MISSIONS[2].objectives[0], /three reactor anchors/i);
  assert.ok(CAMPAIGN_MISSIONS[1].gravity < CAMPAIGN_MISSIONS[0].gravity);
  assert.ok(CAMPAIGN_MISSIONS[2].gravity < CAMPAIGN_MISSIONS[0].gravity);
});

check('default loadouts stay inside each mission capacity', () => {
  for (const mission of CAMPAIGN_MISSIONS) {
    const selection = defaultLoadoutSelection(mission.id);
    assert.ok(loadoutSelectionCost(selection) <= mission.loadoutBudget);
    const stacks = buildMissionLoadout(mission.id, selection);
    assert.ok(stacks.length <= LOADOUT_SUPPLIES.length);
    assert.ok(stacks.every((stack) => stack.itemKind === ABI_ITEM_KIND.MATERIAL && stack.count > 0));
  }
});

check('loadout normalization clamps packs, budget, and locked weapons', () => {
  const mission = CAMPAIGN_MISSIONS[0];
  const packs = Object.fromEntries(LOADOUT_SUPPLIES.map(({ id }) => [id, 99]));
  const locked = normalizeLoadoutSelection(mission.id, {
    packs,
    weaponItemKind: ABI_ITEM_KIND.MINIGUN,
  });
  assert.ok(loadoutSelectionCost(locked) <= mission.loadoutBudget);
  assert.equal(locked.weaponItemKind, null);
  const unlocked = normalizeLoadoutSelection(
    mission.id,
    { packs: {}, weaponItemKind: ABI_ITEM_KIND.MINIGUN },
    [ABI_ITEM_KIND.MINIGUN],
  );
  assert.equal(unlocked.weaponItemKind, ABI_ITEM_KIND.MINIGUN);
  assert.equal(buildMissionLoadout(mission.id, unlocked, [ABI_ITEM_KIND.MINIGUN]).at(-1).count, 250);
});

check('unlocking is strictly sequential', () => {
  const initial = createCampaignSave();
  assert.equal(isCampaignMissionUnlocked(initial, 'greenfall-recovery'), true);
  assert.equal(isCampaignMissionUnlocked(initial, 'silent-quarry'), false);
  assert.equal(isCampaignMissionUnlocked(initial, 'red-furnace'), false);

  const skipped = completeCampaignMission(initial, 'silent-quarry');
  assert.deepEqual(skipped.completedMissionIds, []);

  const earth = completeCampaignMission(initial, 'greenfall-recovery');
  assert.deepEqual(earth.completedMissionIds, ['greenfall-recovery']);
  assert.equal(isCampaignMissionUnlocked(earth, 'silent-quarry'), true);
  assert.equal(isCampaignMissionUnlocked(earth, 'red-furnace'), false);

  const moon = completeCampaignMission(earth, 'silent-quarry');
  assert.deepEqual(moon.completedMissionIds, ['greenfall-recovery', 'silent-quarry']);
  assert.equal(isCampaignMissionUnlocked(moon, 'red-furnace'), true);
});

check('debrief records extracted weapons and the fastest completion', () => {
  const initial = createCampaignSave();
  const first = completeCampaignMission(initial, 'greenfall-recovery', {
    elapsedTicks: 7200,
    inventory: {
      slots: [{ itemKind: ABI_ITEM_KIND.BORE_CANNON, count: 7 }],
    },
  });
  assert.deepEqual(first.unlockedWeapons, [ABI_ITEM_KIND.BORE_CANNON]);
  assert.equal(first.bestTimes['greenfall-recovery'], 7200);
  const faster = completeCampaignMission(first, 'greenfall-recovery', { elapsedTicks: 6000 });
  assert.equal(faster.bestTimes['greenfall-recovery'], 6000);
  const slower = completeCampaignMission(faster, 'greenfall-recovery', { elapsedTicks: 9000 });
  assert.equal(slower.bestTimes['greenfall-recovery'], 6000);
});

check('deployment persists only normalized configuration and the unsigned seed', () => {
  const initial = completeCampaignMission(createCampaignSave(), 'greenfall-recovery');
  const run = beginCampaignRun(initial, 'silent-quarry', -1, {
    packs: { brick: 99, tnt: 99, acid: 99 },
    weaponItemKind: ABI_ITEM_KIND.MINIGUN,
  });
  assert.equal(run.interruptedRun.worldSeed, 0xffffffff);
  assert.equal(run.interruptedRun.missionId, 'silent-quarry');
  assert.ok(loadoutSelectionCost(run.interruptedRun.loadout) <= CAMPAIGN_MISSIONS[1].loadoutBudget);
  assert.equal(run.interruptedRun.loadout.weaponItemKind, null);
  assert.equal('world' in run.interruptedRun, false);
});

check('save round-trips and invalid schemas fail closed', () => {
  const memory = storage();
  const state = completeCampaignMission(createCampaignSave(), 'greenfall-recovery', {
    recoveredWeaponKinds: [ABI_ITEM_KIND.DYNAMITE_SATCHEL],
  });
  const written = writeCampaignSave(state, memory);
  assert.deepEqual(readCampaignSave(memory), written);
  assert.ok(memory.getItem(CAMPAIGN_STORAGE_KEY));
  memory.setItem(CAMPAIGN_STORAGE_KEY, '{broken');
  assert.deepEqual(readCampaignSave(memory), createCampaignSave());
  assert.deepEqual(sanitizeCampaignSave({ version: CAMPAIGN_SAVE_VERSION + 1, completedMissionIds: ['greenfall-recovery'] }), createCampaignSave());
});

check('a stale tab cannot overwrite progress written by another tab', () => {
  const memory = storage();
  const staleTab = writeCampaignSave(createCampaignSave(), memory);
  const completed = completeCampaignMission(staleTab, 'greenfall-recovery', {
    elapsedTicks: 5400,
    recoveredWeaponKinds: [ABI_ITEM_KIND.BORE_CANNON],
  });
  writeCampaignSave(completed, memory);
  const merged = updateCampaignSave(
    staleTab,
    (current) => setCampaignLoadout(current, 'greenfall-recovery', {
      packs: { tnt: 1 },
      weaponItemKind: null,
    }),
    memory,
  );
  assert.deepEqual(merged.completedMissionIds, ['greenfall-recovery']);
  assert.deepEqual(merged.unlockedWeapons, [ABI_ITEM_KIND.BORE_CANNON]);
  assert.equal(merged.bestTimes['greenfall-recovery'], 5400);
});

check('tampered completion lists collapse to a valid prefix', () => {
  const clean = sanitizeCampaignSave({
    version: CAMPAIGN_SAVE_VERSION,
    completedMissionIds: ['red-furnace', 'greenfall-recovery'],
    selectedMissionId: 'red-furnace',
  });
  assert.deepEqual(clean.completedMissionIds, ['greenfall-recovery']);
  assert.equal(clean.selectedMissionId, 'silent-quarry');
});

console.log(`campaign checks passed: ${checks}`);
