// Shared validation and immutable effect tables for the ABI generator.
export function compileStatusEffects(schema) {
  const defs = schema.enums.StatusEffect.descriptors.slice().sort((a, b) => a.id - b.id);
  const tags = schema.enums.StatusTag.values;
  const controls = schema.enums.StatusControl.values;
  const policies = schema.enums.StatusStackPolicy.values;
  const fail = message => { throw new Error(`StatusEffect: ${message}`); };
  const integer = (value, min, max, label) => {
    if (!Number.isInteger(value) || value < min || value > max) fail(`${label} must be an integer in ${min}..${max}`);
  };
  const mask = (values, allowed, label) => {
    if (!Array.isArray(values) || new Set(values).size !== values.length) fail(`${label} must contain unique symbols`);
    return values.reduce((bits, value) => {
      if (!Object.hasOwn(allowed, value)) fail(`${label}: unknown symbol ${value}`);
      return bits | allowed[value];
    }, 0);
  };
  integer(schema.constants.STATUS_MAX_INSTANCES, 1, 128, 'STATUS_MAX_INSTANCES');
  if (defs[0]?.key !== 'STATUS_NONE' || defs.length > 256) fail('requires NONE at id 0 and at most 256 definitions');
  const compiled = defs.map(d => {
    if (!d.name || !d.description || !/^[A-Za-z]{2}$/.test(d.glyph) || !/^#[0-9a-f]{6}$/i.test(d.color)) fail(`${d.key}: invalid presentation`);
    if (!Object.hasOwn(schema.enums.StatusVisual.values, d.visual)) fail(`${d.key}: unknown visual profile`);
    if (!Object.hasOwn(policies, d.stacking)) fail(`${d.key}: unknown stacking policy`);
    integer(d.defaultTicks, d.id ? 1 : 0, 216000, `${d.key}.defaultTicks`);
    integer(d.maxTicks, d.defaultTicks, 216000, `${d.key}.maxTicks`);
    integer(d.maxStacks, 1, schema.constants.STATUS_MAX_INSTANCES, `${d.key}.maxStacks`);
    integer(d.periodTicks, 0, d.maxTicks, `${d.key}.periodTicks`);
    integer(d.healthDelta, -100, 100, `${d.key}.healthDelta`);
    if (!!d.healthDelta !== !!d.periodTicks) fail(`${d.key}: periodic health changes require a period and vice versa`);
    if (!Number.isFinite(d.movementScale) || d.movementScale < .1 || d.movementScale > 3) fail(`${d.key}: movementScale must be in .1..3`);
    if (d.stacking !== 'SSP_INDEPENDENT' && d.maxStacks !== 1) fail(`${d.key}: only independent effects have multiple stacks`);
    return { ...d, tags: mask(d.tags, tags, d.key), controls: mask(d.controls, controls, d.key),
      immunityTags: mask(d.immunityTags, tags, d.key), removeTags: mask(d.removeTags, tags, d.key) };
  });
  const creatures = schema.enums.CreatureSpecies.descriptors;
  const immunity = creatures.map(() => 0);
  for (const [name, values] of Object.entries(schema.statusCreatureImmunities || {})) {
    const creature = creatures.find(d => d.key === name);
    if (!creature) fail(`unknown immune creature ${name}`);
    immunity[creature.id] = mask(values, tags, name);
  }
  const hpp = `
struct StatusDefinition {
  int id, stacking, defaultTicks, maxTicks, maxStacks, periodTicks, healthDelta;
  double movementScale;
  int tags, controls, immunityTags, removeTags, visual;
};
inline constexpr StatusDefinition STATUS_DEFINITIONS[] = {
${compiled.map(d => `  {${d.key}, ${d.stacking}, ${d.defaultTicks}, ${d.maxTicks}, ${d.maxStacks}, ${d.periodTicks}, ${d.healthDelta}, ${d.movementScale}, ${d.tags}, ${d.controls}, ${d.immunityTags}, ${d.removeTags}, ${d.visual}},`).join('\n')}
};
inline constexpr int STATUS_CREATURE_IMMUNITIES[] = {${immunity.join(', ')}};
`;
  const js = `export const STATUS_EFFECT_DEFS = Object.freeze(${JSON.stringify(compiled)}.map(Object.freeze));\n`;
  return { hpp, js };
}
