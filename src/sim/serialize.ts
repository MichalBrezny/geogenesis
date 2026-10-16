import type { PlanetState } from './core/planet';

/**
 * Binary save format:
 *   "SIMEARTH" (8 bytes) | version (u32) | header length (u32) | header (UTF-8 JSON) | data
 * The header is the saved object with every typed array replaced by a reference
 * into the data section, where the arrays are stored back to back, each aligned
 * to 8 bytes. Everything is little-endian.
 */
// Kept from the project's working title so that older saves still load.
const MAGIC = 'SIMEARTH';
export const SAVE_VERSION = 1;

const TYPED_ARRAYS = {
  Float64Array,
  Float32Array,
  Int32Array,
  Uint16Array,
  Uint8Array,
} as const;
type TypedArrayName = keyof typeof TYPED_ARRAYS;
type AnyTypedArray = InstanceType<(typeof TYPED_ARRAYS)[TypedArrayName]>;

interface ArrayRef {
  __typedArray: TypedArrayName;
  offset: number;
  length: number;
}

export interface SavedGame {
  /** Scenario id the planet belongs to (see scenarios/index.ts). */
  scenario: string;
  planet: PlanetState;
}

export class SaveFormatError extends Error {}

export function serializeGame(game: SavedGame): Uint8Array {
  const arrays: AnyTypedArray[] = [];
  let dataLength = 0;
  const header = JSON.stringify(game, (_key, value: unknown) => {
    if (!ArrayBuffer.isView(value) || value instanceof DataView) return value;
    const array = value as AnyTypedArray;
    const name = array.constructor.name as TypedArrayName;
    if (!(name in TYPED_ARRAYS)) throw new Error(`Cannot save a ${name}`);
    const ref: ArrayRef = { __typedArray: name, offset: dataLength, length: array.length };
    arrays.push(array);
    dataLength += align(array.byteLength);
    return ref;
  });
  const headerBytes = new TextEncoder().encode(header);
  const dataStart = align(16 + headerBytes.length);
  const out = new Uint8Array(dataStart + dataLength);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(MAGIC), 0);
  view.setUint32(8, SAVE_VERSION, true);
  view.setUint32(12, headerBytes.length, true);
  out.set(headerBytes, 16);
  let offset = dataStart;
  for (const array of arrays) {
    out.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), offset);
    offset += align(array.byteLength);
  }
  return out;
}

export function deserializeGame(bytes: Uint8Array): SavedGame {
  if (bytes.length < 16 || new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC) {
    throw new SaveFormatError('Not a Geogenesis save file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(8, true);
  if (version !== SAVE_VERSION) {
    throw new SaveFormatError(`Unsupported save version ${version} (expected ${SAVE_VERSION})`);
  }
  const headerLength = view.getUint32(12, true);
  const header = new TextDecoder().decode(bytes.subarray(16, 16 + headerLength));
  const dataStart = align(16 + headerLength);
  return JSON.parse(header, (_key, value: unknown) => {
    if (!isArrayRef(value)) return value;
    const Type = TYPED_ARRAYS[value.__typedArray];
    const start = dataStart + value.offset;
    const byteLength = value.length * Type.BYTES_PER_ELEMENT;
    if (start + byteLength > bytes.length) throw new SaveFormatError('Save file is truncated');
    // Copy, so the array owns aligned memory independent of the file buffer.
    const copy = new Uint8Array(byteLength);
    copy.set(bytes.subarray(start, start + byteLength));
    return new Type(copy.buffer);
  }) as SavedGame;
}

function isArrayRef(value: unknown): value is ArrayRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__typedArray' in value &&
    typeof (value as ArrayRef).__typedArray === 'string' &&
    (value as ArrayRef).__typedArray in TYPED_ARRAYS
  );
}

function align(n: number): number {
  return Math.ceil(n / 8) * 8;
}

/** gzip-compresses bytes (CompressionStream exists in browsers, workers and Node 18+). */
export async function compress(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decompress(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
