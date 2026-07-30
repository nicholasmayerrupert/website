import {
  ITEM_KIND,
  MISSION,
  MISSION_PHASE,
  OBJECTIVE_KIND,
  OBJECTIVE_STATE,
} from '../wasmBridge/abi.generated.js';

const MISSION_NAMES = Object.freeze({
  [MISSION.GREENFALL_RECOVERY]: 'Operation Greenfall',
  [MISSION.SILENT_QUARRY]: 'Operation Silent Quarry',
  [MISSION.RED_FURNACE]: 'Operation Red Furnace',
});

const OBJECTIVE_LABELS = Object.freeze({
  [OBJECTIVE_KIND.CLEAR]: 'Clear the demolition crew',
  [OBJECTIVE_KIND.RESCUE]: 'Beam out the surveyors',
  [OBJECTIVE_KIND.ANCHOR]: 'Disable the shield anchors',
  [OBJECTIVE_KIND.BOSS]: 'Defeat the facility commander',
  [OBJECTIVE_KIND.CORE]: 'Breach the reactor core',
  [OBJECTIVE_KIND.EXTRACT]: 'Reach the extraction beacon',
});

const HUD_CSS = `
.sg-mission-hud { position:absolute; left:12px; top:62px; z-index:76; width:min(310px,calc(100% - 24px));
  box-sizing:border-box; border:3px solid #080a0c; padding:10px 12px; pointer-events:none;
  background:rgba(23,28,33,.92); color:#fff; box-shadow:inset 0 0 0 2px #4b555e,5px 5px 0 rgba(0,0,0,.48);
  font-family:ui-monospace,"SFMono-Regular","Cascadia Mono","Roboto Mono","Courier New",monospace; }
.sg-mission-kicker { color:#f0d465; font-size:8px; line-height:1; font-weight:900; letter-spacing:.18em; text-transform:uppercase; }
.sg-mission-stage { margin-top:7px; font-size:11px; line-height:1.35; font-weight:900; letter-spacing:.07em; text-transform:uppercase; }
.sg-mission-threat { display:none; margin-top:8px; border-left:4px solid #dc7657; padding:5px 7px;
  background:#3b2320; color:#ffc0a7; font-size:8px; font-weight:900; letter-spacing:.13em; text-transform:uppercase; }
.sg-mission-threat.on { display:block; }
.sg-mission-list { display:grid; gap:4px; margin:9px 0 0; padding:0; list-style:none; }
.sg-mission-objective { display:grid; grid-template-columns:13px 1fr auto; gap:6px; align-items:center;
  color:#9aa4ad; font-size:8px; line-height:1.35; font-weight:800; letter-spacing:.04em; text-transform:uppercase; }
.sg-mission-objective.active { color:#fff; }
.sg-mission-objective.complete { color:#75d39a; }
.sg-mission-objective.failed { color:#dc7657; }
.sg-mission-objective .state { color:#f0d465; text-align:center; }
.sg-mission-objective.complete .state { color:#75d39a; }
.sg-mission-progress { color:#f0d465; font-variant-numeric:tabular-nums; }
.sg-mission-markers { position:absolute; inset:0; z-index:70; overflow:hidden; pointer-events:none; }
.sg-mission-marker { position:absolute; left:0; top:0; display:grid; justify-items:center; min-width:48px;
  color:#f0d465; filter:drop-shadow(2px 2px 0 #080a0c); will-change:transform; }
.sg-mission-marker .arrow { width:0; height:0; border-top:5px solid transparent; border-bottom:5px solid transparent;
  border-left:9px solid currentColor; transform-origin:center; }
.sg-mission-marker .range { margin-top:3px; padding:2px 4px; background:rgba(8,10,12,.78);
  font:900 8px/1 ui-monospace,"SFMono-Regular","Cascadia Mono","Roboto Mono","Courier New",monospace;
  letter-spacing:.06em; white-space:nowrap; }
.sg-mission-marker.onscreen .arrow { width:9px; height:9px; border:2px solid currentColor; box-sizing:border-box;
  background:rgba(240,212,101,.2); transform:rotate(45deg)!important; }
.sg-mission-announcer { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden;
  clip:rect(0,0,0,0); white-space:nowrap; border:0; }
@media (max-width:640px) {
  .sg-mission-hud { top:54px; width:min(250px,calc(100% - 24px)); padding:8px 10px; }
  .sg-mission-list { gap:3px; }
  .sg-mission-objective { font-size:7px; }
}
`;

function objectiveLabel(objective) {
  return OBJECTIVE_LABELS[objective.type] || 'Complete the objective';
}

function activeObjective(snapshot) {
  return snapshot.objectives.find(({ state }) => state === OBJECTIVE_STATE.ACTIVE) || null;
}

export function presentMissionSnapshot(snapshot) {
  const objective = activeObjective(snapshot);
  const progress = objective && objective.required > 1
    ? ` ${objective.current}/${objective.required}`
    : '';
  const recoveredWeaponKinds = [];
  for (let bit = 0; bit < 5; bit++) {
    if (snapshot.recoveredWeaponMask & (1 << bit)) {
      recoveredWeaponKinds.push(ITEM_KIND.DYNAMITE_SATCHEL + bit);
    }
  }
  return {
    ...snapshot,
    missionName: MISSION_NAMES[snapshot.missionId] || 'IRIS Field Operation',
    stageLabel: objective ? `${objectiveLabel(objective)}${progress}` : 'Awaiting extraction',
    recoveredWeaponKinds,
  };
}

