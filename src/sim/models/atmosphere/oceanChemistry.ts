import type { SimComponent } from '../../core/component';
import type { Grid } from '../../core/grid';
import type { GlobalState } from '../../core/planet';
import { oxygenPartialPressure, REFERENCE_SURFACE_PRESSURE } from './atmosphere';
import { isOcean } from '../geosphere/seaLevel';

/** Ruttenberg (1993) estimates an oceanic phosphorus residence time of 20--40 kyr. */
export const PHOSPHORUS_RESIDENCE_TIME = 30_000;
/** Carbonate compensation is deliberately reduced to one slow, game-scale reservoir. */
export const CARBONATE_BUFFER_TIME = 10_000;

const SHELF_DEPTH = 1_500;
const REFERENCE_RIVER_DISCHARGE = 1e11;
const REFERENCE_UPWELLING = 0.003;
/** Lateral surface-ocean mixing length for nutrient-bearing water. */
const NUTRIENT_MIXING_LENGTH = 450_000;
const MAX_NUTRIENTS = 3;
// A well-ventilated ocean reaches the top of the normalized field by about
// 0.18 bar pO2; higher Phanerozoic oxygen cannot supersaturate it above one.
const REFERENCE_OXYGEN_PRESSURE = 0.18 * REFERENCE_SURFACE_PRESSURE;

/**
 * Private plain-data extension of the global state. It is included by the existing
 * serializer without changing the public save schema; old saves initialize it from
 * their current CO2 on the first chemistry step.
 */
interface ChemistryGlobals extends GlobalState {
  oceanBufferedCo2?: number;
}

/**
 * Surface-ocean phosphate, dissolved oxygen and transient acidification.
 *
 * Continental weathering supplies phosphate at river mouths. It spreads across
 * shelves and combines with equatorial/eastern-boundary Ekman upwelling, while the
 * global inventory approaches the weathering supply over phosphorus's 30 kyr
 * residence time (Ruttenberg 1993). Oxygen follows atmospheric pO2 and Henry
 * solubility, then nutrient-fuelled respiration removes it most strongly from warm,
 * coastal and upwelling water.
 *
 * Acidification is a deliberately compact rate-sensitive carbonate model. A
 * buffered CO2 reservoir follows atmospheric CO2 with a 10 kyr e-folding time and
 * the transient pH drop is 0.4 log10(CO2 / buffered CO2). This reproduces the
 * distinction between rapid carbon releases and slow background change discussed
 * by Zeebe (2012), without changing the long-term carbon-cycle equilibrium.
 */
