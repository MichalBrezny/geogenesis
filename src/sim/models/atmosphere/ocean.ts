import type { SimComponent } from '../../core/component';
import type { Grid } from '../../core/grid';
import { SEA_LEVEL } from '../geosphere/flowRouting';
import {
  averageToCoarse,
  getAtmosphereGrid,
  interpolateToFine,
  type AtmosphereGrid,
} from './atmosphereGrid';

const AIR_DENSITY = 1.2;
const SEA_WATER_DENSITY = 1025;
/** Bulk drag coefficient of wind on the sea surface. */
const DRAG_COEFFICIENT = 1.3e-3;
const EARTH_ROTATION = 7.292e-5;
/** Depth (m) of the wind-driven surface layer the gyres' transport is spread over. */
const SURFACE_LAYER_DEPTH = 600;
/** Basins wider than this share of a circle of latitude lose their gyres (see solveGyres). */
const OPEN_SEA_SHARE = 0.7;
/**
 * Share of the zonal wind the sea surface drifts with, for the equatorial and
 * circumpolar currents. (The meridional part of the wind's drag is the Ekman
 * transport, handled as upwelling.)
 */
const WIND_DRIFT = 0.005;
/**
 * Width of the western boundary currents in coarse cells (Stommel's frictional
 * layer). Real ones are ~100 km wide; the coarse grid needs them resolved.
 */
const BOUNDARY_LAYER_CELLS = 1.5;
/**
 * How strongly currents carrying water across the background temperature
 * gradient change the sea surface temperature (s): poleward western boundary
 * currents warm, equatorward eastern ones cool.
 */
const ADVECTION_TIME = 200 * 86_400;
/** Cooling (°C) per m/day of upwelling (Ekman suction brings up cold deep water). */
const UPWELLING_COOLING = 6;
/** Anomalies fade out between these latitudes (degrees), where sea ice takes over. */
const POLAR_FADE_START = 60;
const POLAR_FADE_END = 80;
/** Sea surface temperature anomalies stay within this range (°C). */
const MAX_ANOMALY = 8;
/** Share of the neighbouring sea's anomaly a coastal land cell feels. */
const COASTAL_SHARE = 0.6;
/** Coriolis parameter is not allowed below its value at this latitude (Ekman blows up at the equator). */
const MIN_EKMAN_LATITUDE = 5;

/**
 * Wind-driven ocean circulation and its imprint on sea surface temperatures.
 *
 * The gyres follow Stommel's (1948) model, with the wind stress τ of the
 * circulation's surface winds: the Sverdrup balance β ∂ψ/∂x = curl τ / ρ in each
 * basin's interior, closed by a frictional current along its western coast —
 * the planet's rotation (β) squeezes every gyre's return flow there. The wind
 * also drags the surface along (equatorial and circumpolar currents). Ekman transport under the wind pulls water away from
 * coasts and from the equator, where cold deep water wells up.
 *
 * The sea surface temperature anomaly combines both: currents carrying water
 * across the climate's temperature gradient (warm western boundary currents
 * flowing poleward, cool eastern ones flowing equatorward) and upwelling. It
 * has no net heat (its ocean mean is removed) and spills onto coasts; the
 * climate model adds it to the temperatures, which also changes evaporation —
 * cold currents make foggy coastal deserts.
 */