export function createMissionHud(root, game) {
  const style = document.createElement('style');
  style.dataset.sandMissionStyle = '';
  style.textContent = HUD_CSS;

  const panel = document.createElement('section');
  panel.className = 'sg-mission-hud';
  const kicker = document.createElement('div');
  kicker.className = 'sg-mission-kicker';
  const stage = document.createElement('div');
  stage.className = 'sg-mission-stage';
  const threat = document.createElement('div');
  threat.className = 'sg-mission-threat';
  const list = document.createElement('ol');
  list.className = 'sg-mission-list';
  panel.append(kicker, stage, threat, list);
  const announcer = document.createElement('div');
  announcer.className = 'sg-mission-announcer';
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('aria-atomic', 'true');

  const markers = document.createElement('div');
  markers.className = 'sg-mission-markers';
  const markerNodes = new Map();
  let snapshot = null;
  let panelSignature = '';
  let raf = 0;

  const syncMarkers = () => {
    const activeIds = new Set();
    for (const objective of snapshot?.objectives || []) {
      if (objective.state !== OBJECTIVE_STATE.ACTIVE) continue;
      activeIds.add(objective.id);
      if (markerNodes.has(objective.id)) continue;
      const marker = document.createElement('div');
      marker.className = 'sg-mission-marker';
      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      const range = document.createElement('span');
      range.className = 'range';
      marker.append(arrow, range);
      markers.appendChild(marker);
      markerNodes.set(objective.id, { marker, arrow, range });
    }
    for (const [id, node] of markerNodes) {
      if (activeIds.has(id)) continue;
      node.marker.remove();
      markerNodes.delete(id);
    }
  };

  const renderMarkers = () => {
    raf = requestAnimationFrame(renderMarkers);
    if (!snapshot || !markerNodes.size) return;
    const view = game.getMissionView?.();
    const width = root.host?.clientWidth || 0;
    const height = root.host?.clientHeight || 0;
    if (!view || !width || !height || !view.viewCols || !view.viewRows) return;
    for (const objective of snapshot.objectives) {
      const node = markerNodes.get(objective.id);
      if (!node) continue;
      const rawX = (objective.worldX - view.cameraWorldX) / view.viewCols * width;
      const rawY = (objective.worldY - view.cameraWorldY) / view.viewRows * height;
      const x = Math.max(26, Math.min(width - 26, rawX));
      const y = Math.max(54, Math.min(height - 64, rawY));
      const onscreen = rawX >= 26 && rawX <= width - 26 &&
        rawY >= 54 && rawY <= height - 64;
      const angle = Math.atan2(rawY - height * 0.5, rawX - width * 0.5);
      node.marker.classList.toggle('onscreen', onscreen);
      node.marker.style.transform = `translate(${Math.round(x - 24)}px,${Math.round(y - 12)}px)`;
      node.arrow.style.transform = `rotate(${angle}rad)`;
      const dx = Number.isFinite(view.playerWorldX)
        ? objective.worldX - view.playerWorldX
        : objective.worldX - (view.cameraWorldX + view.viewCols * 0.5);
      const dy = Number.isFinite(view.playerWorldY)
        ? objective.worldY - view.playerWorldY
        : objective.worldY - (view.cameraWorldY + view.viewRows * 0.5);
      node.range.textContent = `${Math.round(Math.hypot(dx, dy))}m`;
    }
  };

  const update = (next) => {
    snapshot = next;
    const nextPanelSignature = `${next.missionName}:${next.phase}:${next.threatLevel}:` +
      `${next.stageLabel}:` +
      next.objectives.map(({ id, state, current, required }) =>
        `${id},${state},${current},${required}`).join('|');
    if (nextPanelSignature === panelSignature) {
      syncMarkers();
      return;
    }
    panelSignature = nextPanelSignature;
    kicker.textContent = next.missionName;
    stage.textContent = next.stageLabel;
    threat.classList.toggle('on', next.phase === MISSION_PHASE.EXTRACTION);
    threat.textContent = next.threatLevel
      ? `Threat spike ${next.threatLevel} · ${
        next.missionId === MISSION.RED_FURNACE
          ? 'terrain unstable'
          : 'hostile reinforcements inbound'
      }`
      : '';
    list.replaceChildren();
    for (const objective of next.objectives) {
      const row = document.createElement('li');
      const stateName = objective.state === OBJECTIVE_STATE.COMPLETE
        ? 'complete'
        : objective.state === OBJECTIVE_STATE.FAILED
          ? 'failed'
          : objective.state === OBJECTIVE_STATE.ACTIVE ? 'active' : 'locked';
      row.className = `sg-mission-objective ${stateName}`;
      const icon = document.createElement('span');
      icon.className = 'state';
      icon.textContent = objective.state === OBJECTIVE_STATE.COMPLETE
        ? '✓'
        : objective.state === OBJECTIVE_STATE.FAILED ? '×' : objective.state === OBJECTIVE_STATE.ACTIVE ? '◆' : '·';
      const label = document.createElement('span');
      label.textContent = objectiveLabel(objective);
      const progress = document.createElement('span');
      progress.className = 'sg-mission-progress';
      progress.textContent = objective.required > 1
        ? `${objective.current}/${objective.required}`
        : '';
      row.append(icon, label, progress);
      list.appendChild(row);
    }
    announcer.textContent = `${next.missionName}. ${next.stageLabel}`;
    syncMarkers();
  };

  root.append(style, panel, announcer, markers);
  raf = requestAnimationFrame(renderMarkers);

  return {
    update,
    destroy() {
      cancelAnimationFrame(raf);
      markers.remove();
      panel.remove();
      announcer.remove();
      style.remove();
    },
  };
}
