export const ADVENTURE_INVENTORY_STYLE = `
.ad-chest-grid {display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px;max-width:420px;margin:10px 0}
.ad-chest-grid .inv-slot {position:relative;display:flex;align-items:center;justify-content:center;min-width:0;aspect-ratio:1;background:#14231e;border:1px solid #738066;color:#eee0bd;cursor:pointer}
.ad-chest-grid .inv-slot:hover,.ad-chest-grid .inv-slot:focus-visible {outline:2px solid #e4ce90;outline-offset:1px;background:#344831}
.ad-loot.carrying .ad-chest-grid .inv-slot {border-color:#baab76}
.ad-chest-grid .inv-swatch {width:24px;height:24px;border:1px solid #ffffff40}
.ad-chest-grid .inv-count {position:absolute;right:3px;bottom:2px;font:12px 'Sand Pixel',monospace;text-shadow:1px 1px #000}
@media(max-width:560px){.ad-chest-grid{grid-template-columns:repeat(6,minmax(0,1fr))}.ad-loot{padding:12px}.ad-chest-grid .inv-slot{min-height:40px}}
.ad-chest-highlight {position:absolute;pointer-events:none;border:2px solid #f4df9a;background:#ffe7a822;box-shadow:0 0 0 1px #302b1f;z-index:75}
.ad-chest-highlight[hidden] {display:none}
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

.wand-header {display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.wand-header .game-select {max-width:100%}.wand-header .game-select>button {font-size:12px!important}
.ad-wands .wand-mana {margin:12px 0 7px;color:#bfd5ff;font-size:13px;font-variant-numeric:tabular-nums}
.ad-wands .wand-mana.blocked {color:#efad93}
.ad-wands .wand-help {margin:0 0 15px;font-size:11px;line-height:1.6;color:#aab9b5}
.ad-wands h3 {margin:14px 0 7px;font:12px 'Sand Pixel',monospace;color:#d8d6b9}
.wand-spells,.wand-upgrades {display:flex;gap:7px;align-items:start}
.wand-place {flex:1;min-width:0}
.ad-inventory .wand-socket {position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;min-height:82px;padding:8px 3px;border:1px solid #74795e;background:#293629;color:#e0dcc4;cursor:pointer;font:11px/1.3 'Sand Pixel',monospace}
.ad-inventory .wand-socket.upgrade {border-color:#697c99;background:#253344;color:#cedaf1}
.ad-inventory .wand-socket.empty {border-style:dashed;background:#172620;color:#81978f}
.ad-inventory .wand-socket small {position:absolute;top:3px;left:4px;color:#919e92;font-size:10px}
.ad-inventory .wand-socket .wand-icon {height:34px;display:grid;place-items:center}.ad-inventory .wand-socket .wand-socket-name {margin-top:5px;min-height:14px;text-align:center}
.ad-inventory .wand-socket.next {border-color:#f2d390;box-shadow:inset 0 -2px #f2d390}
.ad-inventory .wand-socket.accepts {border-color:#bde1a6;background:#344d37}
.ad-inventory .wand-socket:disabled {opacity:.45;cursor:default}
.ad-inventory .wand-socket:hover:not(:disabled),.ad-inventory .wand-socket:focus-visible {outline:2px solid #d6d8a0;outline-offset:1px}
.wand-place .game-select {display:block;min-width:0;margin-top:6px}
.wand-place .game-select>button {font-size:9px!important;padding:6px 4px!important;gap:4px}
.ad-wands .wand-preview {margin:14px 0 0;padding-top:10px;border-top:1px solid #849c8d33;font-size:11px;line-height:1.7;color:#d1dcbf}

:host([mission="frontier"]) .ad-inventory * {font-family:'Sand Pixel',monospace!important}
.inv-hud:not(.open) .inv-pack {display:contents}
.inv-hud:not(.open) .inv-pack>:not(.inv-bar),.inv-hud:not(.open)>.inv-work-tabs,.inv-hud:not(.open)>.inv-work,.inv-hud:not(.open)>.inv-inspector,.inv-hud:not(.open)>.inv-drop-zone {display:none}
.ad-sheet[data-page="inventory"] {width:min(1080px,100%);height:min(820px,calc(100dvh - 56px))}
.ad-sheet[data-page="inventory"]>header {padding:16px 24px}
.ad-sheet[data-page="inventory"] .ad-wordmark {font:22px 'Sand Pixel',monospace;color:#eadbb4}
.ad-inventory {padding:0!important;scrollbar-color:#706b50 #16221c}
.ad-inventory .inv-hud {display:grid!important;grid-template-columns:minmax(0,1.45fr) minmax(330px,1fr);grid-template-rows:auto minmax(0,1fr) auto;height:100%;gap:0;align-items:start;max-width:none;max-height:none;font:13px/1.5 'Sand Pixel',monospace;color:#d9dece;pointer-events:auto}
.ad-inventory .inv-modal {display:contents!important}
.ad-inventory .inv-modal-header,.ad-inventory .inv-toast,.ad-inventory .inv-pool-active,.ad-inventory .inv-hint {display:none!important}
.ad-inventory [hidden] {display:none!important}
.ad-inventory h2 {font:20px/1.2 'Sand Pixel',monospace;margin:0;color:#eadbb4}
.ad-inventory h3 {font:14px 'Sand Pixel',monospace}
.ad-inventory button {border-radius:2px;transition:background .12s,border-color .12s}
.ad-inventory button:focus-visible,.ad-inventory input:focus-visible {outline:2px solid #f1d59a;outline-offset:2px}
.ad-inventory .inv-work-tabs {grid-column:1/-1;display:flex;gap:4px;padding:10px 24px 0;background:#122019;border-bottom:1px solid #8c815d55;position:sticky;top:0;z-index:4}
.ad-inventory .inv-work-tabs button {padding:12px 18px;border:0;border-bottom:3px solid transparent;font-size:13px;color:#acb9a7;background:none}
.ad-inventory .inv-work-tabs button[aria-pressed=true] {color:#f1d59a;border-color:#d6b879;background:#a79d6810}
.ad-inventory .inv-work-tabs button[data-section=pack] {display:none}
.ad-inventory .inv-pack {grid-column:1;grid-row:2;padding:18px 24px;min-width:0;min-height:0;max-height:100%;overflow:auto;box-sizing:border-box}
.ad-inventory .inv-work {grid-column:2;grid-row:2;align-self:stretch;min-width:0;min-height:0;overflow:auto;padding:18px 22px 20px;border-left:1px solid #a79d6833;background:#111f194d}
.ad-inventory .inv-pack-heading {display:flex;align-items:center;gap:10px;margin-bottom:10px}
.ad-inventory .inv-capacity {margin-left:auto;font-size:12px;color:#a4b29d}
.ad-inventory .inv-pack-heading button {padding:7px 10px;border:1px solid #67714e;font-size:12px;background:#293729}
.ad-inventory .inv-search-row {display:flex;gap:8px;position:relative}
.ad-inventory .inv-search {box-sizing:border-box;width:100%;min-width:0;padding:8px 34px 8px 12px;border:1px solid #56634c;background:#0f1c16;color:#e1e4d7;border-radius:2px;font:13px 'Sand Pixel',monospace}
.ad-inventory .inv-search-row .inv-search::-webkit-search-cancel-button {-webkit-appearance:none}
.ad-inventory .inv-search::placeholder {color:#93a38f;opacity:1}
.ad-inventory .inv-search-row>button {position:absolute;right:4px;top:3px;padding:6px 9px;border:0;font-size:18px}
.ad-inventory .inv-filters {display:flex;align-items:center;gap:6px;margin:7px 0 10px}
.ad-inventory .inv-filters button {font-size:12px;padding:5px 10px;border:1px solid transparent;color:#a7b79d}
.ad-inventory .inv-filters button[aria-pressed=true] {color:#e9dfba;border-color:#8c8e61;background:#35422c}
.ad-inventory .inv-search-result {margin-left:auto;color:#d6c58f;font-size:11px}
.ad-inventory .inv-grid {display:grid!important;grid-template-columns:repeat(9,minmax(0,1fr));gap:5px!important;padding:8px!important;background:#0e1a14!important;border:1px solid #586349!important;box-shadow:inset 0 1px 5px #0005;max-width:none!important}
.ad-inventory .inv-slot,.ad-inventory .inv-grid .inv-slot {position:relative;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:100%!important;height:auto!important;aspect-ratio:1;min-width:0;padding:0;border:1px solid #49563f;background:linear-gradient(145deg,#29372a,#1b291f);box-shadow:inset 1px 1px #9fae7812;transform:none;border-radius:2px;overflow:hidden}
.ad-inventory .inv-slot:hover,.ad-inventory .inv-slot.inv-inspected {background:#3d4931;border-color:#c6bb83;transform:none}
.ad-inventory .inv-slot.selected {border-color:#e4c782;box-shadow:inset 0 -3px #e4c782;background:#414b2d;transform:none}
.ad-inventory .inv-slot svg {width:72%;height:72%;max-width:40px;max-height:40px;filter:drop-shadow(1px 2px 0 #0007)}
.ad-inventory .inv-slot::after,.ad-inventory .inv-bar::after {display:none}
.ad-inventory .inv-slot.inv-filter-dim>svg,.ad-inventory .inv-slot.inv-filter-dim>.inv-swatch {opacity:.22}
.ad-inventory .inv-slot.inv-filter-match {border-color:#d1c681;background:#485031}
.ad-inventory .inv-bag-label {display:none}.ad-inventory .inv-pool-mark {font-size:11px;color:#bcccaa}
.ad-inventory .inv-num {font:11px 'Sand Pixel',monospace;left:3px;top:1px;background:none;color:#c6c9ad}
.ad-inventory .inv-count {position:absolute;font:12px 'Sand Pixel',monospace;right:3px;bottom:1px;text-shadow:1px 1px 2px #000,-1px -1px #000}
.ad-inventory .inv-tier {font:11px 'Sand Pixel',monospace}
.ad-inventory .inv-quick-heading {display:flex;justify-content:space-between;align-items:center;margin:12px 0 6px;color:#bcb691}
.ad-inventory .inv-quick-heading h3 {margin:0;color:#e4d5ad}.ad-inventory .inv-quick-heading span {font-size:11px;color:#9da993}
.ad-inventory .inv-bar {display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:5px;padding:8px;width:100%;box-sizing:border-box;margin:0;background:#1e2c20;border:1px solid #9f8853;box-shadow:none}
.ad-inventory .inv-bag-shortcuts {display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:12px 0 0}
.ad-inventory .inv-bag-shortcuts>span {width:100%;font-size:11px;color:#9dac96;margin-bottom:2px}
.ad-inventory .inv-bag-shortcuts button {display:flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid #566348;font-size:11px;color:#c6cfb9;background:#233224}
.ad-inventory .inv-inspector {grid-column:1/-1;display:flex;align-items:center;gap:14px;padding:15px 24px;background:#253225;border-top:1px solid #8d845d55;min-height:70px;box-sizing:border-box}
.ad-inventory .inv-inspect-icon {position:relative;display:grid;place-items:center;width:42px;min-width:42px;height:42px;border:1px solid #66704d;background:#18271c}
.ad-inventory .inv-inspect-text {flex:1;min-width:0}.ad-inventory .inv-inspect-text strong {font-size:15px;color:#ead4a2}.ad-inventory .inv-inspect-text p {font-size:11px;color:#b1bea6;margin:5px 0 0}
.ad-inventory .inv-item-actions {display:flex;gap:6px;flex-wrap:wrap}.ad-inventory .inv-item-actions button {font-size:11px;padding:8px 10px;border:1px solid #879366;background:#34462f}
.ad-inventory .inv-inspector.carrying {background:#39422a}
.ad-inventory .inv-drop-zone:not(.carrying) {display:none}
.ad-inventory .inv-drop-zone {grid-column:1/-1;display:flex;align-items:center;gap:8px;padding:10px 24px;border-top:1px solid #8d845d33;font-size:11px;color:#9dac96;background:#16241b}
.ad-inventory .inv-drop-zone span {flex:1}.ad-inventory .inv-drop-zone button {font-size:11px;padding:7px 10px;border:1px solid #8b7657;color:#d5c39f}
.ad-inventory .inv-drop-zone button:disabled,.ad-inventory .inv-pack-heading button:disabled {opacity:.35;cursor:default}.ad-inventory .inv-drop-zone.carrying {background:#3a3524;border-color:#b49a65}
.ad-inventory .ad-equipment {margin:0;padding:0;border:0}
.ad-paperdoll {display:grid;grid-template-columns:64px minmax(0,1fr) 64px;grid-template-rows:repeat(4,68px);gap:8px;margin:14px 14px}
.ad-character {grid-column:2;grid-row:1/4;align-self:center;justify-self:center;width:96px;height:132px;image-rendering:pixelated;filter:drop-shadow(0 10px 6px #0006)}
.ad-gear-slot {display:flex;flex-direction:column;align-items:center;gap:4px;font:11px 'Sand Pixel',monospace;color:#aab69f}
.ad-gear-slot button {flex-shrink:0;max-width:54px}.ad-gear-slot .ad-empty-gear svg {opacity:.18;filter:grayscale(1)}
.ad-gear-slot .ad-can-equip {border-color:#c3d696!important;box-shadow:inset 0 0 0 1px #c3d69688!important;background:#3b4e2c!important}
.ad-gear-head{grid-area:1/1}.ad-gear-torso{grid-area:2/1}.ad-gear-legs{grid-area:3/1}.ad-gear-hands{grid-area:1/3}.ad-gear-boots{grid-area:2/3}.ad-gear-cloak{grid-area:3/3}.ad-gear-offhand{grid-area:4/1}.ad-gear-charm1{grid-area:4/2;width:64px;justify-self:center}.ad-gear-charm2{grid-area:4/3}
.ad-character-stats {display:grid;grid-template-columns:1fr auto;gap:8px;margin:12px 0 0;padding:14px 0 0;border-top:1px solid #cfb98126;font-size:12px}.ad-character-stats dt {color:#aab69f}.ad-character-stats dd {margin:0;color:#e1d7b6}
.ad-inventory .ad-wands {display:block;padding:0;margin:0;border:0;background:none}.ad-wands {display:none}
.ad-inventory .ad-wands .wand-mana {margin:16px 0 8px;color:#bfd5ff;font-size:12px}.ad-inventory .ad-wands .wand-mana.blocked {color:#efad93}
.ad-inventory .ad-wands .wand-help {margin:0 0 18px;font-size:11px;line-height:1.7;color:#aab9b5}
.ad-inventory .ad-wands h3 {margin:12px 0 6px;color:#d8d6b9}
.ad-inventory .craft-panel {display:block!important;padding:0;max-height:none;overflow:visible;background:none;border:0;box-shadow:none}
.ad-inventory .craft-title {font:20px 'Sand Pixel',monospace;letter-spacing:0;margin:0 0 16px;padding:0;border:0;color:#eadbb4}
.ad-inventory .inv-craft-controls label {display:flex;align-items:center;gap:8px;font-size:12px;color:#bac6ad;margin:12px 0 16px}.ad-inventory input[type=checkbox] {accent-color:#b9be83}
.ad-inventory .craft-list {display:grid;grid-template-columns:1fr;gap:7px;max-height:360px;overflow:auto;padding:2px}
.ad-inventory .craft-recipe {position:relative;display:grid;grid-template-columns:36px minmax(0,1fr) auto;padding:10px;border:1px solid #71815a;background:#2f402b;box-shadow:none;font:12px/1.5 'Sand Pixel',monospace;gap:10px;color:#e0e6d4;text-align:left}
.ad-inventory .craft-recipe:hover {border-color:#bfbb80;background:#3a4b31}.ad-inventory .craft-recipe[aria-disabled=true] {background:#1a281f;border-color:#3c4938;color:#b5bdac}
.ad-inventory .craft-output {position:relative;width:32px;height:32px;border:0;background:none}.ad-inventory .craft-output svg {width:30px;height:30px}.ad-inventory .craft-cost {display:block;font-size:10px;color:#9eab93}.ad-inventory .craft-name {font-size:12px}.ad-inventory .craft-count {display:block;font-size:10px;align-self:center;color:#c6cb9a}
.ad-inventory .inv-work-empty {padding:24px 14px;border:1px dashed #687454;color:#a6b69b;line-height:1.8;font-size:13px}
.ad-inventory .inv-pools {display:block!important;padding:0!important;background:none;border:0}.ad-inventory .inv-bag-return {font-size:11px;padding:0 0 14px;border:0;color:#dec995}
.ad-inventory .pool-tabs {display:flex;flex-wrap:wrap;gap:4px}.ad-inventory .pool-tabs button {font-size:11px;padding:6px 4px}.ad-inventory .pool-tabs svg {width:16px}
.ad-inventory .pool-heading {font-size:17px}.ad-inventory .pool-row {grid-template-columns:14px 18px 14px minmax(48px,1fr) auto 22px 22px 32px;gap:4px;font-size:10px;padding:10px 0;border-top:1px solid #ffffff0c}
.ad-inventory .pool-properties,.ad-inventory .pool-status span {display:none}.ad-inventory .pool-row button {font-size:10px;padding:4px}.ad-inventory .pool-controls {font-size:11px;flex-wrap:wrap;gap:8px}
.ad-inventory .ad-footprint {display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:20px 0 0;padding-top:16px;border-top:1px solid #cfb98126;font-size:12px}
.ad-inventory .ad-loot {padding:0;margin:0;border:0;background:none}.ad-inventory .ad-loot h2 {font-size:18px}
.ad-sheet[data-page="inventory"]>footer {font:11px/1.5 'Sand Pixel',monospace;padding:10px 24px}.ad-sheet[data-page="inventory"]>footer * {font-family:'Sand Pixel',monospace!important}
@media(max-width:760px) {
 .ad-sheet[data-page="inventory"] {height:calc(100dvh - 20px)}.ad-sheet[data-page="inventory"]>header {padding:10px 12px}
 .ad-inventory .inv-hud {grid-template-columns:minmax(0,1fr)}
 .ad-inventory .inv-drop-zone:not(.carrying) {display:none}
 .ad-inventory .wand-spells,.ad-inventory .wand-upgrades {gap:4px}
 .ad-inventory .wand-socket {font-size:10px;min-height:82px}
 .ad-inventory .wand-place .game-select>button {font-size:8px!important}
 .ad-inventory .inv-work-tabs {padding:4px 6px 0;gap:0;justify-content:space-between;overflow-x:auto;scrollbar-width:thin}
 .ad-inventory .inv-work-tabs button {flex-shrink:0}
 .ad-inventory .inv-work-tabs button,.ad-inventory .inv-work-tabs button[data-section=pack] {display:block;padding:13px 6px;font-size:11px}
 .ad-inventory .inv-pack,.ad-inventory .inv-work {grid-column:1;grid-row:2;padding:16px;min-width:0;border:0}
 .ad-inventory .inv-hud:not([data-section=pack]) .inv-pack,.ad-inventory .inv-hud[data-section=pack] .inv-work {display:none}
 .ad-inventory .inv-grid {grid-template-columns:repeat(6,minmax(0,1fr))}
 .ad-inventory .inv-bar {grid-template-columns:repeat(9,44px);overflow-x:auto;scrollbar-width:thin;scrollbar-color:#8e8257 #1e2c20;padding-bottom:10px}
 .ad-inventory .inv-pack-heading {margin-bottom:12px}.ad-inventory .inv-filters {gap:2px}.ad-inventory .inv-filters button {padding:6px 9px}
 .ad-inventory .inv-quick-heading span {font-size:10px}.ad-inventory .inv-inspector {padding:12px 16px;gap:10px;flex-wrap:wrap}
 .ad-inventory .inv-inspect-text {flex-basis:calc(100% - 56px)}.ad-inventory .inv-item-actions {margin-left:52px}
 .ad-inventory .inv-item-actions button {min-height:38px}.ad-inventory .inv-drop-zone {padding:10px 16px;flex-wrap:wrap}.ad-inventory .inv-drop-zone span {flex-basis:100%}
 .ad-inventory .inv-drop-zone button {min-height:38px}.ad-inventory .craft-list {max-height:none}.ad-inventory .ad-footprint {margin-bottom:10px}
 .ad-inventory .ad-paperdoll {margin:18px 28px}.ad-inventory .ad-character-stats {margin:14px 10px}
 .ad-sheet[data-page="inventory"]>footer {font-size:10px;padding:8px 16px}.ad-sheet[data-page="inventory"] .ad-shortcuts {max-width:80%}
}
`;