export const oceanChemistry: SimComponent = {
  name: 'oceanChemistry',
  inputs: ['elevation', 'airTemperature', 'discharge', 'upwelling'],
  outputs: ['oceanOxygen', 'nutrients'],
  runOneStep(state, dtYears) {
    const { grid, fields, globals } = state;
    const { elevation, nutrients, oceanOxygen } = fields;
    const scratch = chemistryScratch(grid);
    const { sea } = scratch;
    sea.fill(0);
    let oceanWeight = 0;
    for (let y = 0; y < grid.height; y++) {
      const weight = grid.rowAreaWeight[y]!;
      for (let x = 0; x < grid.width; x++) {
        const i = y * grid.width + x;
        if (isOcean(elevation[i]!, globals.seaLevel)) {
          sea[i] = 1;
          oceanWeight += weight;
        }
      }
    }

    if (oceanWeight === 0) {
      nutrients.fill(0);
      oceanOxygen.fill(0);
      updateAcidification(globals as ChemistryGlobals, dtYears);
      return;
    }

    const { pattern, coast } = nutrientPattern(
      grid,
      scratch,
      sea,
      oceanWeight,
      elevation,
      fields.discharge,
      fields.upwelling,
      globals.seaLevel,
    );
    const previousBudget = oceanMean(grid, sea, nutrients, oceanWeight);
    const weatheringBudget = Math.max(0, Math.min(MAX_NUTRIENTS, globals.carbon.weathering));
    // A zero-time initialization must produce useful diagnostics. All later changes
    // use the exact exponential solution, independent of the caller's step length.
    const fraction =
      dtYears === 0 && previousBudget === 0
        ? 1
        : -Math.expm1(-Math.max(0, dtYears) / PHOSPHORUS_RESIDENCE_TIME);
    const oxygenPressure = oxygenPartialPressure(globals.atmosphere);
    const atmosphericOxygen = Math.max(0, oxygenPressure / REFERENCE_OXYGEN_PRESSURE);
    for (let i = 0; i < grid.cellCount; i++) {
      if (!sea[i]) {
        nutrients[i] = 0;
        oceanOxygen[i] = 0;
        continue;
      }
      const target = Math.min(MAX_NUTRIENTS, weatheringBudget * pattern[i]!);
      nutrients[i] = nutrients[i]! + (target - nutrients[i]!) * fraction;

      const temperature = Math.max(-2, fields.airTemperature[i]!);
      // Around modern seawater temperatures, oxygen solubility changes by roughly
      // 1.5 percent per degree; values are relative to a 15 C, modern-pO2 ocean.
      const henrySolubility = Math.exp(-0.015 * (temperature - 15));
      const equilibrium = Math.min(1, atmosphericOxygen * henrySolubility);
      const warmth = Math.max(0, Math.min(1, (temperature + 2) / 37));
      const upwelling = Math.max(0, Math.min(1, fields.upwelling[i]! / REFERENCE_UPWELLING));
      const respiration =
        nutrients[i]! *
        (0.025 +
          0.045 * warmth +
          0.04 * warmth ** 4 +
          0.09 * warmth * upwelling +
          0.08 * warmth * coast[i]!);
      oceanOxygen[i] = Math.max(0, Math.min(1, equilibrium - respiration));
    }

    updateAcidification(globals as ChemistryGlobals, dtYears);
  },
};

interface MixingKernel {
  radius: number;
  weights: Float64Array;
}

interface ChemistryScratch {
  sea: Uint8Array;
  coast: Float64Array;
  eastBoundary: Uint8Array;
  raw: Float64Array;
  riverSource: Float64Array;
  upwellingSource: Float64Array;
  horizontal: Float64Array;
  horizontalUpwelling: Float64Array;
  horizontalWeightSum: Float64Array;
  verticalWeightSum: Float64Array;
  river: Float64Array;
  upwelling: Float64Array;
  pattern: Float64Array;
  horizontalKernels: MixingKernel[];
  verticalRadius: number;
  /** Kernel by offset, then source row; includes the source row's cell area. */
  verticalWeights: Float64Array;
}

const chemistryScratchCache = new WeakMap<Grid, ChemistryScratch>();

/** Grid-sized work arrays and physical Gaussian kernels, shared by chemistry steps. */
function chemistryScratch(grid: Grid): ChemistryScratch {
  let scratch = chemistryScratchCache.get(grid);
  if (scratch) return scratch;
  const n = grid.cellCount;
  const cutoff = 3 * NUTRIENT_MIXING_LENGTH;
  const horizontalKernels = Array.from({ length: grid.height }, (_, y) => {
    const dx = grid.rowDx[y]!;
    const radius = Math.min(Math.floor(grid.width / 2), Math.ceil(cutoff / dx));
    const weights = new Float64Array(radius * 2 + 1);
    for (let offset = -radius; offset <= radius; offset++) {
      const distance = offset * dx;
      weights[offset + radius] = Math.exp(
        (-0.5 * distance * distance) / (NUTRIENT_MIXING_LENGTH * NUTRIENT_MIXING_LENGTH),
      );
    }
    return { radius, weights };
  });
  const verticalRadius = Math.min(grid.height - 1, Math.ceil(cutoff / grid.dy));
  const verticalWeights = new Float64Array((verticalRadius * 2 + 1) * grid.height);
  for (let offset = -verticalRadius; offset <= verticalRadius; offset++) {
    const distance = offset * grid.dy;
    const gaussian = Math.exp(
      (-0.5 * distance * distance) / (NUTRIENT_MIXING_LENGTH * NUTRIENT_MIXING_LENGTH),
    );
    const base = (offset + verticalRadius) * grid.height;
    for (let sourceY = 0; sourceY < grid.height; sourceY++) {
      verticalWeights[base + sourceY] = gaussian * grid.rowCellArea[sourceY]!;
    }
  }
  scratch = {
    sea: new Uint8Array(n),
    coast: new Float64Array(n),
    eastBoundary: new Uint8Array(n),
    raw: new Float64Array(n),
    riverSource: new Float64Array(n),
    upwellingSource: new Float64Array(n),
    horizontal: new Float64Array(n),
    horizontalUpwelling: new Float64Array(n),
    horizontalWeightSum: new Float64Array(n),
    verticalWeightSum: new Float64Array(n),
    river: new Float64Array(n),
    upwelling: new Float64Array(n),
    pattern: new Float64Array(n),
    horizontalKernels,
    verticalRadius,
    verticalWeights,
  };
  chemistryScratchCache.set(grid, scratch);
  return scratch;
}

