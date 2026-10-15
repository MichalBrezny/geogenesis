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
  /** Height above sea level (negative = ocean floor). */
  elevation: { type: 'f32', unit: 'm' },
  /** Surface air temperature. */
  airTemperature: { type: 'f32', unit: '°C' },
  /** Fraction of the cell covered by snow or ice, 0..1. */
  iceCover: { type: 'f32', unit: '' },
  /** Planetary albedo of the cell (surface and clouds), 0..1. */
  albedo: { type: 'f32', unit: '' },
  /** Annual precipitation. */
  precipitation: { type: 'f32', unit: 'mm/yr' },
  /** Crust type: 1 = continental (buoyant, never subducts), 0 = oceanic. */
  crustType: { type: 'i32', unit: '' },
  /** Tectonic plate the cell belongs to. */
  plateId: { type: 'i32', unit: '' },
  /** Tectonic uplift rate (negative = subsidence). */
  upliftRate: { type: 'f32', unit: 'm/yr' },
  /** Downstream cell of steepest descent; -1 for outlets (ocean, sinks). */
  flowReceiver: { type: 'i32', unit: '' },
  /** Cell indices ordered from downstream to upstream (receivers before donors). */
  flowUpstreamOrder: { type: 'i32', unit: '' },
  /** Upstream contributing area, including the cell itself. */
  drainageArea: { type: 'f32', unit: 'm²' },
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
