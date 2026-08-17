// Shared object <-> packed-record conversion for layouts declared in
// abi.schema.json. Each generated codec supplies its field order, scalar kinds,
// defaults, and record limit; boundaries that select that codec use these
// routines without owning another field list.

import {
  OBJECT_WIRE_CODECS, RECORD_CODECS, SNAPSHOT_CODECS,
} from './abi.generated.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function codecFor(name) {
  const codec = RECORD_CODECS[name];
  if (!codec) throw new TypeError(`unknown packed record codec ${name}`);
  return codec;
}

function snapshotCodecFor(name) {
  const codec = SNAPSHOT_CODECS[name];
  if (!codec) throw new TypeError(`unknown packed snapshot codec ${name}`);
  return codec;
}

function sourceValue(record, field, defaults) {
  let value = record[field];
  if (!Number.isFinite(value) && own(defaults, field)) {
    const fallback = defaults[field];
    value = typeof fallback === 'string' ? record[fallback] : fallback;
  }
  return value;
}

const isI32 = (value) => Number.isInteger(value)
  && value >= -2147483648 && value <= 2147483647;
const isU32 = (value) => Number.isInteger(value)
  && value >= 0 && value <= 0xffffffff;

function normalizePackedScalar(value, kind, label) {
  if (kind === 'b') {
    if (value !== true && value !== false && value !== 0 && value !== 1) {
      throw new TypeError(`${label} must be boolean`);
    }
    return value ? 1 : 0;
  }
  if (kind === 'i') {
    if (!isI32(value)) throw new TypeError(`${label} must be signed 32-bit integer`);
    return value;
  }
  if (kind === 'u') {
    if (!isU32(value)) throw new TypeError(`${label} must be unsigned 32-bit integer`);
    return value;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite`);
  }
  return value;
}

export function packRecords(records, name, Output = Array) {
  const codec = codecFor(name);
  const { fields, kinds, defaults, maxRecords } = codec;
  if (!Array.isArray(records) || records.length > maxRecords) {
    throw new RangeError(`${name} record count exceeds ${maxRecords}`);
  }
  const length = records.length * fields.length;
  const packed = Output === Array ? new Array(length) : new Output(length);
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const offset = i * fields.length;
    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
      const field = fields[fieldIndex];
      const value = normalizePackedScalar(
        sourceValue(record, field, defaults), kinds[fieldIndex], `${name}.${field}`,
      );
      const kind = kinds[fieldIndex];
      packed[offset + fieldIndex] = kind === 'b' ? (value ? 1 : 0) : value;
    }
  }
  return packed;
}

export function unpackRecords(packed, name) {
  const codec = codecFor(name);
  const { fields } = codec;
  if (packed.length % fields.length) {
    throw new RangeError(`invalid ${name} packed length ${packed.length}`);
  }
  const records = new Array(packed.length / fields.length);
  for (let i = 0; i < records.length; i++) {
    records[i] = unpackRecordAt(packed, name, i);
  }
  return records;
}

export function unpackRecordAt(packed, name, index, out = {}) {
  return unpackRecordWithCodec(packed, codecFor(name), index, out);
}

function unpackRecordWithCodec(packed, codec, index, out) {
  const { fields, kinds } = codec;
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

export function unpackSnapshotRecordAt(packed, name, index, out = {}) {
  return unpackRecordWithCodec(packed, snapshotCodecFor(name), index, out);
}

export function validatePackedRecords(packed, name, validateField) {
  const codec = codecFor(name);
  const { fields, kinds, maxRecords } = codec;
  if (packed.length % fields.length || packed.length > maxRecords * fields.length) return false;
  for (let i = 0; i < packed.length; i++) {
    const value = packed[i];
    const fieldIndex = i % fields.length;
    const kind = kinds[fieldIndex];
    if (kind === 'n') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    } else if ((kind === 'i' && !isI32(value))
        || (kind === 'u' && !isU32(value))
        || (kind === 'b' && value !== 0 && value !== 1)) {
      return false;
    }
    if (validateField && !validateField(fields[fieldIndex], value, (i / fields.length) | 0)) {
      return false;
    }
  }
  return true;
}

function objectCodecFor(name) {
  const codec = OBJECT_WIRE_CODECS[name];
  if (!codec) throw new TypeError(`unknown object wire codec ${name}`);
  return codec;
}

const unpackObjectScalar = (value, kind) => kind === 'boolean' ? value === 1
  : (kind === 'i32' ? value | 0 : (kind === 'u32' ? value >>> 0 : value));
const snapshotObjectMappings = new Map();

function snapshotObjectMapping(name) {
  let mapping = snapshotObjectMappings.get(name);
  if (mapping) return mapping;
  const objectCodec = objectCodecFor(name);
  if (!objectCodec.sourceStruct) {
    throw new TypeError(`${name} is not projected from a packed snapshot`);
  }
  const sourceCodec = codecFor(objectCodec.sourceStruct);
  const offsets = objectCodec.fields.map((field) => sourceCodec.fields.indexOf(field.name));
  if (offsets.some((offset) => offset < 0)) {
    throw new TypeError(`${name} projection references a missing snapshot field`);
  }
  mapping = { objectCodec, sourceCodec, offsets };
  snapshotObjectMappings.set(name, mapping);
  return mapping;
}

export function unpackSnapshotObjectAt(packed, name, index, out = {}) {
  const { objectCodec, sourceCodec, offsets } = snapshotObjectMapping(name);
  const recordOffset = index * sourceCodec.fields.length;
  if (!Number.isInteger(index) || index < 0
      || recordOffset + sourceCodec.fields.length > packed.length) return null;
  for (let i = 0; i < objectCodec.fields.length; i++) {
    const field = objectCodec.fields[i];
    out[field.name] = unpackObjectScalar(
      packed[recordOffset + offsets[i]], field.kind,
    );
  }
  return out;
}

export function unpackObjectWireRecord(record, name, out = {}) {
  const codec = objectCodecFor(name);
  if (!validateObjectRecords([record], name)) {
    throw new TypeError(`invalid ${name} object record`);
  }
  for (const field of codec.fields) {
    out[field.name] = unpackObjectScalar(record[field.name], field.kind);
  }
  return out;
}

function objectSourceValue(record, field) {
  const sources = field.source === undefined ? [field.name]
    : (Array.isArray(field.source) ? field.source : [field.source]);
  for (const source of sources) {
    if (record[source] !== undefined) return record[source];
  }
  return field.default;
}

function projectObjectField(record, field) {
  let value = objectSourceValue(record, field);
  if (field.kind === 'point') {
    return value && Number.isFinite(value.x) && Number.isFinite(value.y)
      ? { x: Math.trunc(value.x), y: Math.trunc(value.y) }
      : (field.default ?? null);
  }
  if (field.kind === 'boolean') {
    if (value !== true && value !== false && value !== 0 && value !== 1) {
      throw new TypeError(`${field.name} must be boolean`);
    }
    return value ? 1 : 0;
  }
  if (field.kind === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${field.name} must be finite`);
  } else if (field.kind === 'u32') {
    if (!isU32(value)) throw new TypeError(`${field.name} must be unsigned 32-bit integer`);
  } else if (!isI32(value)) throw new TypeError(`${field.name} must be signed 32-bit integer`);
  if (Number.isFinite(value)) {
    if (field.clamp) {
      if (field.min !== undefined) value = Math.max(field.min, value);
      if (field.max !== undefined) value = Math.min(field.max, value);
    } else if ((field.min !== undefined && value < field.min)
        || (field.max !== undefined && value > field.max)) {
      throw new RangeError(`${field.name} is outside its wire bounds`);
    }
  }
  return value;
}

