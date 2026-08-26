// Unpack schema-backed snapshots without duplicating their field order or
// scalar conversions at each JavaScript boundary.

import { SNAPSHOT_CODECS } from './abi.generated.js';

function codecFor(name) {
  const codec = SNAPSHOT_CODECS[name];
  if (!codec) throw new TypeError(`unknown packed snapshot codec ${name}`);
  return codec;
}

export function unpackSnapshotRecords(packed, name) {
  const codec = codecFor(name);
  const { fields } = codec;
  if (packed.length % fields.length) {
    throw new RangeError(`invalid ${name} packed length ${packed.length}`);
  }
  const records = new Array(packed.length / fields.length);
  for (let i = 0; i < records.length; i++) {
    records[i] = unpackSnapshotRecordAt(packed, name, i);
  }
  return records;
}

export function unpackSnapshotRecordAt(packed, name, index, out = {}) {
  const { fields, kinds } = codecFor(name);
  const offset = index * fields.length;
  if (!Number.isInteger(index) || index < 0
      || offset + fields.length > packed.length) return null;
  for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
    const value = packed[offset + fieldIndex];
    const kind = kinds[fieldIndex];
    out[fields[fieldIndex]] = kind === 'b' ? value === 1
      : (kind === 'i' ? value | 0 : (kind === 'u' ? value >>> 0 : value));
  }
  return out;
}
