// One-shot milestones measure real world presentation, relative to navigation.
export function markStartup(ctx, name, detail = {}) {
  if (ctx.startup[name]) return;
  const value = { at: performance.now(), ...detail };
  ctx.startup[name] = value;
  ctx.container.dispatchEvent(new CustomEvent(`sand:${name}`, {
    detail: value, bubbles: true, composed: true,
  }));
}