export const oceanModel: SimComponent = {
  name: 'ocean',
  inputs: ['elevation', 'airTemperature', 'windU', 'windV', 'oceanAnomaly'],
  outputs: ['oceanCurrentU', 'oceanCurrentV', 'oceanAnomaly'],
  runOneStep(state) {
    const { grid, fields } = state;
    const atmosphere = getAtmosphereGrid(grid);
    const { coarse } = atmosphere;
    const n = coarse.cellCount;
    const landShare = averageToCoarse(
      atmosphere,
      grid,
      Array.from(fields.elevation, (e) => (e >= SEA_LEVEL ? 1 : 0)),
      new Float64Array(n),
    );
    const sea = new Uint8Array(n);
    for (let c = 0; c < n; c++) sea[c] = landShare[c]! < 0.5 ? 1 : 0;
    const isSea = (i: number) => (fields.elevation[i]! < SEA_LEVEL ? 1 : 0);
    const u = averageToCoarse(atmosphere, grid, fields.windU, new Float64Array(n));
    const v = averageToCoarse(atmosphere, grid, fields.windV, new Float64Array(n));
    // The climate's temperatures include the last anomaly; take it out, so the
    // anomaly is computed from the background state and does not feed on itself.
    const background = Float32Array.from(
      fields.airTemperature,
      (t, i) => t - fields.oceanAnomaly[i]!,
    );
    const temperature = averageToCoarse(
      atmosphere,
      grid,
      background,
      new Float64Array(n),
      isSea,
      NaN,
    );

    const { stressX, stressY } = windStress(u, v);
    const psi = solveGyres(coarse, sea, curl(coarse, stressX, stressY));
    const { gyreU, gyreV } = gyreCurrents(coarse, sea, psi);
    const upwelling = ekmanUpwelling(coarse, sea, stressX, stressY);
    const anomaly = surfaceAnomaly(coarse, sea, temperature, gyreV, upwelling);
    // What a drifting buoy would follow: the gyres plus the wind's drag.
    const currentU = gyreU.map((value, c) => (sea[c] ? value + WIND_DRIFT * u[c]! : 0));
    const currentV = gyreV;
    spillOntoCoasts(coarse, sea, anomaly);

    toFine(atmosphere, grid, currentU, fields.oceanCurrentU);
    toFine(atmosphere, grid, currentV, fields.oceanCurrentV);
    toFine(atmosphere, grid, anomaly, fields.oceanAnomaly);
    // Currents exist only at sea.
    for (let i = 0; i < grid.cellCount; i++) {
      if (!isSea(i)) {
        fields.oceanCurrentU[i] = 0;
        fields.oceanCurrentV[i] = 0;
      }
    }
  },
};

function toFine(atmosphere: AtmosphereGrid, grid: Grid, values: Float64Array, out: Float32Array) {
  if (atmosphere.coarse === grid) {
    for (let i = 0; i < values.length; i++) out[i] = values[i]!;
  } else {
    interpolateToFine(atmosphere, grid, values, out);
  }
}

function windStress(u: Float64Array, v: Float64Array) {
  const stressX = new Float64Array(u.length);
  const stressY = new Float64Array(u.length);
  for (let c = 0; c < u.length; c++) {
    const speed = Math.hypot(u[c]!, v[c]!);
    stressX[c] = AIR_DENSITY * DRAG_COEFFICIENT * speed * u[c]!;
    stressY[c] = AIR_DENSITY * DRAG_COEFFICIENT * speed * v[c]!;
  }
  return { stressX, stressY };
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Vertical component of the curl of the wind stress, N/m³. */
function curl(coarse: Grid, tx: Float64Array, ty: Float64Array): Float64Array {
  const { width, height, rowLatitude, rowDx, dy } = coarse;
  const out = new Float64Array(coarse.cellCount);
  const cos = (y: number) => Math.cos(radians(rowLatitude[y]!));
  for (let y = 0; y < height; y++) {
    const yn = Math.max(0, y - 1);
    const ys = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const east = y * width + ((x + 1) % width);
      const west = y * width + ((x - 1 + width) % width);
      const dtydx = (ty[east]! - ty[west]!) / (2 * rowDx[y]!);
      // Northward is towards smaller y.
      const dtxdy =
        (tx[yn * width + x]! * cos(yn) - tx[ys * width + x]! * cos(ys)) / ((ys - yn) * dy * cos(y));
      out[y * width + x] = dtydx - dtxdy;
    }
  }
  return out;
}

/**
 * Transport streamfunction ψ (m³/s) of the wind-driven gyres, after Stommel's
 * (1948) solution: in the interior of each basin the Sverdrup balance
 * β ∂ψ/∂x = curl τ / ρ holds, integrated westward from the basin's eastern
 * coast (ψ = 0); the return flow closes in a frictional layer along the western
 * coast, ψ → 0 as 1 − exp(−distance / δ). Rows of sea that circle the planet
 * have no coasts to hold gyres and get none.
 */