function nutrientPattern(
  grid: Grid,
  scratch: ChemistryScratch,
  sea: Uint8Array,
  oceanWeight: number,
  elevation: Float32Array,
  discharge: Float32Array,
  upwelling: Float32Array,
  seaLevel: number,
): { pattern: Float64Array; coast: Float64Array } {
  const { coast, eastBoundary, raw, riverSource, upwellingSource } = scratch;
  let rawSum = 0;
  let rawMaximum = 0;
  const { width, height, rowAreaWeight } = grid;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      if (!sea[i]) continue;
      const east = row + ((x + 1) % width);
      const west = row + ((x - 1 + width) % width);
      eastBoundary[i] = !sea[east] ? 1 : 0;
      coast[i] =
        !sea[east] ||
        !sea[west] ||
        (y > 0 && !sea[i - width]) ||
        (y < height - 1 && !sea[i + width])
          ? 1
          : 0;
      riverSource[i] = Math.min(
        2,
        Math.log1p(Math.max(0, discharge[i]!) / REFERENCE_RIVER_DISCHARGE),
      );
      upwellingSource[i] = Math.max(0, Math.min(1, upwelling[i]! / REFERENCE_UPWELLING));
    }
  }

  // A physical mixing length avoids one-cell bands changing width with grid
  // resolution. Area weighting matters in the north-south pass because an
  // equirectangular cell represents progressively less sea towards the poles.
  smoothOceanFields(grid, sea, riverSource, upwellingSource, scratch);
  const river = scratch.river;
  const up = scratch.upwelling;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const weight = rowAreaWeight[y]!;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      if (!sea[i]) continue;
      const shelf = Math.max(0, Math.min(1, 1 - (seaLevel - elevation[i]!) / SHELF_DEPTH));
      // Keep subtropical interiors oligotrophic, while river plumes, shelves and
      // especially eastern-boundary upwelling dominate the visible structure.
      raw[i] =
        0.4 +
        0.65 * shelf +
        0.75 * river[i]! +
        up[i]! * (0.55 + 0.45 * coast[i]! + 0.45 * eastBoundary[i]!);
      rawSum += raw[i]! * weight;
      rawMaximum = Math.max(rawMaximum, raw[i]!);
    }
  }
  return {
    pattern: normalizeOceanPattern(
      grid,
      sea,
      raw,
      oceanWeight,
      rawSum,
      rawMaximum,
      scratch.pattern,
    ),
    coast,
  };
}

