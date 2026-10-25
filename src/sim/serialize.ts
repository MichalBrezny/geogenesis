import { DEFAULT_CONTROLS, EARTH_PLANET_PARAMETERS, type PlanetState } from './core/planet';
import { HISTORY_SERIES } from './history';
import { LIFE_CLASSES } from './data/lifeClasses';
import type { RandomWorldSettings } from './world';
import { surfacePressureOf } from './models/atmosphere/atmosphere';
import { atmosphericWaterGel, basinWaterGel, landIceWaterGel } from './models/geosphere/seaLevel';

/**
 * Binary save format:
 *   "SIMEARTH" (8 bytes) | version (u32) | header length (u32) | header (UTF-8 JSON) | data
 * The header is the saved object with every typed array replaced by a reference
 * into the data section, where the arrays are stored back to back, each aligned
 * to 8 bytes. Everything is little-endian.
 */
// Kept from the project's working title so that older saves still load.
const MAGIC = 'SIMEARTH';
export const SAVE_VERSION = 3;

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
  /** Scenario construction choices; optional so version-3 saves remain loadable. */
  settings?: RandomWorldSettings;
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
  const game = JSON.parse(header, (_key, value: unknown) => {
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
  hydrateAddedState(game.planet);
  return game;
}

/** Hydrates optional state added within the current save version. */
function hydrateAddedState(planet: PlanetState): void {
  const missingPlanetParams = planet.planetParams === undefined;
  planet.planetParams ??= { ...EARTH_PLANET_PARAMETERS, radius: planet.grid.radius };
  planet.planetParams.radius ??= planet.grid.radius;
  planet.planetParams.surfaceGravity ??= EARTH_PLANET_PARAMETERS.surfaceGravity;
  planet.planetParams.orbitalDistanceAu ??= 1;
  planet.planetParams.starType ??= 'G';
  planet.planetParams.rotationPeriodHours ??= EARTH_PLANET_PARAMETERS.rotationPeriodHours;
  planet.planetParams.hasMoon ??= true;
  planet.planetParams.tidallyLocked ??= false;
  planet.planetParams.initialWaterGel ??= EARTH_PLANET_PARAMETERS.initialWaterGel;
  planet.planetParams.initialN2Bar ??= EARTH_PLANET_PARAMETERS.initialN2Bar;
  planet.planetParams.initialCo2Microbar ??= EARTH_PLANET_PARAMETERS.initialCo2Microbar;
  planet.planetParams.crustalCarbonBar ??= EARTH_PLANET_PARAMETERS.crustalCarbonBar;
  planet.planetParams.tectonicRegime ??= 'mobile';
  planet.planetParams.dynamoStrength ??= 1;
  planet.globals.seaLevel ??= 0;
  planet.globals.sedimentExport ??= 0;
  planet.fields.iceThickness ??= new Float32Array(planet.grid.cellCount);
  planet.fields.co2Ice ??= new Float32Array(planet.grid.cellCount);
  planet.fields.oceanOxygen ??= new Float32Array(planet.grid.cellCount);
  planet.fields.nutrients ??= new Float32Array(planet.grid.cellCount);
  planet.fields.seasonalAmplitude ??= new Float32Array(planet.grid.cellCount);
  planet.fields.lakeDepth ??= new Float32Array(planet.grid.cellCount);
  planet.fields.lakeType ??= new Int32Array(planet.grid.cellCount);
  planet.fields.volcanicActivity ??= new Float32Array(planet.grid.cellCount);
  planet.globals.atmosphere.n2 ??= 0.78084;
  planet.globals.atmosphere.inert ??= 0.00934;
  planet.globals.atmosphere.waterVapor ??= 0.0025;
  planet.globals.surfacePressure ??= surfacePressureOf(planet.globals.atmosphere);
  planet.globals.water ??=
    basinWaterGel(planet.grid, planet.fields.elevation, planet.globals.seaLevel) +
    landIceWaterGel(planet) +
    atmosphericWaterGel(planet);
  planet.globals.initialWater ??= planet.globals.water;
  planet.globals.escapedWater ??= 0;
  planet.globals.runawayGreenhouse ??= false;
  planet.globals.magneticField ??= 1;
  planet.globals.tectonicRegime ??= planet.planetParams.tectonicRegime;
  planet.globals.crustalCarbon ??= Math.max(
    0,
    planet.planetParams.crustalCarbonBar - planet.globals.atmosphere.co2 * 1e-6,
  );
  planet.globals.co2Ice ??= 0;
  planet.globals.dust ??= 0;
  planet.globals.dustBurden ??= [0, 0, 0];
  planet.globals.dustSources ??= [];
  planet.globals.dustIntegralSinceLife ??= 0;
  planet.globals.dustYearsSinceLife ??= 0;
  planet.globals.oceanAcidity ??= 0;
  planet.globals.clathrateCarbon ??= 0;
  planet.globals.clathrateReferenceTemperature ??= planet.globals.meanTemperature;
  planet.globals.biodiversity ??= 0;
  planet.globals.lastMassExtinctionYear ??= -1;
  planet.globals.escapedAtmosphere ??= { n2: 0, co2: 0, inert: 0, waterVapor: 0 };
  planet.globals.volcanicAerosol ??= 0;
  planet.globals.lipOutgassing ??= 0;
  planet.globals.impactFlux ??= 0;
  planet.globals.impactsThisStep ??= 0;
  planet.globals.waterDelivered ??= 0;
  planet.globals.impactHeating ??= 0;
  planet.geosphere ??= {
    initialPlateCount: planet.plates.length,
    hotspots: [],
    volcanicBoost: new Float32Array(planet.grid.cellCount),
    activeLips: [],
    nextLipId: 1,
    lipCount: 0,
    cleanupElapsedYears: 0,
    sliverCleanupElapsedYears: 0,
    plateSpeedMantleFactor: 1,
    plateRngState: (planet.seed ^ 0x7f4a7c15) >>> 0,
    impactHeat: 0,
    impactCount: 0,
    abiogenesisSuppressedUntil: 0,
    nextObliquityUpdateYear: 0,
    obliquityUpdateIndex: 0,
    fixedObliquity: false,
  };
  planet.geosphere.cleanupElapsedYears ??= 0;
  planet.geosphere.sliverCleanupElapsedYears ??= 0;
  planet.geosphere.plateSpeedMantleFactor ??= 1;
  planet.geosphere.plateRngState ??= (planet.seed ^ 0x7f4a7c15) >>> 0;
  planet.geosphere.impactHeat ??= 0;
  planet.geosphere.impactCount ??= 0;
  planet.geosphere.abiogenesisSuppressedUntil ??= 0;
  planet.geosphere.nextObliquityUpdateYear ??= 0;
  planet.geosphere.obliquityUpdateIndex ??= 0;
  planet.geosphere.fixedObliquity ??= false;
  const temperature = planet.globals.meanTemperature;
  const complexBiomass = planet.biota.cover.reduce(
    (sum, cover, index) => sum + (LIFE_CLASSES[index]?.tier === 'microbes' ? 0 : cover),
    0,
  );
  planet.biota.ecology ??= {
    initialized: true,
    biomassReference: complexBiomass,
    biosphereReference: complexBiomass,
    adaptedTemperature: temperature,
    previousTemperature: temperature,
  };
  planet.biota.ecology.initialized ??= true;
  planet.controls.obliquity ??= DEFAULT_CONTROLS.obliquity;
  planet.controls.greenhouse ??= DEFAULT_CONTROLS.greenhouse;
  planet.controls.cloudAlbedo ??= DEFAULT_CONTROLS.cloudAlbedo;
  planet.controls.surfaceAlbedo ??= DEFAULT_CONTROLS.surfaceAlbedo;
  planet.controls.airSeaHeat ??= DEFAULT_CONTROLS.airSeaHeat;
  planet.controls.rainfall ??= DEFAULT_CONTROLS.rainfall;
  planet.controls.advanceRate ??= DEFAULT_CONTROLS.advanceRate;
  planet.controls.reproduction ??= DEFAULT_CONTROLS.reproduction;
  planet.controls.thermalTolerance ??= DEFAULT_CONTROLS.thermalTolerance;
  planet.goal ??= null;
  if (missingPlanetParams) planet.planetParams.initialWaterGel = planet.globals.initialWater;
  const samples = planet.history.year?.length ?? 0;
  for (const name of HISTORY_SERIES) planet.history[name] ??= Array(samples).fill(0);
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
