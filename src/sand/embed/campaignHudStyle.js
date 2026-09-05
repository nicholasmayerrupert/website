// Campaign chrome styles the expedition HUD and legacy mission interfaces.
export const CAMPAIGN_HUD_STYLE = `
:host([mission]),:host([planet="ship"]) { --sg-pixel:'Sand Pixel',monospace; }
:host([mission]) .inv-hud,:host([planet="ship"]) .inv-hud { bottom:48px; font-family:var(--sg-pixel); }
:host([mission]) .inv-hint,:host([planet="ship"]) .inv-hint { display:none; }
:host([mission]) .survival-vitals,:host([planet="ship"]) .survival-vitals { bottom:124px; font-family:var(--sg-pixel); }
:host([mission]:not([mission="frontier"])) .survival-death { display:none; }
:host([mission="frontier"]) .survival-death { z-index:95; backdrop-filter:none; }
:host([mission="frontier"]) .survival-death-card::before { content:none; }
:host([mission="frontier"]) .survival-death-note,:host([mission="frontier"]) .survival-respawn { font-size:16px; }
:host([mission="frontier"]) .survival-death-card { min-width:0; width:min(380px,calc(100vw - 48px)); box-sizing:border-box; border:1px solid #7d8b68; border-radius:6px; background:#19332f; box-shadow:0 20px 80px #0008; }
:host([mission="frontier"]) .survival-death-title { font:30px Georgia,serif; color:#ead9b8; text-shadow:none; letter-spacing:0; }
:host([mission="frontier"]) .survival-death-note { font:12px/1.5 system-ui,sans-serif; letter-spacing:0; }
:host([mission="frontier"]) .survival-respawn { font:14px system-ui,sans-serif; border:1px solid #b9c18c; border-radius:4px; background:#7c8c59; box-shadow:none; letter-spacing:0; }
:host([mission="frontier"]) .survival-respawn:hover:not(:disabled) { transform:none; background:#99a76f; box-shadow:none; }
:host([mission]) .inv-bar,:host([planet="ship"]) .inv-bar { background:#292a30; border:3px solid #0b0c0f; border-radius:0; box-shadow:inset 2px 2px #73757c,inset -2px -2px #131418,3px 3px #0008; gap:4px; padding:7px; }
:host([mission]) .inv-slot,:host([planet="ship"]) .inv-slot { border:2px solid #101115; border-radius:0; background:#17181d; box-shadow:inset 1px 1px #090a0c,1px 1px #65666e; }
:host([mission]) .inv-slot.selected,:host([planet="ship"]) .inv-slot.selected { border-color:#f6df78; background:#38352b; box-shadow:inset 1px 1px #968c53,0 0 0 1px #101115; }
:host([mission]) .inv-modal,:host([planet="ship"]) .inv-modal { font-family:var(--sg-pixel); background:#292a30; border:3px solid #0b0c0f; border-radius:0; box-shadow:inset 2px 2px #73757c,5px 5px #0008; }
:host([mission]) .inv-grid { background:#191a1f; border:2px solid #0b0c0f; box-shadow:1px 1px #65666e; }
:host([mission]) .inv-backdrop { background:#0006; }
:host([mission]) .inv-toast { bottom:80px; }
:host([mission]) .sg-sound { opacity:.6; }
 :host([planet="frontier"]) { --sg-pixel:system-ui,sans-serif; }
:host([planet="frontier"]) .inv-bar { background:#18392fef; border:1px solid #a5b77a88; border-radius:5px; box-shadow:0 5px 20px #001c1944; padding:7px; gap:4px; }
:host([planet="frontier"]) .inv-slot { border:1px solid #59795488; border-radius:3px; background:#112c26; box-shadow:none; }
:host([planet="frontier"]) .inv-slot.selected { border-color:#e5c682; background:#4a5835; box-shadow:0 0 0 1px #cfbf7388; }
:host([planet="frontier"]) .sg-sound { bottom:12px; }
:host([planet="frontier"]) .sg-mission-marker .range { font:11px system-ui,sans-serif; background:#17382ce8; border:1px solid #c4bd7588; border-radius:3px; padding:5px 8px; }
:host([planet="frontier"]) .sg-dialogue { background:#193830f5; border:1px solid #b4b57999; border-radius:5px; box-shadow:0 12px 40px #001d1766; font-family:system-ui,sans-serif; padding:22px; }
:host([planet="frontier"]) .sg-dialogue-name { font:25px Georgia,serif; background:none; margin:0; padding:0; color:#eddfb5; }
:host([planet="frontier"]) .sg-dialogue-copy { font:14px/1.7 system-ui,sans-serif; color:#bbcdb2; }
:host([planet="frontier"]) .sg-dialogue-actions button { font:12px system-ui,sans-serif; border:1px solid #6b855d; border-radius:3px; box-shadow:none; background:#304d39; }
:host([planet="frontier"]) .sg-dialogue-actions .primary { background:#b5be80; color:#18352a; }
:host([planet="frontier"]) .sg-talk-button { background:#223f30; border:1px solid #dac784; border-radius:3px; box-shadow:none; color:#f1e6bc; font:11px system-ui,sans-serif; }
:host([planet="frontier"]) .sg-place-sign { font:9px system-ui,sans-serif; letter-spacing:.16em; color:#e1d3a0; }

`;
