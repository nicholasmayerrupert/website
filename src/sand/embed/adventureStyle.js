export const ADVENTURE_STYLE = `
:host([mission="frontier"]) { --ad-ink:#17221e; --ad-paper:#dfd5b6; --ad-muted:#a9b6a0; --ad-gold:#ceb67c; }
.ad-nav,.ad-overlay,.ad-caption,.ad-notice { font:16px/1.5 'Sand Pixel',monospace; color:var(--ad-paper); }
.ad-nav { pointer-events:auto;position:absolute;right:22px;top:20px;z-index:85;display:flex;gap:4px;padding:4px;background:#17251ee8;border:1px solid #baa67566;box-shadow:0 4px 20px #07110f40; }
.ad-nav button,.ad-overlay button { font:inherit;color:inherit;border:1px solid transparent;background:transparent;padding:8px 12px;cursor:pointer; }
.ad-nav button { display:flex;align-items:center;gap:9px; }
.ad-nav button:hover,.ad-overlay button:hover { background:#c8b57814; }
.ad-nav svg { width:20px;height:20px;stroke:var(--ad-gold);fill:none;stroke-width:1.4; }
.ad-nav kbd,.ad-shortcuts kbd { font:12px 'Sand Pixel';border:1px solid #c8b57840;padding:1px 4px;color:#aeb9a0; }
.ad-overlay { pointer-events:auto;position:absolute;inset:0;z-index:100;display:grid;place-items:center;padding:28px;background:#07100ed6; }
.ad-boss[hidden],.ad-trail-hint[hidden],.ad-nav[hidden],.ad-chest-prompt[hidden],.ad-loot[hidden],.craft-recipe[hidden],.ad-overlay[hidden],.ad-page[hidden],.ad-notice[hidden] { display:none; }
.ad-sheet { width:min(1040px,100%);height:min(690px,calc(100dvh - 56px));display:flex;flex-direction:column;box-sizing:border-box;background:#1b2b24;border:1px solid #b7a16e;box-shadow:0 24px 100px #0009,inset 0 0 0 5px #101c1855;position:relative; }
.ad-sheet::before,.ad-sheet::after { content:'';position:absolute;width:10px;height:10px;border:2px solid var(--ad-gold);pointer-events:none; }
.ad-sheet::before { top:5px;left:5px;border-right:0;border-bottom:0; }.ad-sheet::after { bottom:5px;right:5px;border-left:0;border-top:0; }
.ad-sheet>header { padding:20px 26px 16px;display:flex;align-items:center;gap:24px;border-bottom:1px solid #cfb98133;flex-shrink:0; }
.ad-wordmark { margin-right:auto;color:#b7a276;font-size:15px; }.ad-wordmark strong { display:block;font-size:22px;line-height:1.1;color:#e3d4ac; }
.ad-tabs { display:flex;gap:6px; }.ad-tabs button[aria-selected="true"] { border-bottom-color:var(--ad-gold);color:#f3e4b5; }.ad-close { font-size:24px!important;padding:0 8px!important; }
.ad-page { flex:1;min-height:0;overflow:auto;padding:26px; }.ad-page h2 { font-size:30px;line-height:1.1;margin:0 0 12px;font-weight:400; }.ad-page h3 { font-size:24px;font-weight:400;line-height:1.2;margin:8px 0 18px; }
.ad-eyebrow { color:var(--ad-gold);font-size:13px;letter-spacing:.09em;text-transform:uppercase; }.ad-muted { color:var(--ad-muted); }.ad-page p { margin:12px 0; }
.ad-sheet>footer { flex-shrink:0;display:flex;justify-content:space-between;gap:12px;padding:10px 26px;border-top:1px solid #cfb98122;color:#9ba994;font-size:13px; }
.ad-journal-layout { display:grid;grid-template-columns:250px minmax(0,1fr);gap:30px;min-height:100%; }.ad-quest-list { display:flex;flex-direction:column;gap:4px;border-right:1px solid #cfb98126;padding-right:20px; }.ad-quest-list button { text-align:left;padding:12px;border:1px solid #9eab7c22; }.ad-quest-list button[aria-pressed="true"] { background:#c4b47714;border-color:#cfb98177; }.ad-quest-list small { display:block;color:#9cab92; }.ad-quest-list button:disabled { opacity:.5;cursor:default; }.ad-detail { max-width:600px; }.ad-detail>p { color:#c0cbb5; }.ad-note { border-left:2px solid #b5a06d;padding:2px 0 2px 18px;margin:24px 0;color:#aaba9b; }.ad-reward { border-top:1px solid #cfb98126;padding-top:16px;margin-top:24px; }
.ad-primary { background:#cbbc87!important;color:#1a2b21!important;border:1px solid #eadcaf!important; }.ad-settings { margin-top:22px;padding-top:16px;border-top:1px solid #cfb98133; }.ad-settings summary { cursor:pointer;color:#c3b584; }.ad-settings label { display:flex;align-items:center;gap:12px;margin:12px 0; }.ad-settings button { border:1px solid #cfb98155; }.ad-settings a { color:#dccc96; }
.ad-map-toolbar { display:flex;align-items:center;gap:8px;margin-bottom:12px; }.ad-map-toolbar span { margin-right:auto;color:#aebaa3; }.ad-map-toolbar button { border:1px solid #cfb98144;padding:4px 12px; }.ad-map-wrap { height:calc(100% - 88px);min-height:230px;position:relative;border:1px solid #a48e5b88;background:#d7caa3; }.ad-map-canvas { width:100%;height:100%;display:block;cursor:grab;touch-action:none; }.ad-map-canvas:active { cursor:grabbing; }.ad-map-legend { display:flex;gap:24px;font-size:14px;color:#b8c2aa;margin-top:10px; }
.ad-caption { position:absolute;left:24px;top:23px;z-index:80;pointer-events:none;transition:opacity 1.2s; }.ad-caption strong { font-size:25px;font-weight:400;display:block; }.ad-caption span { color:#c0ccad;font-size:14px; }.ad-caption.faded { opacity:0; }
.ad-notice { position:absolute;left:50%;top:24px;transform:translateX(-50%);z-index:90;background:#192d25f5;border:1px solid #bba46d;padding:13px 23px;text-align:center;pointer-events:none;box-shadow:0 8px 30px #0005; }.ad-notice small { color:#cab982;display:block; }
.ad-overlay :focus-visible,.ad-nav :focus-visible { outline:2px solid #f3d995;outline-offset:3px; }
:host([mission="frontier"]) .inv-backdrop,:host([mission="frontier"]) .inv-open-button,:host([mission="frontier"]) .inv-hint,:host([mission="frontier"]) .sg-sound { display:none!important; }
:host([mission="frontier"]) .inv-hud { bottom:20px; }.ad-page .inv-hud { position:static!important;transform:none!important;width:100%!important;display:flex;flex-direction:column;align-items:center; }.ad-page .inv-modal { position:static!important;transform:none!important;width:100%!important;max-height:none!important;box-sizing:border-box;box-shadow:none!important;background:transparent!important;border:0!important; }.ad-page .inv-modal-header { display:none; }.ad-page .inv-bar { order:-1;margin:0 0 14px; }.ad-page .inv-grid { background:#122018!important;border:1px solid #b3a06b44!important;padding:14px; }.ad-page .craft-panel { background:transparent;border-color:#b3a06b44; }.ad-page .inv-toast { display:none; }
:host([mission="frontier"]) .inv-bar { background:#1c2a21ed;border:1px solid #bda36b88;box-shadow:0 5px 24px #0004; }:host([mission="frontier"]) .inv-slot { background:#101e18;border-color:#9d9d6744; }:host([mission="frontier"]) .inv-slot.selected { background:#4b5132;border-color:#e1c780; }
:host([mission="frontier"]) .survival-vitals { bottom:92px; }:host([mission="frontier"]) .sg-place-sign { letter-spacing:0; }:host([mission="frontier"]) .sg-dialogue { bottom:140px; }
@media(max-width:720px) { .ad-nav { top:12px;right:12px; }.ad-nav button { padding:7px; }.ad-nav kbd { display:none; }.ad-overlay { padding:10px; }.ad-sheet { height:calc(100dvh - 20px); }.ad-sheet>header { padding:17px;gap:6px; }.ad-wordmark { display:none; }.ad-tabs { flex:1; }.ad-tabs button { padding:8px; }.ad-page { padding:16px; }.ad-journal-layout { grid-template-columns:1fr;gap:20px; }.ad-quest-list { border:0;display:grid;grid-template-columns:1fr 1fr;padding:0; }.ad-caption { top:65px;left:16px; }.ad-sheet>footer { padding:10px 16px; }.ad-sheet>footer span:last-child { display:none; } }
@media(prefers-reduced-motion:reduce) { .ad-caption { transition:none; } }

.ad-equipment {margin:0 0 20px;padding:0 4px}
.ad-equipment h2 {font-size:18px;margin:4px 0 8px;color:#e4d6ac}
.ad-equipment-grid {display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:8px;margin-top:16px}
.ad-equipment-grid button {display:flex;flex-direction:column;align-items:center;justify-content:space-between;gap:8px;min-height:108px;padding:10px 5px;border:1px solid #536049;background:#263126;color:#dad2ad;font:inherit;font-size:10px;cursor:pointer}
.ad-equipment-grid button:hover,.ad-equipment-grid button:focus-visible {border-color:#d7b966;background:#34422d}
.ad-equipment-grid .ad-eyebrow {font-size:9px}
@media(max-width:800px){.ad-equipment-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.ad-equipment-grid button{min-height:105px}}

.ad-chest-prompt {pointer-events:auto;position:absolute;z-index:76;transform:translate(-50%,-130%);padding:7px 10px;border:1px solid #baa46b;background:#263126;color:#e6d8ad;font:12px 'Sand Pixel',monospace;white-space:nowrap;cursor:pointer}
.ad-loot {padding:18px;border:1px solid #947d4c;background:#273426;margin-bottom:24px}
.ad-loot h2 {margin:0 0 16px;font-size:21px;color:#e2cc92}
.ad-loot>button {display:flex;align-items:center;gap:12px;min-height:42px;width:100%;margin:4px 0;padding:7px 12px;border:1px solid #4f6147;background:#1c281c;color:#e4dbb9;font:14px 'Sand Pixel',monospace;cursor:pointer}
.ad-loot>button .ad-muted {margin-left:auto}
.ad-loot>button:hover {border-color:#cdb570}

:host([mission="frontier"]) .survival-shield>i {clip-path:polygon(50% 0,85% 30%,100% 65%,85% 90%,50% 100%,15% 90%,0 65%,15% 30%);width:12px;height:14px}
:host([mission="frontier"]) .survival-fuel {gap:2px;grid-template-columns:repeat(12,10px)}
:host([mission="frontier"]) .survival-fuel>i {width:10px;height:5px;clip-path:none;background:#334731}
:host([mission="frontier"]) .survival-fuel>i.full::before {background:#a5b77b;box-shadow:inset 0 1px #d5dba2}
:host([mission="frontier"]) .survival-stat.fuel {bottom:22px}
:host([mission="frontier"]) .survival-death-card::before {content:'THE HEARTH REMEMBERS'}
:host([mission="frontier"]) .sg-dialogue {border:1px solid #b6a06b;background:#1d2c22f5;box-shadow:0 14px 50px #0008;padding:20px}
:host([mission="frontier"]) .sg-dialogue-name {background:none;color:#dec68a;padding:0 0 10px;margin:0;border-bottom:1px solid #a9915944;font-size:22px}
:host([mission="frontier"]) .sg-dialogue-copy {color:#ddd8bd;line-height:1.6;font-size:15px}
:host([mission="frontier"]) .sg-dialogue-actions button {border:1px solid #aa925e66;box-shadow:none;background:#35472d;font-size:13px;line-height:1.4}
.ad-boss{position:absolute;top:26px;left:50%;transform:translateX(-50%);width:min(360px,40vw);z-index:80;display:grid;gap:7px;text-align:center;color:#e3d1a5;font:18px 'Sand Pixel';text-shadow:0 2px #111}
.ad-boss progress{width:100%;height:9px;appearance:none;border:1px solid #c4a36b;background:#241d1c}
.ad-boss progress::-webkit-progress-bar{background:#241d1c}.ad-boss progress::-webkit-progress-value{background:#a95543}.ad-boss progress::-moz-progress-bar{background:#a95543}
.ad-trail-hint{position:absolute;left:22px;bottom:22px;max-width:280px;z-index:78;font:13px/1.5 'Sand Pixel';color:#d6d2b5;text-shadow:0 2px 3px #071510;pointer-events:none}
@media(max-width:900px){.ad-trail-hint{bottom:130px;max-width:210px}.ad-boss{top:76px;width:60vw}}
.ad-footprint{display:flex;align-items:center;gap:12px;margin:12px 4px;font-size:14px}.ad-footprint select{font:inherit;background:#14231b;color:#dbceaa;border:1px solid #8c8056;padding:5px 12px}
.ad-page .inv-pool-tabs,.ad-page .inv-pools,.ad-page .pool-panel{background:#14231b;border-color:#786d4b}
.ad-page .craft-panel{border:1px solid #776c49;box-shadow:none}.ad-page .craft-recipe{background:#1e2e23;box-shadow:none;border-color:#566047}.ad-page .craft-title{color:#ccb782;font-size:12px}
.ad-page .craft-cost{font-size:11px;color:#a2ad93}.ad-page .craft-name{font-size:13px}.ad-page .craft-count{font-size:11px}.ad-page .inv-modal{padding:0;margin-top:8px}.ad-page .inv-grid{padding:12px!important;gap:8px;align-content:center;justify-items:center}.ad-page .inv-grid .inv-slot{width:44px;height:44px}
@media(max-width:800px){.ad-page .inv-grid{gap:4px}.ad-page .inv-grid .inv-slot{width:100%;height:auto}}
:host([mission="frontier"]) .sg-talk-button{background:#d9c58f;border:1px solid #716443;box-shadow:0 3px 8px #07170d66;text-transform:none;font-size:13px;padding:7px 10px}
:host([mission="frontier"]) .sg-talk-button::after{background:#d9c58f;border-width:1px;width:6px;height:6px;bottom:-5px}
`;