function solveGyres(coarse: Grid, sea: Uint8Array, curlTau: Float64Array): Float64Array {
  const { width, height, rowLatitude, rowDx, radius } = coarse;
  const psi = new Float64Array(coarse.cellCount);
  for (let y = 0; y < height; y++) {
    const beta = (2 * EARTH_ROTATION * Math.cos(radians(rowLatitude[y]!))) / radius;
    const dx = rowDx[y]!;
    const row = y * width;
    let landAt = -1;
    for (let x = 0; x < width; x++) if (!sea[row + x]) landAt = x;
    if (landAt < 0 || beta <= 0) continue;
    // Walk west from just west of a land cell, so every basin starts at its eastern coast.
    let interior = 0;
    let basin: number[] = [];
    const closeBasin = () => {
      // Sverdrup's balance needs coasts to stand on: in seas that nearly circle the
      // planet (a Southern Ocean) it fades out, as the flow there is circumpolar.
      const fade = Math.max(0, Math.min(1, (OPEN_SEA_SHARE - basin.length / width) / 0.2));
      // basin[0] is the easternmost cell, basin[basin.length - 1] the westernmost.
      for (let k = 0; k < basin.length; k++) {
        const fromWest = (basin.length - 1 - k + 0.5) * dx;
        psi[row + basin[k]!] =
          psi[row + basin[k]!]! * fade * (1 - Math.exp(-fromWest / (BOUNDARY_LAYER_CELLS * dx)));
      }
      basin = [];
      interior = 0;
    };
    for (let step = 1; step <= width; step++) {
      const x = (((landAt - step) % width) + width) % width;
      const c = row + x;
      if (!sea[c]) {
        closeBasin();
        continue;
      }
      // Sverdrup: ψ(x) = −(1/β) ∫ from x to the east coast of curl τ / ρ dx'.
      interior -= (curlTau[c]! / SEA_WATER_DENSITY / beta) * dx;
      psi[c] = interior + (curlTau[c]! / SEA_WATER_DENSITY / beta) * dx * 0.5;
      basin.push(x);
    }
    closeBasin();
  }
  return smoothAcrossRows(coarse, sea, psi);
}

/** Rows are integrated separately; two [1 2 1] passes across rows (sea only) remove row-to-row noise. */
function smoothAcrossRows(coarse: Grid, sea: Uint8Array, values: Float64Array): Float64Array {
  const { width, height } = coarse;
  let current = values;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float64Array(current.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = y * width + x;
        if (!sea[c]) continue;
        const north = y > 0 && sea[c - width] ? current[c - width]! : current[c]!;
        const south = y < height - 1 && sea[c + width] ? current[c + width]! : current[c]!;
        next[c] = (north + 2 * current[c]! + south) / 4;
      }
    }
    current = next;
  }
  return current;
}

/** Surface current (m/s) of the gyres: their transport spread over the surface layer. */
function gyreCurrents(coarse: Grid, sea: Uint8Array, psi: Float64Array) {
  const { width, height, rowDx, dy } = coarse;
  const gyreU = new Float64Array(coarse.cellCount);
  const gyreV = new Float64Array(coarse.cellCount);
  const at = (c: number) => (sea[c] ? psi[c]! : 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = y * width + x;
      if (!sea[c]) continue;
      const east = at(y * width + ((x + 1) % width));
      const west = at(y * width + ((x - 1 + width) % width));
      const northValue = y > 0 ? at(c - width) : 0;
      const southValue = y < height - 1 ? at(c + width) : 0;
      // u = −∂ψ/∂y_north, v = ∂ψ/∂x (northward is towards smaller y).
      gyreU[c] = -(northValue - southValue) / (2 * dy) / SURFACE_LAYER_DEPTH;
      gyreV[c] = (east - west) / (2 * rowDx[y]!) / SURFACE_LAYER_DEPTH;
    }
  }
  return { gyreU, gyreV };
}

/**
 * Ekman pumping (m/s, positive = upwelling) from the divergence of the Ekman
 * transport, which runs at right angles to the wind (to the right in the north).
 * Coasts block it, so offshore Ekman transport wells up along them.
 */
