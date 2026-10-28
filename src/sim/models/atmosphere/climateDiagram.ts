import type { PlanetState } from '../../core/planet';

export interface MonthlyClimate {
  /** Monthly mean air temperature, January through December, degrees Celsius. */
  temperature: number[];
  /** Monthly precipitation, January through December, millimetres. */
  precipitation: number[];
}

const MONTHS = 12;
const EARTH_OBLIQUITY = 23.44;

/**
 * Diagnoses one cell's monthly climate without advancing or changing the simulation.
 *
 * The precipitation field is an annual moisture-budget result, so this function only
 * redistributes that total. The weights represent a migrating ITCZ, a modest
 * Mediterranean east/west-coast contrast, and summer convection over continental
 * interiors. Every term fades to uniform months with zero obliquity.
 */
export function monthlyClimate(state: PlanetState, cell: number): MonthlyClimate {
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.grid.cellCount) {
    throw new RangeError(`Cell ${cell} is outside the planet grid`);
  }

  const { grid, fields, globals } = state;
  const row = Math.floor(cell / grid.width);
  const latitude = grid.rowLatitude[row]!;
  const ocean = fields.elevation[cell]! < globals.seaLevel;
  const amplitude = fields.seasonalAmplitude[cell]!;
  const meanTemperature = fields.airTemperature[cell]!;
  const phasePeak = latitude < 0 ? 0 : 6;
  // The mixed layer delays the open-ocean maximum by about half a month.
  const lag = ocean ? 0.5 : 0;
  const temperature = Array.from(
    { length: MONTHS },
    (_, month) =>
      meanTemperature + amplitude * Math.cos(((month - phasePeak - lag) * Math.PI * 2) / MONTHS),
  );

  const annual = Math.max(0, fields.precipitation[cell]!);
  const obliquity = state.planetParams.tidallyLocked
    ? 0
    : Math.abs(state.effectiveControls.obliquity);
  const seasonalStrength = Math.min(1.5, obliquity / EARTH_OBLIQUITY);
  if (seasonalStrength <= 1e-9 || annual === 0) {
    return { temperature, precipitation: exactUniformTotal(annual) };
  }

  const context = landContext(state, cell, ocean);
  const meanItcz = globals.circulation?.meanItcz ?? 0;
  // Earth's ITCZ migrates roughly +/-8 degrees over sea and farther over heated
  // continents. Local land fraction is a cheap proxy for the continental heat low.
  const itczSwing = seasonalStrength * (8 + 10 * context.continentality);
  const tropical = Math.exp(-(Math.max(0, Math.abs(latitude) - 28) ** 2) / (2 * 12 ** 2));
  const subtropical = smoothBand(Math.abs(latitude), 28, 47, 4);
  const midHigh = smoothBand(Math.abs(latitude), 38, 75, 8);
  const weights = new Array<number>(MONTHS);

  for (let month = 0; month < MONTHS; month++) {
    const northernSummer = Math.cos(((month - 6) * Math.PI * 2) / MONTHS);
    const localSummer = latitude < 0 ? -northernSummer : northernSummer;
    const itcz = meanItcz + itczSwing * northernSummer;
    const rainBelt = Math.exp(-(((latitude - itcz) / 6.5) ** 2) / 2);

    // A positive exponential keeps every month wet enough to remain numerically
    // well behaved. Normalisation below preserves annual precipitation exactly.
    let logWeight = seasonalStrength * tropical * 1.45 * rainBelt;

    // Land in the outer tropics receives an extra summer-monsoon pulse. It is
    // strongest near a coast but remains present over a heated large land mass.
    const outerTropics = smoothBand(Math.abs(latitude), 9, 29, 4);
    const monsoonExposure = context.coastal ? 1 : 0.55 * context.continentality;
    logWeight +=
      seasonalStrength * outerTropics * context.land * monsoonExposure * 0.95 * localSummer;

    // Western continental margins in the subtropics sit under the poleward-shifted
    // summer high and get winter rain; eastern margins retain a small summer maximum.
    const marginSignal = context.westernCoast ? -0.7 : context.easternCoast ? 0.28 : -0.12;
    logWeight += seasonalStrength * subtropical * context.land * marginSignal * localSummer;

    // Continental interiors at middle and high latitudes have summer convection;
    // ocean and coastal climates stay comparatively even.
    logWeight +=
      seasonalStrength * midHigh * context.continentality * context.land * 0.55 * localSummer;
    weights[month] = Math.exp(logWeight);
  }

  return { temperature, precipitation: distributeExactly(annual, weights) };
}

interface LandContext {
  land: number;
  continentality: number;
  coastal: boolean;
  westernCoast: boolean;
  easternCoast: boolean;
}

/** Constant-size local sampling: no grid sweep is done for an inspector request. */
function landContext(state: PlanetState, cell: number, ocean: boolean): LandContext {
  if (ocean) {
    return { land: 0, continentality: 0, coastal: false, westernCoast: false, easternCoast: false };
  }
  const { grid, fields, globals } = state;
  const x = cell % grid.width;
  const y = Math.floor(cell / grid.width);
  let samples = 0;
  let landSamples = 0;
  let seaWest = false;
  let seaEast = false;
  for (let dy = -2; dy <= 2; dy++) {
    const sy = y + dy;
    if (sy < 0 || sy >= grid.height) continue;
    for (let dx = -3; dx <= 3; dx++) {
      const sx = (((x + dx) % grid.width) + grid.width) % grid.width;
      const land = fields.elevation[sy * grid.width + sx]! >= globals.seaLevel;
      samples++;
      if (land) landSamples++;
      else if (dy === 0 && dx < 0) seaWest = true;
      else if (dy === 0 && dx > 0) seaEast = true;
    }
  }
  const localLand = landSamples / Math.max(1, samples);
  const coastal = seaWest || seaEast || localLand < 0.85;
  // Coasts start maritime; broad all-land neighbourhoods approach continental.
  const continentality = Math.max(0.08, Math.min(1, (localLand - 0.45) / 0.55));
  return {
    land: 1,
    continentality,
    coastal,
    westernCoast: seaWest && !seaEast,
    easternCoast: seaEast && !seaWest,
  };
}

function smoothBand(value: number, low: number, high: number, feather: number): number {
  return (
    smoothstep(low - feather, low + feather, value) *
    (1 - smoothstep(high - feather, high + feather, value))
  );
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function exactUniformTotal(total: number): number[] {
  return distributeExactly(total, new Array<number>(MONTHS).fill(1));
}

function distributeExactly(total: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  const values = weights.map((weight) => (total * weight) / weightSum);
  // Put the floating-point normalisation residue in December. Array.reduce now
  // reproduces the annual field value exactly, which is useful to callers and tests.
  const firstEleven = values.slice(0, -1).reduce((sum, value) => sum + value, 0);
  values[MONTHS - 1] = total - firstEleven;
  return values;
}
