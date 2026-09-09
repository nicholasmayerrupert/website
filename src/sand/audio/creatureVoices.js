import { CREATURE, SOUND_EVENT as S } from '../wasmBridge/abi.generated.js';

const voice = (call, attack, hurt, death, options = {}) => Object.freeze({
  call: call.split(' '), attack: attack.split(' '), hurt: hurt.split(' '), death: death.split(' '),
  rate: 1, gain: .30, cutoff: 8500, reach: 100, step: 'soil', texture: null, ...options,
});

// Each species has its own recorded performances and material character.
export const CREATURE_VOICES = Object.freeze({
  [CREATURE.MINNOW]: voice('cvWater1', 'cvWater2', 'cvWater3', 'splash1', { gain: .16, rate: 1.3, reach: 45, step: 'splash' }),
  [CREATURE.PIKE]: voice('cvWater2', 'cvEat2', 'cvWater3', 'splash3', { gain: .23, rate: .82, reach: 65, step: 'splash', texture: 'splash' }),
  [CREATURE.FOX]: voice('cvBark1 cvBark2', 'cvBark2', 'cvHurt1', 'cvScream1', { rate: 1.18, gain: .27, texture: 'cloth' }),
  [CREATURE.HARE]: voice('cvCute3 cvCute4', 'cvCute5', 'cvCute2', 'cvCute6', { gain: .17, rate: 1.15, reach: 55, texture: 'cloth' }),
  [CREATURE.CRAWLER]: voice('cvBug1 cvBug2', 'cvBug3', 'cvBug4', 'cvAlien2', { rate: .86, cutoff: 6200, texture: 'soil' }),
  [CREATURE.MOLE]: voice('cvNose cvCute8', 'cvEat1', 'cvCute9', 'cvCute10', { gain: .19, rate: .85, reach: 60, texture: 'soil' }),
  [CREATURE.BIRD]: voice('cvBird1 cvBird2', 'cvBird2', 'cvBird3', 'cvBird3', { gain: .20, reach: 120, step: 'cloth' }),
  [CREATURE.DYNAMITEER]: voice('cvGrunt4 cvCough1', 'cvGrunt5', 'cvHurt2', 'cvScream2', { rate: 1.12, texture: 'wood' }),
  [CREATURE.BORE_SENTINEL]: voice('cvHumanBig2', 'cvHumanBig3', 'cvHumanHurt3', 'cvHumanDeath0', { rate: .76, cutoff: 2800, step: 'metal', texture: 'metal' }),
  [CREATURE.CAUSTIC_MORTARMAN]: voice('cvAlien3 cvBurble1', 'cvSpit2', 'cvHurt3', 'cvAlien6', { rate: .92, texture: 'splash' }),
  [CREATURE.CLUSTER_WASP]: voice('cvBug4', 'cvBug2', 'cvBug1', 'cvBug3', { rate: 1.3, gain: .23, cutoff: 6500, step: 'cloth', texture: 'cloth' }),
  [CREATURE.MINIGUNNER]: voice('cvHumanAttack5', 'cvHumanAttack6', 'cvHumanHurt5', 'cvHumanDeath1', { rate: .94, step: 'step', texture: 'cloth' }),
  [CREATURE.SURVEYOR]: voice('cvHumanYes0', 'cvHumanAttack0', 'cvHumanHurt0', 'cvHumanDeath0', { gain: .22, rate: 1.08, step: 'step', texture: 'cloth' }),
  [CREATURE.SHIELD_ANCHOR]: voice('cvHumanBig4', 'cvHumanBig5', 'cvHumanHurt7', 'cvHumanDeath1', { rate: .82, cutoff: 3400, step: 'metal', texture: 'metal' }),
  [CREATURE.QUARRY_FOREMAN]: voice('cvMonster4', 'cvRoar1', 'cvGrunt2', 'cvMonster5', { rate: .65, gain: .40, cutoff: 4600, reach: 180, step: 'stone', texture: 'stone' }),
  [CREATURE.REACTOR_WARDEN]: voice('cvMonster6', 'cvRoar2', 'cvGrunt3', 'cvMonster7', { rate: .78, gain: .38, reach: 170, step: 'metal', texture: 'fireLoop' }),
  [CREATURE.REACTOR_CORE]: voice('cvWeird4', 'cvAlien5', 'cvWeird3', 'cvAlien6', { rate: .7, gain: .26, cutoff: 5000, reach: 140, step: 'glass', texture: 'glass' }),
  [CREATURE.IRIS_COMMANDER]: voice('cvHumanBig0', 'cvHumanBig1', 'cvHumanHurt8', 'cvHumanDeath0', { rate: .88, gain: .32, step: 'metal', texture: 'metal' }),
  [CREATURE.IRIS_ENGINEER]: voice('cvHumanYes1', 'cvHumanAttack3', 'cvHumanHurt9', 'cvHumanDeath1', { rate: 1.16, gain: .24, step: 'step', texture: 'metal' }),
  [CREATURE.VILLAGER]: voice('cvHumanGreet0', 'cvHumanAttack1', 'cvHumanHurt1', 'cvHumanDeath0', { rate: 1.02, gain: .20, reach: 70, step: 'step', texture: 'cloth' }),
  [CREATURE.THORNBOUND_HART]: voice('cvHowl', 'cvRoar3', 'cvMonster1', 'cvMonster2', { rate: .88, gain: .37, reach: 170, step: 'wood', texture: 'wood' }),
  [CREATURE.MIRE_MATRON]: voice('cvBurble2', 'cvAlien4', 'cvHurt4', 'cvMonster3', { rate: .64, gain: .35, cutoff: 5500, reach: 150, step: 'splash', texture: 'splash' }),
  [CREATURE.CINDER_CASTELLAN]: voice('cvTroll2', 'cvTroll3', 'cvGrunt1', 'cvRoar2', { rate: .68, gain: .39, reach: 180, step: 'metal', texture: 'fireLoop' }),
  [CREATURE.HOLLOW_BELLKEEPER]: voice('cvSpirit1', 'cvSpirit2', 'cvWeird2', 'cvSpirit3', { rate: .74, gain: .30, reach: 190, step: 'metal', texture: 'bell' }),
  [CREATURE.BRIAR_WOLF]: voice('cvHowl', 'cvBark1', 'cvHurt5', 'cvScream1', { rate: .78, gain: .32, reach: 150, texture: 'wood' }),
  [CREATURE.BELL_BAT]: voice('cvBat1 cvBat2', 'cvBat2', 'cvBat3', 'cvBat3', { rate: .85, gain: .23, cutoff: 6800, step: 'cloth', texture: 'bell' }),
  [CREATURE.BONE_GUARD]: voice('cvBone1 cvBone2', 'cvBone3', 'cvBone2', 'cvBoneFall', { rate: 1.05, gain: .29, step: 'wood', texture: 'metal' }),
  [CREATURE.FEN_WISP]: voice('cvSpirit2', 'cvSpirit3', 'cvWeird1', 'cvSpirit1', { rate: 1.18, gain: .23, reach: 120, step: 'glass', texture: 'glass' }),
  [CREATURE.ROOT_KNIGHT]: voice('cvCreak1', 'cvCreak2', 'cvMonster1', 'cvCreak3', { rate: .74, gain: .33, step: 'wood', texture: 'wood' }),
  [CREATURE.FROST_GIANT]: voice('cvTroll1 cvTroll2', 'cvTroll3', 'cvGrunt2', 'cvRoar1', { rate: .60, gain: .41, cutoff: 5200, reach: 200, step: 'stone', texture: 'glass' }),
  [CREATURE.MUMMY]: voice('cvBreath cvCough2', 'cvMonster2', 'cvCough3', 'cvMonster3', { rate: .78, gain: .28, cutoff: 4600, step: 'cloth', texture: 'cloth' }),
  [CREATURE.LAVA_TOAD]: voice('cvFrog1 cvFrog2', 'cvFrog2', 'cvBurble1', 'cvBurble2', { rate: .80, gain: .32, step: 'splash', texture: 'fireLoop' }),
  [CREATURE.VILLAGE_GUARD]: voice('cvHumanAttack2', 'cvHumanAttack4', 'cvHumanHurt2', 'cvHumanDeath1', { rate: .91, gain: .25, step: 'metal', texture: 'metal' }),
  [CREATURE.VILLAGE_HUNTER]: voice('cvHumanAttack7', 'cvHumanAttack8', 'cvHumanHurt4', 'cvHumanDeath0', { rate: 1.1, gain: .23, step: 'soil', texture: 'cloth' }),
  [CREATURE.BONE_DINOSAUR]: voice('cvDinosaur1 cvDinosaur2', 'cvDinosaur2', 'cvRoar3', 'cvDinosaurDeath', { rate: .86, gain: .44, cutoff: 6500, reach: 220, step: 'stone', texture: 'cvBoneFall' }),
});

