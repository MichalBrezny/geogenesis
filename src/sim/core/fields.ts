/**
 * Per-cell data layers, modelled on Landlab's grid fields.
 *
 * Every field is one typed array with one value per grid cell. Components
 * declare which fields they read and write (see component.ts), and the
 * simulation validates that every input is produced by someone.
 *
 * Add new fields to FIELD_SPECS with their array type and unit.
 */
interface FieldSpec {
  readonly type: 'f32' | 'i32';
  readonly unit: string;
}

export const FIELD_SPECS = {
  /** Absolute terrain elevation relative to the ice-free sea-level datum. */
  elevation: { type: 'f32', unit: 'm' },
  /** Surface air temperature. */
  airTemperature: { type: 'f32', unit: '°C' },
  /** Annual temperature-cycle amplitude (half the warmest-minus-coldest monthly mean). */
  seasonalAmplitude: { type: 'f32', unit: '°C' },
  /** Fraction of the cell covered by snow or ice, 0..1. */
  iceCover: { type: 'f32', unit: '' },
  /** Thickness of grounded land ice; zero over the ocean. */
  iceThickness: { type: 'f32', unit: 'm' },
  /** Total cloud cover, 0..1 (cloud model). */
  cloudCover: { type: 'f32', unit: '' },
  /** Low cloud cover, 0..1; the part that changes the climate's albedo. */
  lowCloud: { type: 'f32', unit: '' },
  /** Albedo of the ice-free surface including typical clouds, 0..1 (set by surfaceAlbedo). */
  surfaceAlbedo: { type: 'f32', unit: '' },
  /** Biome (see data/biomes.ts); 0 = ocean, also for land when no biome model runs. */
  biome: { type: 'i32', unit: '' },
  /** Land plant cover, 0..1 (the plants life class); vegetates the biome. */
  vegetation: { type: 'f32', unit: '' },
  /** Most advanced tier of life present (index into LIFE_TIERS + 1; 0 = lifeless). */
  lifeTier: { type: 'i32', unit: '' },
  /** Density of the sentient civilization, as a fraction of PEOPLE_PER_KM2. */
  civilization: { type: 'f32', unit: '' },
  /** Fraction of the cell covered by white daisies (Daisyworld), 0..1. */
  daisyWhite: { type: 'f32', unit: '' },
  /** Fraction of the cell covered by black daisies (Daisyworld), 0..1. */
  daisyBlack: { type: 'f32', unit: '' },
  /** Planetary albedo of the cell (surface and clouds), 0..1. */
  albedo: { type: 'f32', unit: '' },
  /** Annual precipitation. */
  precipitation: { type: 'f32', unit: 'mm/yr' },
  /** Annual-mean surface wind, eastward and northward components (circulation model). */
  windU: { type: 'f32', unit: 'm/s' },
  windV: { type: 'f32', unit: 'm/s' },
  /** Sea-level atmospheric pressure. */
  pressure: { type: 'f32', unit: 'hPa' },
  /** Wind-driven surface ocean current, eastward and northward (ocean model). */
  oceanCurrentU: { type: 'f32', unit: 'm/s' },
  oceanCurrentV: { type: 'f32', unit: 'm/s' },
  /**
   * Sea surface temperature anomaly from currents and upwelling (warm and cold
   * currents), also felt on coasts; the climate model adds it to temperatures.
   */
  oceanAnomaly: { type: 'f32', unit: '°C' },
  /** Water leaving the cell as runoff (precipitation minus evapotranspiration). */
  runoff: { type: 'f32', unit: 'mm/yr' },
  /** Crust type: 1 = continental (buoyant, never subducts), 0 = oceanic. */
  crustType: { type: 'i32', unit: '' },
  /** Tectonic plate the cell belongs to. */
  plateId: { type: 'i32', unit: '' },
  /** Tectonic uplift rate (negative = subsidence). */
  upliftRate: { type: 'f32', unit: 'm/yr' },
  /** Relative volcanic activity (1 = present-day Earth area mean). */
  volcanicActivity: { type: 'f32', unit: '' },
  /** Downstream cell of steepest descent; -1 for outlets (ocean, sinks). */
  flowReceiver: { type: 'i32', unit: '' },
  /** Cell indices ordered from downstream to upstream (receivers before donors). */
  flowUpstreamOrder: { type: 'i32', unit: '' },
  /** Upstream contributing area, including the cell itself. */
  drainageArea: { type: 'f32', unit: 'm²' },
  /** River discharge: runoff of the cell and everything upstream of it. */
  discharge: { type: 'f32', unit: 'm³/yr' },
  /** Lake water depth; 0 for dry land, salt flats and the ocean. */
  lakeDepth: { type: 'f32', unit: 'm' },
  /** Lake kind: 0 none, 1 fresh/open, 2 salt/closed, 3 salt flat. */
  lakeType: { type: 'i32', unit: '' },
} as const satisfies Record<string, FieldSpec>;

export type FieldName = keyof typeof FIELD_SPECS;
export const FIELD_NAMES = Object.keys(FIELD_SPECS) as FieldName[];

type ArrayFor<T extends FieldSpec['type']> = T extends 'i32' ? Int32Array : Float32Array;

export type Fields = { [K in FieldName]: ArrayFor<(typeof FIELD_SPECS)[K]['type']> };

export function createFields(cellCount: number): Fields {
  const fields: Record<string, Float32Array | Int32Array> = {};
  for (const name of FIELD_NAMES) {
    fields[name] =
      FIELD_SPECS[name].type === 'i32' ? new Int32Array(cellCount) : new Float32Array(cellCount);
  }
  return fields as Fields;
}
