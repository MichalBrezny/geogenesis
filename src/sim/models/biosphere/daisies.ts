import type { SimComponent } from '../../core/component';
import { getTopology, NEIGHBOR_COUNT, type Grid } from '../../core/grid';
import { SEA_LEVEL } from '../geosphere/flowRouting';
import { BLACK_DAISY_ALBEDO, LAND_ALBEDO, WHITE_DAISY_ALBEDO } from '../atmosphere/surfaceAlbedo';

/** Temperature (°C) at which daisies grow fastest, and the half-width of their range. */
const OPTIMUM_TEMPERATURE = 22.5;
const GROWTH_HALF_WIDTH = 17.5;
/** Fraction of daisies dying per generation (Watson & Lovelock 1983). */
const DEATH_RATE = 0.3;
/**
 * How much warmer (°C) a patch is than its surroundings per unit of albedo it
 * is darker: dark daisies warm their own patch (≈ 20 K in the original model).
 */
const LOCAL_HEATING = 20;
/** Seed cover that always remains, so daisies can return once conditions allow. */
const SEED_COVER = 0.001;
/** Generations simulated per step; daisies settle within tens of generations. */
const GENERATIONS_PER_STEP = 40;
/**
 * Share of the newly settled cover adopted each step. The cell temperature only
 * responds to the daisies on the next step, so jumping straight to the new
 * balance could overshoot and oscillate.
 */
const RELAXATION = 0.5;
/**
 * Share of each cell's cover exchanged with its neighbours per step (seed
 * dispersal), which turns cell-by-cell winners into coherent stands and fronts.
 */
const DISPERSAL = 0.2;

export interface DaisyOptions {
  /** Albedo of bare ground; must match the surface albedo model. */
  groundAlbedo?: number;
}

/** Growth rate of daisies at a temperature (parabola peaking at the optimum, 0 outside 5–40 °C). */
export function daisyGrowth(temperature: number): number {
  const d = (temperature - OPTIMUM_TEMPERATURE) / GROWTH_HALF_WIDTH;
  return Math.max(0, 1 - d * d);
}

/**
 * Daisyworld (Watson & Lovelock 1983) on the grid: white and black daisies
 * compete for bare ground in every land cell. Each species' patches are warmer
 * or cooler than the cell according to their albedo; growth peaks at 22.5 °C.
 * Black daisies spread on cold worlds and warm them, white ones on hot worlds
 * and cool them, so the planet's temperature stays near the optimum over a wide
 * range of star brightness — self-regulation with no foresight.
 *
 * Daisies live far shorter than a step, so each step runs enough generations to
 * reach the balance for the current climate; the climate answers next step.
 */
export function createDaisies(options: DaisyOptions = {}): SimComponent {
  const groundAlbedo = options.groundAlbedo ?? LAND_ALBEDO;
  return {
    name: 'daisies',
    inputs: ['elevation', 'airTemperature', 'iceCover'],
    outputs: ['daisyWhite', 'daisyBlack'],
    runOneStep(state) {
      const { elevation, airTemperature, iceCover, daisyWhite, daisyBlack } = state.fields;
      for (let i = 0; i < elevation.length; i++) {
        if (elevation[i]! < SEA_LEVEL) {
          daisyWhite[i] = 0;
          daisyBlack[i] = 0;
          continue;
        }
        // Ice buries the ground; only the ice-free part can be colonised.
        const fertile = 1 - iceCover[i]!;
        let white = Math.max(daisyWhite[i]!, SEED_COVER * fertile);
        let black = Math.max(daisyBlack[i]!, SEED_COVER * fertile);
        const cellTemperature = airTemperature[i]!;
        for (let generation = 0; generation < GENERATIONS_PER_STEP; generation++) {
          const bare = Math.max(0, fertile - white - black);
          // Patches are warmer or cooler than the cell according to their albedo.
          const meanAlbedo =
            (groundAlbedo * bare + WHITE_DAISY_ALBEDO * white + BLACK_DAISY_ALBEDO * black) /
            Math.max(fertile, 1e-6);
          const whiteGrowth = daisyGrowth(
            cellTemperature + LOCAL_HEATING * (meanAlbedo - WHITE_DAISY_ALBEDO),
          );
          const blackGrowth = daisyGrowth(
            cellTemperature + LOCAL_HEATING * (meanAlbedo - BLACK_DAISY_ALBEDO),
          );
          white += 0.5 * white * (bare * whiteGrowth - DEATH_RATE);
          black += 0.5 * black * (bare * blackGrowth - DEATH_RATE);
          white = Math.max(SEED_COVER * fertile, white);
          black = Math.max(SEED_COVER * fertile, black);
        }
        daisyWhite[i] = daisyWhite[i]! + RELAXATION * (white - daisyWhite[i]!);
        daisyBlack[i] = daisyBlack[i]! + RELAXATION * (black - daisyBlack[i]!);
      }
      disperse(state.grid, elevation, daisyWhite);
      disperse(state.grid, elevation, daisyBlack);
    },
  };
}

/** Moves part of each land cell's cover towards the mean of its land neighbours. */
function disperse(grid: Grid, elevation: Float32Array, cover: Float32Array): void {
  const { neighbors } = getTopology(grid);
  const source = Float32Array.from(cover);
  for (let i = 0; i < cover.length; i++) {
    if (elevation[i]! < SEA_LEVEL) continue;
    let sum = 0;
    let count = 0;
    for (let d = 0; d < NEIGHBOR_COUNT; d += 2) {
      const n = neighbors[i * NEIGHBOR_COUNT + d]!;
      if (n < 0 || elevation[n]! < SEA_LEVEL) continue;
      sum += source[n]!;
      count++;
    }
    if (count > 0) cover[i] = source[i]! + DISPERSAL * (sum / count - source[i]!);
  }
}
