// Attack phases reference existing clips; their ranges never depend on atlas offsets.
export const CREATURE_CLIPS = ['idle', 'move', 'windup', 'attack', 'recover', 'hurt', 'death', 'special'];
export const ATTACK_PHASES = ['windup', 'attack', 'recover'];
const range = (clip, start, count, loop = false) => ({ clip, start, count, loop });
export const CREATURE_ATTACK_ANIMATIONS = {
  FROST_GIANT: [
    { name: 'Ice breath', windup: range('windup', 0, 3), attack: range('special', 0, 4, true), recover: range('recover', 0, 3) },
    { name: 'Ground smash', windup: range('windup', 3, 3), attack: range('attack', 3, 3), recover: range('recover', 3, 3) },
    { name: 'Ice spear', windup: range('windup', 6, 3), attack: range('attack', 6, 3), recover: range('recover', 6, 3) },
  ],
  BONE_DINOSAUR: [
    { name: 'Bite', windup: range('windup', 0, 1), attack: range('attack', 0, 2), recover: range('recover', 0, 1) },
    { name: 'Rush', windup: range('windup', 1, 1), attack: range('attack', 2, 2, true), recover: range('recover', 1, 1) },
    { name: 'Fire breath', windup: range('windup', 2, 1), attack: range('special', 0, 2, true), recover: range('recover', 2, 1) },
  ],
};

export function attackAnimation(key, art, pattern, phase) {
  const authored = CREATURE_ATTACK_ANIMATIONS[key]?.[pattern]?.[phase] || {};
  const clip = authored.clip || phase;
  return { clip, start: 0, count: art.clips[clip].frames.length, loop: false, ...authored };
}

export function creaturePreviewClip(key, art, mode, pattern = 0) {
  const mapping = ATTACK_PHASES.includes(mode) ? attackAnimation(key, art, pattern, mode)
    : { clip: mode, start: 0, count: art.clips[mode].frames.length };
  const clip = art.clips[mapping.clip];
  return { ...clip, frames: clip.frames.slice(mapping.start, mapping.start + mapping.count),
    durations: clip.durations?.slice(mapping.start, mapping.start + mapping.count) };
}
