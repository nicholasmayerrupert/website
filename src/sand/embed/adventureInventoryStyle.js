export const ADVENTURE_INVENTORY_STYLE = `
.ad-chest-prompt {pointer-events:none}
.pool-heading-row {display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px}
.pool-heading-row .pool-heading {margin:0!important}.pool-heading-row button {font-size:11px;color:#d7c28e}
.pool-select-label {display:flex;align-items:center;gap:12px}.pool-controls[hidden],.pool-sorting[hidden],.pool-summary[hidden],.pool-empty[hidden]{display:none!important}
.pool-empty {display:grid;place-items:center;min-height:150px;color:#9ba991;font-size:14px!important;border:1px dashed #7c855237;margin:20px 0 4px!important}
.pool-sorting {margin-top:14px;border-top:1px solid #7c855237;padding-top:12px;font-size:12px}
.pool-sorting summary {cursor:pointer;color:#bfc7ab;margin-bottom:10px}.pool-sorting label{display:inline-flex;align-items:center;gap:8px;margin-right:12px}
.ad-inventory .pool-tabs {border-bottom:1px solid #7c855237;padding-bottom:12px;gap:8px}
.ad-inventory .pool-tabs button {border:0;border-bottom:2px solid transparent}.ad-inventory .pool-tabs button[aria-pressed=true]{border-bottom-color:#d1b979;color:#e4d4a4}
.ad-inventory .pool-heading-row button:disabled {visibility:hidden}
.ad-inventory .inv-pools {padding:16px!important}.ad-inventory .pool-summary {margin:8px 0 18px!important}
.inv-hud:not(.open)>.ad-equipment,.inv-hud:not(.open)>.inv-pack-heading,.inv-hud:not(.open)>.ad-footprint,.inv-hud:not(.open)>.inv-bag-shortcuts {display:none}
:host([mission="frontier"]) .ad-inventory *,:host([mission="frontier"]) .item-tooltip * {font-family:'Sand Pixel',monospace!important}
:host([mission="frontier"]) .ad-inventory h2,:host([mission="frontier"]) .ad-inventory .craft-title,:host([mission="frontier"]) .item-tooltip strong {font-family:'Sand Pixel',monospace!important}
.ad-sheet[data-page="inventory"] {width:min(900px,100%);height:min(720px,calc(100dvh - 56px))}
.ad-sheet[data-page="inventory"]>header {padding:14px 22px}
.ad-sheet[data-page="inventory"] .ad-wordmark {font:22px 'Sand Pixel',monospace;color:#e3d4ac}
.ad-inventory {padding:22px;scrollbar-color:#706b50 #16221c}
.ad-inventory .inv-hud {display:grid;grid-template-columns:224px minmax(0,1fr);gap:10px 22px;
  align-items:start;max-width:none;max-height:none;font:14px/1.4 'Sand Pixel',monospace;color:#d9dece;pointer-events:auto}
.ad-inventory .inv-modal {display:contents!important;overflow:visible!important}
.ad-inventory .inv-modal-header,.ad-inventory .inv-toast,.ad-inventory .inv-pool-active {display:none}
.ad-inventory h2 {font:19px/1.2 'Sand Pixel',monospace;margin:0;color:#e1d7b6}
.ad-inventory .inv-pack-heading {grid-column:2;grid-row:1;display:flex;align-items:center;justify-content:space-between;min-height:24px}
.ad-inventory .inv-capacity {color:#9ba794;font-size:12px;font-variant-numeric:tabular-nums}
.ad-inventory .inv-grid {grid-column:2;grid-row:2;display:grid;grid-template-columns:repeat(9,minmax(0,1fr));
  gap:5px!important;padding:8px!important;align-content:start;justify-items:stretch;background:#122019!important;
  border:1px solid #62664a!important;box-shadow:inset 0 1px 4px #0005}
.ad-inventory .inv-slot,.ad-inventory .inv-grid .inv-slot {width:100%;height:auto;aspect-ratio:1;min-width:0;
  padding:0;border:1px solid #58604a;background:linear-gradient(145deg,#29372a,#18271e);box-shadow:inset 1px 1px #8c99721a;
  transform:none;border-radius:2px;overflow:hidden}
.ad-inventory .inv-slot:hover {background:#384633;border-color:#b4bd8b;transform:none}
.ad-inventory .inv-slot.selected {border-color:#e4c782;box-shadow:inset 0 0 0 1px #e4c78277;background:#414b2d;transform:none}
.ad-inventory .inv-slot svg {width:70%;height:70%;max-width:40px;max-height:40px;filter:drop-shadow(1px 2px 0 #0007)}
.ad-inventory .inv-slot:focus-visible {outline:2px solid #f1d59a;outline-offset:2px}
.ad-inventory .inv-slot::after,.ad-inventory .inv-bar::after {display:none}
.ad-inventory .inv-bag-label {display:none}.ad-inventory .inv-pool-mark {font-size:11px;color:#bcccaa}
.ad-inventory .inv-num {font:12px 'Sand Pixel',monospace;left:3px;top:2px;background:none;color:#c6c9ad}
.ad-inventory .inv-count {font:bold 14px 'Sand Pixel',monospace;right:3px;bottom:1px;text-shadow:1px 1px 2px #000,-1px -1px #000}
.ad-inventory .inv-tier {font:12px 'Sand Pixel',monospace}
.ad-inventory .inv-bar {grid-column:2;grid-row:3;order:0;grid-template-columns:repeat(9,minmax(0,1fr));gap:5px;padding:8px;
  width:100%;box-sizing:border-box;margin:0;background:#19281e;border:1px solid #9f8853;box-shadow:none}
.ad-inventory .ad-equipment {grid-column:1;grid-row:1/6;margin:0;padding:0 16px 0 0;border-right:1px solid #cfb98126;align-self:stretch}
.ad-paperdoll {display:grid;grid-template-columns:54px minmax(0,1fr) 54px;grid-template-rows:repeat(3,76px) 76px;gap:8px;margin:18px 0}
.ad-character {grid-column:2;grid-row:1/4;align-self:center;justify-self:center;width:80px;height:110px;image-rendering:pixelated;filter:drop-shadow(0 6px 5px #0005)}
.ad-gear-slot {display:flex;flex-direction:column;align-items:center;gap:5px;font:12px 'Sand Pixel',monospace;color:#aab69f}
.ad-gear-slot button {flex-shrink:0}.ad-gear-slot .ad-empty-gear svg {opacity:.18;filter:grayscale(1)}
.ad-gear-slot .ad-can-equip {border-color:#c3d696!important;box-shadow:inset 0 0 0 1px #c3d69688!important;background:#3b4e2c!important}
.ad-gear-head{grid-area:1/1}.ad-gear-torso{grid-area:2/1}.ad-gear-legs{grid-area:3/1}
.ad-gear-hands{grid-area:1/3}.ad-gear-boots{grid-area:2/3}.ad-gear-cloak{grid-area:3/3}
.ad-gear-offhand{grid-area:4/1}.ad-gear-charm1{grid-area:4/2;width:54px;justify-self:center}.ad-gear-charm2{grid-area:4/3}
.ad-character-stats {display:grid;grid-template-columns:1fr auto;gap:9px 8px;margin:18px 0 0;padding-top:16px;border-top:1px solid #cfb98126;font-size:14px}
.ad-character-stats dt {color:#aab69f}.ad-character-stats dd {margin:0;color:#e1d7b6;font-variant-numeric:tabular-nums}
.ad-inventory .craft-panel {grid-column:2;grid-row:4;max-height:200px;padding:0;overflow:auto;background:none;border:0;box-shadow:none}
.ad-inventory .craft-title {font:17px 'Sand Pixel',monospace;letter-spacing:0;margin:3px 0 10px;padding:0;border:0;color:#e1d7b6}
.ad-inventory .craft-list {grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.ad-inventory .craft-recipe {position:relative;grid-template-columns:32px minmax(0,1fr);padding:8px;border:1px solid #5b6349;
  background:#233125;box-shadow:none;font:12px/1.35 'Sand Pixel',monospace;gap:9px;color:#dce2d0}
.ad-inventory .craft-recipe:hover {border-color:#afad76;background:#30412b}
.ad-inventory .craft-recipe[aria-disabled="true"] {background:#1a281f;border-color:#3c4938;color:#b5bdac}
.ad-inventory .craft-output {position:relative;width:30px;height:30px;border:0;background:transparent}
.ad-inventory .craft-output svg {width:28px;height:28px}.ad-inventory .craft-cost {font-size:10px;color:#9eab93;line-height:1.3}
.ad-inventory .craft-name {font-size:12px}.ad-inventory .craft-count {display:none}
.ad-inventory .inv-pools {display:none;grid-column:2;grid-row:2/5;padding:12px;border:1px solid #62664a;background:#17261c}
.ad-inventory .bag-open .inv-pools {display:block}.ad-inventory .bag-open .inv-grid,.ad-inventory .bag-open .craft-panel {display:none}
.ad-inventory .bag-open .inv-bar {grid-row:5}
.ad-inventory .inv-bag-shortcuts {grid-column:2;grid-row:5;display:flex;flex-wrap:wrap;gap:6px}
.ad-inventory .inv-bag-shortcuts button {display:flex;align-items:center;gap:7px;padding:6px 9px;border:1px solid #5a6449;font-size:12px;color:#c6cfb9}
.ad-inventory .bag-open .inv-bag-shortcuts {display:none}
.ad-inventory .inv-bag-return {margin-bottom:12px;color:#e4cc93;border:0;padding:0;font-size:12px}
.ad-inventory .pool-tabs button {font-size:13px;padding:5px}.ad-inventory .pool-tabs svg {width:16px}
.ad-inventory .pool-heading {font-size:16px;margin-top:10px}.ad-inventory .pool-summary {font-size:13px;margin:5px 0 12px}
.ad-inventory .pool-row {grid-template-columns:16px 20px 16px minmax(75px,1fr) auto 24px 24px 36px;gap:5px;font-size:11px;border-top:1px solid #ffffff08;padding:9px 0}
.ad-inventory .pool-status span,.ad-inventory .pool-properties {display:none}.ad-inventory .pool-controls{font-size:11px}
.ad-inventory .ad-footprint {grid-column:2;grid-row:6;margin:0;font:12px 'Sand Pixel',monospace;color:#aab69f}
.ad-inventory .ad-footprint select {padding:4px 8px}
.ad-inventory .ad-loot {grid-column:1/-1;padding:12px;margin:0 0 10px;border:1px solid #8d7c51;background:#243123}
.ad-inventory .ad-loot h2 {font-size:18px}.ad-inventory .ad-loot>button {font:13px 'Sand Pixel',monospace}
.ad-sheet[data-page="inventory"]>footer {font:12px/1.5 'Sand Pixel',monospace;padding:10px 22px}
:host([mission="frontier"]) .ad-sheet[data-page="inventory"]>footer * {font-family:'Sand Pixel',monospace!important}
@media(max-width:760px) {
  .ad-sheet[data-page="inventory"] {height:calc(100dvh - 20px)}.ad-inventory{padding:16px}
  .ad-inventory .inv-hud{grid-template-columns:minmax(0,1fr);gap:12px}
  .ad-inventory .ad-equipment{grid-column:1;grid-row:1;display:grid;grid-template-columns:1fr 1fr;column-gap:20px;padding:0 0 14px;border-right:0;border-bottom:1px solid #cfb98126}
  .ad-inventory .ad-equipment h2{grid-column:1/-1}.ad-paperdoll{grid-column:1;grid-row:2;grid-template-columns:38px minmax(44px,1fr) 38px;grid-template-rows:repeat(3,53px) 53px;gap:4px;margin:12px 0 0}
  .ad-character{width:64px;height:88px}.ad-gear-slot{font-size:11px;gap:2px}.ad-gear-charm1{width:38px}
  .ad-character-stats{grid-column:2;grid-row:2;align-self:center;margin:0;padding:0;border:0;font-size:11px;gap:10px}
  .ad-inventory .inv-pack-heading{grid-column:1;grid-row:2}.ad-inventory .inv-grid{grid-column:1;grid-row:3;padding:6px!important;gap:3px!important}
  .ad-inventory .inv-bar{grid-column:1;grid-row:4;padding:6px;gap:3px}.ad-inventory .craft-panel{grid-column:1;grid-row:5;max-height:none}
  .ad-inventory .inv-pools{grid-column:1;grid-row:3/5}.ad-inventory .bag-open .inv-bar{grid-column:1;grid-row:5}
  .ad-inventory .ad-footprint{grid-column:1;grid-row:6}.ad-inventory .inv-count{font-size:10px}.ad-inventory .inv-num{font-size:8px}
  .ad-inventory .inv-bag-shortcuts{grid-column:1;grid-row:6}.ad-inventory .ad-footprint{grid-row:7}
  .ad-inventory .pool-row{grid-template-columns:12px 16px 12px minmax(55px,1fr) auto 22px 22px 30px;gap:3px;font-size:10px}
  .ad-inventory .pool-row button{font-size:10px;padding:3px}.ad-inventory .pool-controls{gap:8px}
  .ad-inventory .craft-list{grid-template-columns:1fr}.ad-sheet[data-page="inventory"]>footer{font-size:10px;padding:8px 16px}
}
`;
