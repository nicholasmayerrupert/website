# Aster expedition presentation

`/game` opens Aster Station inside one continuous Earth world. `frontier.js`
contains the field jobs and sketch-map labels; `react/SandCampaign.jsx` owns
presentation, pause, tracking, and the repair conversation. The engine owns
physical objectives, rewards, terrain, and station repairs. Read
[`../README.md`](../README.md#aster-continuous-earth-expedition) for the runtime map.

The station, western railway, drowned archive, and eastern observatory share
normal world streaming and destruction. No mission transition recreates the
world. The station repair intent preserves changes beyond station grounds.

The current expedition lasts for one browser session. Reloading starts a fresh
valley. The pause menu states this limitation.

`missions.js` and `campaignSave.js` serve the legacy operation catalogue and
its small progression records. The Aster expedition does not read or write those
records. `/game?sandbox` retains the direct survival entry for diagnostics.
