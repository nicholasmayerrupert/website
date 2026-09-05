// Campaign chrome shares the mission journal's pixel font and beveled panels.
export const CAMPAIGN_HUD_STYLE = `
:host([mission]),:host([planet="ship"]) { --sg-pixel:'Sand Pixel',monospace; }
:host([planet="frontier"]),:host([planet="frontier"]) * { font-family:var(--sg-pixel)!important; letter-spacing:0; }
:host([mission]) .inv-hud,:host([planet="ship"]) .inv-hud { bottom:48px; font-family:var(--sg-pixel); }
:host([mission]) .inv-hint,:host([planet="ship"]) .inv-hint { display:none; }
:host([mission]) .survival-vitals,:host([planet="ship"]) .survival-vitals { bottom:124px; font-family:var(--sg-pixel); }
:host([mission]:not([mission="frontier"])) .survival-death { display:none; }
:host([mission="frontier"]) .survival-death { z-index:95; backdrop-filter:none; }
:host([mission="frontier"]) .survival-death-card::before { content:none; }
:host([mission="frontier"]) .survival-death-note,:host([mission="frontier"]) .survival-respawn { font-size:16px; }
:host([mission]) .inv-bar,:host([planet="ship"]) .inv-bar { background:#292a30; border:3px solid #0b0c0f; border-radius:0; box-shadow:inset 2px 2px #73757c,inset -2px -2px #131418,3px 3px #0008; gap:4px; padding:7px; }
:host([mission]) .inv-slot,:host([planet="ship"]) .inv-slot { border:2px solid #101115; border-radius:0; background:#17181d; box-shadow:inset 1px 1px #090a0c,1px 1px #65666e; }
:host([mission]) .inv-slot.selected,:host([planet="ship"]) .inv-slot.selected { border-color:#f6df78; background:#38352b; box-shadow:inset 1px 1px #968c53,0 0 0 1px #101115; }
:host([mission]) .inv-modal,:host([planet="ship"]) .inv-modal { font-family:var(--sg-pixel); background:#292a30; border:3px solid #0b0c0f; border-radius:0; box-shadow:inset 2px 2px #73757c,5px 5px #0008; }
:host([mission]) .inv-grid { background:#191a1f; border:2px solid #0b0c0f; box-shadow:1px 1px #65666e; }
:host([mission]) .inv-backdrop { background:#0006; }
:host([mission]) .inv-toast { bottom:80px; }
:host([mission]) .sg-sound { opacity:.6; }
`;
