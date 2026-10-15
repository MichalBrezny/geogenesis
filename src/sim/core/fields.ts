/**
 * Per-cell data layers, modelled on Landlab's grid fields.
 *
 * Every field is one Float32Array with one value per grid cell. Components
 * declare which fields they read and write (see component.ts), and the
 * simulation validates that every input is produced by someone.
 *
 * Add new fields here; units go in the comment.
 */
export const FIELD_NAMES = [
  'elevation', // m above sea level (negative = ocean floor)
  'airTemperature', // °C
] as const;

export type FieldName = (typeof FIELD_NAMES)[number];

export type Fields = Record<FieldName, Float32Array>;

export function createFields(cellCount: number): Fields {
  const fields = {} as Fields;
  for (const name of FIELD_NAMES) fields[name] = new Float32Array(cellCount);
  return fields;
}
