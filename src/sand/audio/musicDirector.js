import { CREATURE_SPECIES_DEFS, OFF, STRIDES } from '../wasmBridge/abi.generated.js';
import { SCORE_TRACKS } from './scoreTracks.js';

const BOSSES = new Set(['thornbound_hart', 'mire_matron', 'cinder_castellan',
  'hollow_bellkeeper', 'quarry_foreman', 'reactor_warden', 'iris_commander']);
const SCRIPTED_HOSTILES = new Set([...BOSSES, 'root_knight', 'iris_engineer', 'shield_anchor']);

// Read the existing presentation snapshot; nearby NPCs and wildlife do not
// turn exploration into combat. All coordinates here are window-local.
export function scoreThreat(player, creatures) {
  let threat = false, boss = false;
  if (!player || player.alive === false) return { threat, boss };
  const O = OFF.creatureSnapshot;
  for (let i = 0; i + STRIDES.creatureSnapshot <= (creatures?.length || 0); i += STRIDES.creatureSnapshot) {
    if (!creatures[i + O.alive] || creatures[i + O.health] <= 0 || creatures[i + O.npcId] > 0) continue;
    const species = CREATURE_SPECIES_DEFS[creatures[i + O.species]];
    if (!species || (species.population !== 'encounter' && !SCRIPTED_HOSTILES.has(species.key))) continue;
    const distance = Math.hypot(creatures[i + O.x] - player.x, creatures[i + O.y] - player.y);
    if (distance > 95 || (distance > 32 && creatures[i + O.attackState] === 0)) continue;
    threat = true;
    boss ||= BOSSES.has(species.key);
  }
  return { threat, boss };
}

// Two streamed decks crossfade through the existing master/mute/compressor graph.
// Playback is started by the audio unlock gesture and paused when inaudible.
export function createMusicDirector(context, destination, { createMedia = () => new Audio() } = {}) {
  const exploration = SCORE_TRACKS.filter(track => track.mode === 'explore');
  const combat = SCORE_TRACKS.filter(track => track.mode === 'combat');
  let current = null, outgoing = null, pending = null;
  let audible = false, destroyed = false, combatUntil = -Infinity, bossUntil = -Infinity;
  let explorationIndex = 0, combatIndex = 0, lastSwitch = -Infinity;
  let activationRequired = false;
  const failed = new Set();

  const dispose = (deck) => {
    if (!deck) return;
    deck.media.onended = deck.media.onerror = null;
    deck.media.pause();
    deck.media.removeAttribute('src');
    deck.media.load();
    deck.source.disconnect();
    deck.gain.disconnect();
  };

  const desiredMode = () => context.currentTime < combatUntil ? 'combat' : 'explore';
  const nextTrack = (mode, advance = false) => {
    const tracks = mode === 'combat' ? combat : exploration;
    if (mode === 'explore' && advance) explorationIndex++;
    if (mode === 'combat' && advance) combatIndex++;
    const index = mode === 'combat'
      ? (context.currentTime < bossUntil ? 1 : combatIndex) : explorationIndex;
    for (let offset = 0; offset < tracks.length; offset++) {
      const candidate = tracks[(index + offset) % tracks.length];
      if (!failed.has(candidate.id)) return candidate;
    }
    return null;
  };

  const start = (track) => {
    if (!track || destroyed || !audible || pending?.track.id === track.id) return;
    if (pending) dispose(pending);
    if (outgoing) { dispose(outgoing); outgoing = null; }
    const media = createMedia();
    media.preload = 'auto';
    media.src = track.url;
    const source = context.createMediaElementSource(media);
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(gain); gain.connect(destination);
    const deck = { track, media, source, gain };
    pending = deck;
    const failedPlayback = (error) => {
      if (pending === deck) pending = null;
      else if (current === deck) current = null;
      else return;
      dispose(deck);
      // Autoplay denial can be retried by the next user activation.
      if (error?.name === 'NotAllowedError') activationRequired = true;
      else if (error?.name !== 'AbortError') failed.add(track.id);
    };
    media.onerror = failedPlayback;
    media.onended = () => {
      if (current === deck) start(nextTrack(desiredMode(), true));
    };
    media.play().then(() => {
      if (destroyed || pending !== deck) return;
      if (!audible) { pending = null; dispose(deck); return; }
      pending = null;
      outgoing = current;
      current = deck;
      const now = context.currentTime;
      const fade = outgoing ? (track.mode === 'combat' ? 1.8 : 3.5) : 1.5;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + fade);
      if (outgoing) {
        const param = outgoing.gain.gain;
        if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
        else { param.cancelScheduledValues(now); param.setValueAtTime(param.value, now); }
        param.linearRampToValueAtTime(0, now + fade);
        outgoing.retireAt = now + fade;
      }
      lastSwitch = now;
    }).catch(failedPlayback);
  };

  const setAudible = (on) => {
    if (destroyed || audible === !!on) return;
    audible = !!on;
    if (!audible) {
      current?.media.pause();
      if (outgoing) { dispose(outgoing); outgoing = null; }
      if (pending) { const deck = pending; pending = null; dispose(deck); }
    } else if (current) {
      current.media.play().catch(() => { activationRequired = true; });
    } else start(nextTrack(desiredMode()));
  };

  const update = ({ threat = false, boss = false, alive = true } = {}) => {
    if (destroyed) return;
    const now = context.currentTime;
    if (!alive) combatUntil = bossUntil = -Infinity;
    else if (threat) {
      combatUntil = now + 14;
      if (boss) bossUntil = now + 14;
    }
    if (outgoing && now >= outgoing.retireAt) { dispose(outgoing); outgoing = null; }
    if (!audible || pending || activationRequired) return;
    const mode = desiredMode();
    if (!current) { start(nextTrack(mode)); return; }
    const enteringBoss = mode === 'combat' && now < bossUntil && current.track.id !== 'bell';
    if ((current.track.mode !== mode || enteringBoss)
        && (mode === 'combat' || now - lastSwitch >= 5)) {
      if (mode === 'explore') explorationIndex++;
      start(nextTrack(mode));
    } else if (Number.isFinite(current.media.duration)
        && current.media.duration - current.media.currentTime < 3.5
        && now - lastSwitch >= 5) {
      start(nextTrack(mode, true));
    }
  };

  return {
    setAudible,
    update,
    activate() {
      activationRequired = false;
      if (!audible || destroyed) return;
      if (current) current.media.play().catch(() => { activationRequired = true; });
      else start(nextTrack(desiredMode()));
    },
    get state() { return {
      track: current?.track.id || null,
      title: current?.track.title || null,
      mode: current?.track.mode || 'explore',
      playing: !!current && !current.media.paused && audible,
      transitioning: !!pending || !!outgoing,
    }; },
    destroy() {
      destroyed = true;
      dispose(pending); dispose(outgoing); dispose(current);
      pending = outgoing = current = null;
    },
  };
}