/** Gaussian lateral mixing over sea cells, separable for a linear-time local stencil. */
function smoothOceanFields(
  grid: Grid,
  sea: Uint8Array,
  riverSource: Float64Array,
  upwellingSource: Float64Array,
  scratch: ChemistryScratch,
): void {
  const { width, height } = grid;
  const {
    horizontal,
    horizontalUpwelling,
    horizontalKernels,
    horizontalWeightSum,
    verticalRadius,
    verticalWeights,
    verticalWeightSum,
    river,
    upwelling,
  } = scratch;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const { radius, weights } = horizontalKernels[y]!;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      if (!sea[i]) continue;
      let riverSum = 0;
      let upwellingSum = 0;
      let weightSum = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        let sourceX = x + offset;
        if (sourceX < 0) sourceX += width;
        else if (sourceX >= width) sourceX -= width;
        const j = row + sourceX;
        if (!sea[j]) continue;
        const weight = weights[offset + radius]!;
        riverSum += riverSource[j]! * weight;
        upwellingSum += upwellingSource[j]! * weight;
        weightSum += weight;
      }
      horizontalWeightSum[i] = weightSum;
      horizontal[i] = weightSum > 0 ? riverSum / weightSum : riverSource[i]!;
      horizontalUpwelling[i] =
        weightSum > 0 ? upwellingSum / weightSum : upwellingSource[i]!;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!sea[i]) continue;
      let riverSum = 0;
      let upwellingSum = 0;
      let weightSum = 0;
      for (let offset = -verticalRadius; offset <= verticalRadius; offset++) {
        const sourceY = y + offset;
        if (sourceY < 0 || sourceY >= height) continue;
        const j = sourceY * width + x;
        if (!sea[j]) continue;
        const weight = verticalWeights[(offset + verticalRadius) * height + sourceY]!;
        riverSum += horizontal[j]! * weight;
        upwellingSum += horizontalUpwelling[j]! * weight;
        weightSum += weight;
      }
      verticalWeightSum[i] = weightSum;
      river[i] = weightSum > 0 ? riverSum / weightSum : horizontal[i]!;
      upwelling[i] = weightSum > 0 ? upwellingSum / weightSum : horizontalUpwelling[i]!;
    }
  }
}

/** Normalize to ocean mean one while retaining the documented 0..3 field bound. */
function normalizeOceanPattern(
  grid: Grid,
  sea: Uint8Array,
  raw: Float64Array,
  oceanWeight: number,
  rawSum: number,
  rawMaximum: number,
  pattern: Float64Array,
): Float64Array {
  let scale = oceanWeight / rawSum;
  if (rawMaximum * scale > MAX_NUTRIENTS) {
    // Active-set water filling: capped plume cells contribute three, while one
    // rescaling makes all remaining cells supply the rest of the unit mean.
    for (let iteration = 0; iteration < 12; iteration++) {
      let cappedWeight = 0;
      let uncappedRaw = 0;
      for (let y = 0; y < grid.height; y++) {
        const weight = grid.rowAreaWeight[y]!;
        for (let x = 0; x < grid.width; x++) {
          const i = y * grid.width + x;
          if (!sea[i]) continue;
          if (raw[i]! * scale >= MAX_NUTRIENTS) cappedWeight += weight;
          else uncappedRaw += raw[i]! * weight;
        }
      }
      const nextScale =
        uncappedRaw > 0 ? (oceanWeight - MAX_NUTRIENTS * cappedWeight) / uncappedRaw : scale;
      if (Math.abs(nextScale - scale) < 1e-10) break;
      scale = nextScale;
    }
  }
  for (let i = 0; i < raw.length; i++) {
    if (sea[i]) pattern[i] = Math.min(MAX_NUTRIENTS, raw[i]! * scale);
  }
  return pattern;
}

function oceanMean(
  grid: Grid,
  sea: Uint8Array,
  values: ArrayLike<number>,
  oceanWeight: number,
): number {
  let sum = 0;
  for (let y = 0; y < grid.height; y++) {
    const weight = grid.rowAreaWeight[y]!;
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      if (sea[i]) sum += values[i]! * weight;
    }
  }
  return sum / oceanWeight;
}

function updateAcidification(globals: ChemistryGlobals, dtYears: number): void {
  const co2 = Math.max(1e-6, globals.atmosphere.co2);
  let buffered = globals.oceanBufferedCo2;
  if (!(buffered !== undefined && Number.isFinite(buffered) && buffered > 0)) {
    // Preserve a transient from any save with the public pH diagnostic but without
    // this private reservoir; placeholder-era saves simply initialize at equilibrium.
    buffered = co2 / 10 ** (Math.max(0, globals.oceanAcidity) / 0.4);
  }
  const fraction = -Math.expm1(-Math.max(0, dtYears) / CARBONATE_BUFFER_TIME);
  buffered += (co2 - buffered) * fraction;
  globals.oceanBufferedCo2 = Math.max(1e-6, buffered);
  globals.oceanAcidity = Math.max(
    0,
    Math.min(0.7, 0.4 * Math.log10(co2 / globals.oceanBufferedCo2)),
  );
}