export function creatureSoundPhase(type) {
  if (type === S.CREATURE) return 'hurt';
  if (type === S.CREATURE_CALL || type === S.CREATURE_ALERT) return 'call';
  if (type === S.CREATURE_ATTACK) return 'attack';
  if (type === S.CREATURE_DEATH) return 'death';
  if (type === S.CREATURE_MOVE) return 'step';
  return null;
}

export function creatureSoundSpec(species, type) {
  const voice = CREATURE_VOICES[species], phase = creatureSoundPhase(type);
  if (!voice || !phase) return null;
  const quiet = type === S.CREATURE_CALL, step = phase === 'step', dying = phase === 'death';
  return {
    ...voice, phase, samples: step ? [voice.step] : voice[phase],
    gain: voice.gain * (step ? .21 : quiet ? .38 : dying ? 1.05 : 1),
    rate: voice.rate * (dying ? .88 : phase === 'hurt' ? 1.08 : 1),
    duration: step ? .24 : quiet ? 1.25 : dying ? 2.5 : 1.7,
    texture: quiet || step ? null : voice.texture,
    reach: quiet ? voice.reach * .65 : step ? Math.min(65, voice.reach) : voice.reach,
    cooldown: step ? 120 : quiet ? 2600 : type === S.CREATURE_ALERT ? 1300 : dying ? 120 : 180,
  };
}
