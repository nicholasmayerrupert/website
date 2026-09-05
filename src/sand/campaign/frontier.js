export const FRONTIER_JOBS = Object.freeze([
  {
    id: 0, title: 'The buried pass', place: 'West · Old railway', color: '#dcaa70',
    summary: 'Clear the railway rockfall.',
    description: 'A rockfall has sealed the old railway beneath the western ridge. Cut a person-sized passage through the collapse, then reach the geological instrument on the far side.',
    hint: 'Mine a careful tunnel, blast the obstruction, or excavate a working gallery above it. The opening must be tall enough to walk through.',
    reward: 'Bore cannon · 30 rounds', symbol: '01',
    mapX: 110, mapY: 190,
  },
  {
    id: 1, title: 'The drowned archive', place: 'Below · Karst chambers', color: '#73c6bd',
    summary: 'Drain the archive chamber.',
    description: 'A flooded archive lies beneath the station. Drain most of its main chamber and reach the luminous archive console on the lower floor.',
    hint: 'The service adit leaves engineering to the west. There is a dry cavern beneath the archive: water needs somewhere to go. Your buildings and excavations can direct it.',
    reward: 'Construction reserve · 960 blocks', symbol: '02',
    mapX: 230, mapY: 310,
  },
  {
    id: 2, title: 'Windward Observatory', place: 'East · Windward Observatory', color: '#d7dcad',
    summary: 'Reach the observatory instrument.',
    description: 'Climb the eastern highlands and reach the instrument at the top of Windward Observatory. Its antenna rises well above the mountain summit.',
    hint: 'Build footholds into the slope. Rest on the tower’s staggered landings to recharge your jetpack. You can also cut a staircase through the mountain.',
    reward: 'Dynamite satchel · 24 charges', symbol: '03',
    mapX: 545, mapY: 65,
  },
  {
    id: 3, title: 'Report to Vale', place: 'Home · Aster Station', color: '#edca7b',
    summary: 'Return to the station.',
    description: 'Return to Commander Vale on the concourse after completing the three field jobs. The station and the world remain yours to explore and alter.',
    hint: 'Aster Station is at the center of the valley. Osei can rebuild the station when it is damaged.',
    reward: 'First expedition complete', symbol: '⌂',
    mapX: 345, mapY: 167,
  },
]);
