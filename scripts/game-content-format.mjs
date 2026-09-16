// Keep each drawing operation and coordinate tuple on one line while retaining
// the JSON object literal that the workbench reads and edits.
export function formatWorldContent(world) {
  function format(value, depth = 0) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    const array = Array.isArray(value);
    const entries = array ? value : Object.entries(value);
    const geometry = !array && (value.rect || value.polygon || value.use);
    const coordinates = array && value.every(item => typeof item === 'number');
    if (!entries.length || geometry || coordinates) return JSON.stringify(value);
    const indent = '  '.repeat(depth + 1);
    const lines = array
      ? entries.map(item => format(item, depth + 1))
      : entries.map(([key, item]) => `${JSON.stringify(key)}: ${format(item, depth + 1)}`);
    return `${array ? '[' : '{'}\n${indent}${lines.join(`,\n${indent}`)}\n${'  '.repeat(depth)}${array ? ']' : '}'}`;
  }
  return format(world);
}
