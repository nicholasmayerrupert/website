import { readFileSync } from 'node:fs';

const whitespace = /\s/;

function rejectDuplicateKeys(source, label) {
  let cursor = 0;

  const skipWhitespace = () => {
    while (cursor < source.length && whitespace.test(source[cursor])) cursor++;
  };
  const scanString = () => {
    const start = cursor++;
    while (cursor < source.length) {
      const ch = source[cursor++];
      if (ch === '"') return source.slice(start, cursor);
      if (ch === '\\') cursor++;
    }
    return source.slice(start);
  };
  const displayPath = (path, key) => {
    const segments = [...path, key].map((segment) =>
      typeof segment === 'number' ? `[${segment}]` : `[${JSON.stringify(segment)}]`);
    return `$${segments.join('')}`;
  };
  const scanValue = (path) => {
    skipWhitespace();
    if (source[cursor] === '{') {
      cursor++;
      skipWhitespace();
      const keys = new Set();
      if (source[cursor] === '}') { cursor++; return; }
      while (cursor < source.length) {
        const rawKey = scanString();
        const key = JSON.parse(rawKey);
        if (keys.has(key)) {
          throw new SyntaxError(
            `${label}: duplicate JSON key ${JSON.stringify(key)} at ${displayPath(path, key)}`,
          );
        }
        keys.add(key);
        skipWhitespace();
        cursor++;
        scanValue([...path, key]);
        skipWhitespace();
        if (source[cursor++] === '}') return;
        skipWhitespace();
      }
      return;
    }
    if (source[cursor] === '[') {
      cursor++;
      skipWhitespace();
      if (source[cursor] === ']') { cursor++; return; }
      let index = 0;
      while (cursor < source.length) {
        scanValue([...path, index++]);
        skipWhitespace();
        if (source[cursor++] === ']') return;
        skipWhitespace();
      }
      return;
    }
    if (source[cursor] === '"') {
      scanString();
      return;
    }
    while (cursor < source.length
           && !whitespace.test(source[cursor])
           && !',]}'.includes(source[cursor])) cursor++;
  };

  scanValue([]);
}

export function parseSchemaJson(source, label = 'JSON schema') {
  const parsed = JSON.parse(source);
  rejectDuplicateKeys(source, label);
  return parsed;
}

export function readSchemaJson(path) {
  return parseSchemaJson(readFileSync(path, 'utf8'), path);
}
