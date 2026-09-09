// Original, locally served compositions. Media elements stream the long cues;
// the effects bank never decodes the entire soundtrack at startup.
export const SCORE_TRACKS = Object.freeze([
  { id: 'hearth', title: 'A Light Left in the Window', mode: 'explore',
    url: new URL('./score/hearth.mp3', import.meta.url).href },
  { id: 'canopy', title: 'Where the Leaves Remember', mode: 'explore',
    url: new URL('./score/canopy.mp3', import.meta.url).href },
  { id: 'hollows', title: 'The Earth Keeps Its Stars', mode: 'explore',
    url: new URL('./score/hollows.mp3', import.meta.url).href },
  { id: 'afterglow', title: 'All the Roads Lead Home', mode: 'explore',
    url: new URL('./score/afterglow.mp3', import.meta.url).href },
  { id: 'embers', title: 'Carry the Flame', mode: 'combat',
    url: new URL('./score/embers.mp3', import.meta.url).href },
  { id: 'bell', title: 'Against the Hollow Bell', mode: 'combat',
    url: new URL('./score/bell.mp3', import.meta.url).href },
]);
