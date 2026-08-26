# IRIS campaign shell

`/game` begins aboard the physical IRIS ship *Kestrel*. The ship is its own
walkable `<sand-game planet="ship">` world with a protected authored hull,
decks, rooms, transporter, and crew. React layers the mission terminal,
briefing/loadout selection, deployment transition, and debrief over that world.
A planetary deployment replaces the ship runtime with the mission runtime, so
each transition tears down the prior worker, RAF, audio graph, and WebGL target.
The terminal is closed by default and opens only from Commander Vale's
world-space `TALK` conversation. It is a viewport-bounded console with its
deploy action fixed in the header, leaving the Kestrel unobstructed between
briefings.

`missions.js` contains display metadata and the bounded field-supply catalog.
Simulation policy still belongs to C++: the mission id selects world generation,
gravity, actors, objectives, extraction, and marker behavior.

`campaignSave.js` persists small, versioned progression data under
`sand-campaign-v1`. It stores completed missions, unlocked recovered weapons,
preferred loadouts, and best times. An interrupted deployment stores only its
mission configuration and seed; terrain and actor state are not a resumable save.
Progress and recovered equipment commit only after an authoritative mission
completion event.

`/game?sandbox` keeps the direct survival entry for focused engine and browser
diagnostics.
