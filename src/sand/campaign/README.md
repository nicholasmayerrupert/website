# IRIS campaign shell

`/game` begins aboard the IRIS ship *Kestrel*. React owns the ship terminal,
briefing/loadout selection, deployment transition, and debrief. A mission mounts
the framework-free `<sand-game>` runtime; returning to the ship unmounts it, so
its worker, RAF, audio graph, and WebGL target use the existing teardown path.

`missions.js` contains display metadata and the bounded field-supply catalog.
Simulation policy still belongs to C++: the mission id selects world generation,
gravity, actors, objectives, extraction, and marker behavior.

`campaignSave.js` persists small, versioned progression data under
`sand-campaign-v1`. It stores completed missions, unlocked recovered weapons,
preferred loadouts, and best times. An interrupted deployment stores only its
mission configuration and seed; terrain and actor state are not a resumable save.
Progress and recovered equipment commit only after an authoritative mission
completion event.

`/game?sandbox` keeps the previous direct survival entry for focused engine,
browser, and multiplayer diagnostics.