function ekmanUpwelling(
  coarse: Grid,
  sea: Uint8Array,
  stressX: Float64Array,
  stressY: Float64Array,
): Float64Array {
  const { width, height, rowLatitude, rowDx, dy } = coarse;
  const n = coarse.cellCount;
  const mx = new Float64Array(n);
  const my = new Float64Array(n);
  for (let y = 0; y < height; y++) {
    const latitude = rowLatitude[y]!;
    const sign = latitude >= 0 ? 1 : -1;
    const f =
      sign *
      2 *
      EARTH_ROTATION *
      Math.sin(radians(Math.max(MIN_EKMAN_LATITUDE, Math.abs(latitude))));
    for (let x = 0; x < width; x++) {
      const c = y * width + x;
      if (!sea[c]) continue;
      mx[c] = stressY[c]! / (SEA_WATER_DENSITY * f);
      my[c] = -stressX[c]! / (SEA_WATER_DENSITY * f);
    }
  }
  const upwelling = new Float64Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = y * width + x;
      if (!sea[c]) continue;
      const east = y * width + ((x + 1) % width);
      const west = y * width + ((x - 1 + width) % width);
      // Transport across each face: averaged between sea cells, zero against land.
      const face = (a: number, b: number, values: Float64Array) =>
        sea[b] ? (values[a]! + values[b]!) / 2 : 0;
      const divX = (face(c, east, mx) - face(c, west, mx)) / rowDx[y]!;
      const northFace = y > 0 ? face(c, c - width, my) : 0;
      const southFace = y < height - 1 ? face(c, c + width, my) : 0;
      const divY = (northFace - southFace) / dy;
      upwelling[c] = divX + divY;
    }
  }
  return upwelling;
}

/**
 * Sea surface temperature anomaly (°C) at sea cells, with no net heat. Currents
 * carry water across the zonal-mean temperature gradient (so the anomaly cannot
 * feed on itself and drift around), upwelling cools; both fade out towards the
 * poles, where sea ice rules the surface.
 */
function surfaceAnomaly(
  coarse: Grid,
  sea: Uint8Array,
  temperature: Float64Array,
  currentV: Float64Array,
  upwelling: Float64Array,
): Float64Array {
  const { width, height, dy, rowAreaWeight, rowLatitude } = coarse;
  const anomaly = new Float64Array(coarse.cellCount);
  // Zonal-mean sea temperature of each row (NaN for rows without sea).
  const rowMean = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    let count = 0;
    for (let x = 0; x < width; x++) {
      const t = temperature[y * width + x]!;
      if (sea[y * width + x] && !Number.isNaN(t)) {
        sum += t;
        count++;
      }
    }
    rowMean[y] = count > 0 ? sum / count : NaN;
  }
  const meanAt = (y: number, fallback: number) =>
    y >= 0 && y < height && !Number.isNaN(rowMean[y]!) ? rowMean[y]! : fallback;
  let sum = 0;
  let weight = 0;
  for (let y = 0; y < height; y++) {
    const here = meanAt(y, 0);
    // Northward is towards smaller y.
    const dTdy = (meanAt(y - 1, here) - meanAt(y + 1, here)) / (2 * dy);
    const latitude = Math.abs(rowLatitude[y]!);
    const polarFade = Math.max(
      0,
      Math.min(1, (POLAR_FADE_END - latitude) / (POLAR_FADE_END - POLAR_FADE_START)),
    );
    for (let x = 0; x < width; x++) {
      const c = y * width + x;
      if (!sea[c]) continue;
      const advection = -currentV[c]! * dTdy * ADVECTION_TIME;
      const cooling = -UPWELLING_COOLING * Math.max(0, upwelling[c]!) * 86_400;
      const value = polarFade * Math.max(-MAX_ANOMALY, Math.min(MAX_ANOMALY, advection + cooling));
      anomaly[c] = value;
      sum += value * rowAreaWeight[y]!;
      weight += rowAreaWeight[y]!;
    }
  }
  const mean = weight > 0 ? sum / weight : 0;
  for (let c = 0; c < anomaly.length; c++) if (sea[c]) anomaly[c] = anomaly[c]! - mean;
  return anomaly;
}

/** Coastal land feels part of the neighbouring sea's anomaly (sea breezes, fog). */
function spillOntoCoasts(coarse: Grid, sea: Uint8Array, anomaly: Float64Array): void {
  const { width, height } = coarse;
  const source = Float64Array.from(anomaly);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = y * width + x;
      if (sea[c]) continue;
      let sum = 0;
      let count = 0;
      const neighbours = [
        y * width + ((x + 1) % width),
        y * width + ((x - 1 + width) % width),
        y > 0 ? c - width : -1,
        y < height - 1 ? c + width : -1,
      ];
      for (const j of neighbours) {
        if (j >= 0 && sea[j]) {
          sum += source[j]!;
          count++;
        }
      }
      anomaly[c] = count > 0 ? (COASTAL_SHARE * sum) / count : 0;
    }
  }
}