export function projectObjectRecords(records, name) {
  const codec = objectCodecFor(name);
  if (!Array.isArray(records) || records.length > codec.maxRecords) {
    throw new RangeError(`${name} record count exceeds ${codec.maxRecords}`);
  }
  return records.map((source) => {
    const projected = {};
    for (const field of codec.fields) {
      projected[field.name] = projectObjectField(source, field);
    }
    return projected;
  });
}

export function packObjectWireRecords(records, name, Output = Array) {
  const codec = objectCodecFor(name);
  const projected = projectObjectRecords(records, name);
  if (codec.fields.some((field) => field.kind === 'point')) {
    throw new TypeError(`${name} point fields cannot use flat packing`);
  }
  const packed = Output === Array
    ? new Array(projected.length * codec.fields.length)
    : new Output(projected.length * codec.fields.length);
  for (let i = 0; i < projected.length; i++) {
    for (let fieldIndex = 0; fieldIndex < codec.fields.length; fieldIndex++) {
      packed[i * codec.fields.length + fieldIndex]
        = projected[i][codec.fields[fieldIndex].name];
    }
  }
  return packed;
}

export function unpackObjectWireRecords(packed, name) {
  const codec = objectCodecFor(name);
  if (!validatePackedObjectRecords(packed, name)) {
    throw new TypeError(`invalid packed ${name} records`);
  }
  const records = new Array(packed.length / codec.fields.length);
  for (let i = 0; i < records.length; i++) {
    const record = {};
    for (let fieldIndex = 0; fieldIndex < codec.fields.length; fieldIndex++) {
      const field = codec.fields[fieldIndex];
      const value = packed[i * codec.fields.length + fieldIndex];
      record[field.name] = field.kind === 'boolean' ? value === 1 : value;
    }
    records[i] = record;
  }
  return records;
}

export function validatePackedObjectRecords(packed, name, validateField) {
  const codec = objectCodecFor(name);
  if (!Array.isArray(packed) || codec.fields.some((field) => field.kind === 'point')
      || packed.length % codec.fields.length
      || packed.length > codec.maxRecords * codec.fields.length) return false;
  const records = new Array(packed.length / codec.fields.length);
  for (let i = 0; i < records.length; i++) {
    const record = {};
    for (let fieldIndex = 0; fieldIndex < codec.fields.length; fieldIndex++) {
      record[codec.fields[fieldIndex].name] = packed[i * codec.fields.length + fieldIndex];
    }
    records[i] = record;
  }
  return validateObjectRecords(records, name, validateField);
}

export function validateObjectRecords(records, name, validateField) {
  const codec = objectCodecFor(name);
  if (!Array.isArray(records) || records.length > codec.maxRecords) return false;
  for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
    const record = records[recordIndex];
    if (!record || typeof record !== 'object') return false;
    for (const field of codec.fields) {
      const value = record[field.name];
      if (field.kind === 'point') {
        if (value !== null && (!value || !Number.isInteger(value.x)
            || !Number.isInteger(value.y) || value.x < -2147483648
            || value.x > 2147483647 || value.y < -2147483648
            || value.y > 2147483647)) return false;
      } else if (field.kind === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      } else if ((field.kind === 'i32' && !isI32(value))
          || (field.kind === 'u32' && !isU32(value))
          || (field.kind === 'boolean' && value !== 0 && value !== 1)) {
        return false;
      }
      if (field.kind !== 'point'
          && ((field.min !== undefined && value < field.min)
            || (field.max !== undefined && value > field.max))) return false;
      if (validateField && !validateField(field.name, value, recordIndex)) return false;
    }
  }
  return true;
}
