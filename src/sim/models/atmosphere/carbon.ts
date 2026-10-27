import type { SimComponent } from '../../core/component';
import { areaWeightedMean, EARTH_RADIUS } from '../../core/grid';
import {
  createCarbonBudgetDiagnostic,
  EARTH_SURFACE_GRAVITY,
  type CarbonFluxDiagnostic,
  type PlanetState,
} from '../../core/planet';
import { Biome, BIOMES } from '../../data/biomes';
import { isOcean, liquidWaterGel } from '../geosphere/seaLevel';
import { MODERN_PHOTOSYNTHESIS, photosynthesis } from './biogeochemistry';
import { updateSurfacePressure } from './atmosphere';
import { greenhouseForcing } from './climate';

export interface CarbonCycleOptions {
  /** Multiplier on volcanic CO₂ outgassing (a future player control). */
  volcanism?: number;
  /** Ceiling on CO₂ (microbar) for this instance; the spin-up honours a requested inventory. */
  maxCo2?: number;
}

/**
 * Typical surface speed of Earth's plates (m/yr); outgassing scales with the
 * planet's mean plate speed relative to this, since spreading ridges and
 * subduction volcanoes release the CO₂.
 */
const REFERENCE_PLATE_SPEED = 0.035;
/** Silicate weathering speeds up by this factor per °C (Walker et al. 1981). */
const WEATHERING_TEMPERATURE_SENSITIVITY = 0.09;
/** Weathering ∝ (CO₂ / 280 ppm)^this, from acidified soil water. */
const WEATHERING_CO2_EXPONENT = 0.3;
/** CO₂ (ppm) at which weathering is halved by lack of carbon; it cannot remove CO₂ that is gone. */
const WEATHERING_CO2_HALF_SATURATION = 10;
/** Weathering of bare rock relative to an average vegetated surface (plants speed it up ~3×). */
const BARREN_WEATHERING = 0.35;
/** Share of outgassing from hotspots and other volcanism independent of plate motion. */
export const HOTSPOT_SHARE = 0.3;
/** E-folding time (years) of the excess heat of a young planet's mantle. */
const MANTLE_COOLING_TIME = 2.5e9;
/**
 * Raw weathering sum (see `rawWeathering`) that counts as the present-day carbon
 * flux. Calibrated (with the moisture-budget precipitation) so random planets settle
 * at roughly 13–16 °C half a billion years after complex life appears.
 */
const REFERENCE_WEATHERING = 0.47;
/**
 * Years for the atmosphere–ocean CO₂ reservoir to change by its own size under a
 * unit flux imbalance. Earth's exchangeable carbon responds over a few hundred
 * thousand years.
 */
const RESERVOIR_TIME = 300_000;
/**
 * Organic carbon buried in sediments by a modern Earth-like biosphere, as a share
 * of the present-day carbon flux (Earth: about a fifth; the rest is silicate
 * weathering). Burial is what leaves oxygen behind in the air.
 */
export const MODERN_BURIAL = 0.2;
/** Geological loss time of accessible coal, oil and gas deposits. */
export const FOSSIL_CARBON_LOSS_TIME = 3e8;
/** Modern organic-carbon burial, in Gt C/yr. */
const MODERN_BURIAL_GT_C_PER_YEAR = 0.1;
/** Tiny share of burial that ultimately remains recoverable after geological processing. */
const RECOVERABLE_BURIAL_SHARE = 2.5e-4;
/** Global warming per e-fold of CO₂ (°C) near 280 ppm, used to predict temperature while solving for CO₂. */
const CLIMATE_SENSITIVITY = 2.6;
/** CO₂ forcing per e-fold at the pre-industrial level (W/m², Myhre et al. 1998). */
const MODERN_CO2_FORCING_PER_EFOLD = 5.35;
/**
 * Share of the present-day carbon sink taken by seafloor weathering: hot seawater reacting
 * with young basalt at the ridges (Earth: up to about a tenth). It grows with spreading, ocean
 * area and the mantle's heat (hotter crust, more hydrothermal circulation), so a young water
 * world with little land still has a thermostat, while mature planets barely feel it.
 */
const SEAFLOOR_SHARE = 0.08;
/** Seafloor weathering speeds up by this factor per °C of the (surface-coupled) bottom water. */
const SEAFLOOR_TEMPERATURE_SENSITIVITY = 0.04;
/** Seafloor weathering ∝ (CO₂ / 280 ppm)^this (Coogan & Gillis 2013 range). */
const SEAFLOOR_CO2_EXPONENT = 0.23;
/** Ocean share of the surface the seafloor share is defined for. */
const REFERENCE_OCEAN_FRACTION = 0.7;
const REFERENCE_CO2 = 280;
/** Above this exposed-land share, continental weathering needs no marine backstop. */
const SEAFLOOR_LAND_THRESHOLD = 0.22;
/** Extra warm-basalt circulation at 15 °C on a planet with no exposed land. */
const MAX_LOW_LAND_SEAFLOOR_BOOST = 1.5;
/**
 * Per-°C sensitivity of that extra circulation: an activation energy near the upper
 * end of Krissansen-Totton et al. (2018), so the backstop barely cools a cold young
 * planet but bites hard before a warm low-land world can run away.
 */
const LOW_LAND_SEAFLOOR_TEMPERATURE_SENSITIVITY = 0.1;
const MIN_CO2 = 1;
/** 100 bar in microbar: enough for a Venus-like 90 bar CO2 atmosphere. */
export const MAX_CO2 = 1e8;
/** Rain-bearing planets weather before reaching the former 1-bar CO2 guardrail. */
const MAX_WET_CO2 = 3e6;
/**
 * E-folding time (years) of the crustal carbon reservoir at unit volcanic activity
 * when nothing takes CO₂ back. Net degassing is first order in the carbon left: the
 * carbonates and carbon-bearing mantle that volcanism, burial heating and crustal
 * recycling liberate get scarcer as they are used up. A far-future Earth that lost its
 * oceans (stagnant lid, activity ≈ 0.08) then releases its ~80 bar at ~20 bar/Gyr
 * at first and approaches a Venus-like inventory over a few Gyr; a cold, small,
 * nearly extinct Mars (activity ≈ 0.02) releases almost nothing.
 */
export const DRY_DEGASSING_TIME = 3e8;

/** Clears per-step carbon accounting before any civilization, device or natural flux runs. */
export const resetCarbonBudget: SimComponent = {
  name: 'carbonBudgetReset',
  inputs: [],
  outputs: [],
  runOneStep(state) {
    state.globals.carbonBudget = createCarbonBudgetDiagnostic();
  },
};

/** Writes one signed carbon rate in the two equivalent diagnostic units. */
export function carbonFluxDiagnostic(
  microbarPerYear: number,
  state: PlanetState,
): CarbonFluxDiagnostic {
  const rate = microbarPerYear === 0 ? 0 : microbarPerYear;
  return {
    microbarPerYear: rate,
    gtCarbonPerYear: rate * gtCarbonPerMicrobar(state),
  };
}

/**
 * Long-term (geological) carbon cycle: the silicate-weathering thermostat.
 *
 * Volcanoes add CO₂; rain on warm, exposed rock removes it by weathering, which
 * speeds up as the planet warms. Photosynthesis removes some more by burying
 * organic carbon (the source of oxygen), so a thriving biosphere cools its planet. The resulting negative feedback keeps the
 * climate habitable as the star brightens, until CO₂ drawdown can no longer
 * prevent a runaway greenhouse — the self-regulation at the heart of SimEarth's Gaia theme.
 *
 * The reservoir responds faster than one simulation step, so the new CO₂ is
 * found implicitly: temperatures are extrapolated from the last climate
 * solution with a climate sensitivity, and the balance
 *   ΔC/C = (outgassing − weathering(C) − burial) · Δt / RESERVOIR_TIME
 * is solved for C by bisection in log space.
 */
export function createCarbonCycle(options: CarbonCycleOptions = {}): SimComponent {
  const volcanism = options.volcanism ?? 1;
  const ceiling = options.maxCo2 ?? MAX_CO2;
  return {
    name: 'carbonCycle',
    inputs: [
      'elevation',
      'airTemperature',
      'precipitation',
      'iceCover',
      'plateId',
      'biome',
      'vegetation',
      'volcanicActivity',
    ],
    outputs: [],
    runOneStep(state, dtYears) {
      const activity = spatialVolcanicActivity(state);
      const outgassing =
        volcanism * state.controls.volcanism * (activity + state.globals.lipOutgassing);
      const atmosphere = state.globals.atmosphere;
      // Industry runs before the carbon cycle. Put its finite-reserve pulse into the
      // exchangeable atmosphere here, so weathering and greenhouse-predicted warming
      // respond in the same implicit solve as every natural carbon flux.
      const industrialRise = gtCarbonToMicrobar(
        Math.max(0, state.globals.civilizationCarbonEmissions),
        state,
      );
      const beforeIndustry = atmosphere.co2;
      if (industrialRise > 0) atmosphere.co2 = Math.min(ceiling, atmosphere.co2 + industrialRise);
      const industrialRate =
        dtYears > 0 ? Math.max(0, atmosphere.co2 - beforeIndustry) / dtYears : 0;
      state.globals.carbonBudget.civilizationEmissions = carbonFluxDiagnostic(
        industrialRate,
        state,
      );
      state.globals.civilizationCarbonEmissions = 0;
      const before = atmosphere.co2;
      // Burial needs carbon to fix: it fades out as CO₂ runs out, like weathering.
      const burialAt = (co2: number) =>
        MODERN_BURIAL *
        (photosynthesis(state.biota.cover) / MODERN_PHOTOSYNTHESIS) *
        (co2 / (co2 + WEATHERING_CO2_HALF_SATURATION));
      // One pass over the planet; other CO₂ levels scale it analytically (uniform warming).
      const current = rawWeathering(state, before);
      const seafloor = seafloorWeathering(state);
      // Warming predicted from the greenhouse forcing itself, so thick CO₂ (quadratic
      // term, pressure broadening) is not underestimated: a fixed sensitivity let the
      // lagged climate overshoot in bar-sized CO₂ swings until it ran away.
      const forcingBefore = greenhouseForcing(atmosphere);
      const warmingAt = (co2: number) =>
        (CLIMATE_SENSITIVITY / MODERN_CO2_FORCING_PER_EFOLD) *
        (greenhouseForcing({ ...atmosphere, co2 }) - forcingBefore);
      const weathering = (co2: number) => {
        const warming = warmingAt(co2);
        return (
          ((1 - SEAFLOOR_SHARE) *
            (current *
              Math.exp(WEATHERING_TEMPERATURE_SENSITIVITY * warming) *
              (co2Factor(co2) / co2Factor(before)))) /
            REFERENCE_WEATHERING +
          (seafloor.modern * Math.exp(SEAFLOOR_TEMPERATURE_SENSITIVITY * warming) +
            seafloor.lowLand * Math.exp(LOW_LAND_SEAFLOOR_TEMPERATURE_SENSITIVITY * warming)) *
            Math.pow(co2 / 280, SEAFLOOR_CO2_EXPONENT) *
            (co2 / (co2 + WEATHERING_CO2_HALF_SATURATION))
        );
      };

      // Most net degassing the crust can supply in this step (bar): exact first-order
      // release of the remaining reservoir, so it does not depend on the step length.
      const reservoir = Math.max(0, state.globals.crustalCarbon);
      const maxRise = Math.min(
        reservoir * -Math.expm1((-Math.max(0, outgassing) * dtYears) / DRY_DEGASSING_TIME),
        Math.max(0, (Math.min(MAX_CO2, ceiling) - before) * 1e-6),
      );
      // No silicate-weathering sink: no liquid water, or all of it frozen with no
      // ice-free rained-on land and no seafloor weathering (a stagnant lid).
      const sinkless = current <= 0 && seafloor.modern + seafloor.lowLand <= 0;
      const steamAtmosphere = state.globals.runawayGreenhouse && state.globals.water > 0.01;
      if (dtYears > 0 && steamAtmosphere) {
        // A transient steam atmosphere has no rain-driven sink, but it is not a
        // dry stagnant planet that can rapidly drain the whole crustal reservoir.
        // Continue the calibrated volcanic flux additively until rain-out or
        // complete ocean loss; this also makes a short runaway reversible.
        const rise = (REFERENCE_CO2 * Math.max(0, outgassing) * dtYears) / RESERVOIR_TIME;
        atmosphere.co2 = before + Math.min(rise, maxRise / 1e-6);
      } else if (dtYears > 0 && sinkless) {
        // A finite flux from the crust, not the multiplicative implicit solve, which
        // without a sink grows CO₂ geometrically up to the guardrail.
        atmosphere.co2 = before + maxRise / 1e-6;
      } else if (dtYears > 0) {
        const k = dtYears / RESERVOIR_TIME;
        // (C − C₀)/C₀ − k·(V − W(C) − B(C)) increases with C, since weathering and burial rise with C.
        const residual = (logC: number) => {
          const c = Math.exp(logC);
          return (c - before) / before - k * (outgassing - weathering(c) - burialAt(c));
        };
        let low = Math.log(MIN_CO2);
        // A wet silicate-weathering planet cannot naturally accumulate a Venus
        // atmosphere during one implicit solve; once rain is gone, the full
        // representable 100-bar range is available to volcanic outgassing.
        const high = Math.log(Math.max(MIN_CO2, Math.min(MAX_WET_CO2, ceiling)));
        let upper = high;
        if (residual(low) >= 0) upper = low;
        else if (residual(upper) <= 0) low = upper;
        for (let iteration = 0; iteration < 60 && upper - low > 1e-6; iteration++) {
          const mid = (low + upper) / 2;
          if (residual(mid) > 0) upper = mid;
          else low = mid;
        }
        // The relative (Earth-calibrated) solve cannot raise CO₂ faster than the crust
        // supplies it; this only binds on weak-sink planets (cold Mars-like worlds).
        atmosphere.co2 = Math.min(Math.exp((low + upper) / 2), before + maxRise / 1e-6);
      }
      if (dtYears > 0) {
        // Net degassing comes out of the crustal reservoir; weathering returns it.
        state.globals.crustalCarbon = Math.max(
          0,
          state.globals.crustalCarbon - (atmosphere.co2 - before) * 1e-6,
        );
      }
      state.globals.carbon = {
        outgassing,
        weathering: weathering(atmosphere.co2),
        burial: burialAt(atmosphere.co2),
      };
      writeNaturalCarbonBudget(
        state,
        dtYears,
        before,
        atmosphere.co2,
        activity,
        state.globals.lipOutgassing,
        outgassing,
        current,
        warmingAt(atmosphere.co2),
        state.globals.carbon.weathering,
        state.globals.carbon.burial,
        sinkless || steamAtmosphere,
      );
      accumulateFossilCarbon(state, dtYears, state.globals.carbon.burial);
      updateSurfacePressure(state.globals);
    },
  };
}

/**
 * Decomposes the implicit solve without feeding diagnostics back into it. In the
 * normal wet branch the component rates come from the exact equation evaluated at
 * the solved CO2. The tiny bisection/cap residual is assigned to the largest term,
 * making the displayed terms add exactly to the realized natural change.
 */
function writeNaturalCarbonBudget(
  state: PlanetState,
  dtYears: number,
  before: number,
  after: number,
  activity: number,
  lipActivity: number,
  outgassing: number,
  rawLand: number,
  warming: number,
  totalWeathering: number,
  burial: number,
  sourceOnly: boolean,
): void {
  const budget = state.globals.carbonBudget;
  if (!(dtYears > 0)) {
    budget.net = carbonFluxDiagnostic(0, state);
    return;
  }
  const realized = (after - before) / dtYears;
  let volcanic: number;
  let lip: number;
  let land: number;
  let seafloorSink: number;
  let organic: number;
  if (sourceOnly) {
    const ordinaryShare = activity + lipActivity > 0 ? activity / (activity + lipActivity) : 1;
    volcanic = realized * ordinaryShare;
    lip = realized - volcanic;
    land = 0;
    seafloorSink = 0;
    organic = 0;
  } else {
    const scale = before / RESERVOIR_TIME;
    const landWeathering =
      ((1 - SEAFLOOR_SHARE) *
        rawLand *
        Math.exp(WEATHERING_TEMPERATURE_SENSITIVITY * warming) *
        (co2Factor(after) / co2Factor(before))) /
      REFERENCE_WEATHERING;
    const seaWeathering = Math.max(0, totalWeathering - landWeathering);
    const controlledActivity = Math.max(0, outgassing);
    const lipShare = activity + lipActivity > 0 ? lipActivity / (activity + lipActivity) : 0;
    lip = scale * controlledActivity * lipShare;
    volcanic = scale * controlledActivity - lip;
    land = -scale * landWeathering;
    seafloorSink = -scale * seaWeathering;
    organic = -scale * burial;
    const rates = [volcanic, lip, land, seafloorSink, organic];
    const sources = rates.reduce((sum, value) => sum + Math.max(0, value), 0);
    const sinks = rates.reduce((sum, value) => sum + Math.max(0, -value), 0);
    if (realized >= 0 && sources > 0) {
      const sourceScale = (sinks + realized) / sources;
      for (let i = 0; i < rates.length; i++) if (rates[i]! > 0) rates[i] = rates[i]! * sourceScale;
    } else if (realized < 0 && sinks > 0) {
      const sinkScale = (sources - realized) / sinks;
      for (let i = 0; i < rates.length; i++) if (rates[i]! < 0) rates[i] = rates[i]! * sinkScale;
    }
    // Absorb only floating-point summation noise after the sign-preserving rescale.
    const residual = realized - rates.reduce((sum, value) => sum + value, 0);
    let largest = 0;
    for (let i = 1; i < rates.length; i++) {
      if (Math.abs(rates[i]!) > Math.abs(rates[largest]!)) largest = i;
    }
    rates[largest] = rates[largest]! + residual;
    volcanic = rates[0]!;
    lip = rates[1]!;
    land = rates[2]!;
    seafloorSink = rates[3]!;
    organic = rates[4]!;
  }
  budget.volcanicOutgassing = carbonFluxDiagnostic(volcanic, state);
  budget.lipOutgassing = carbonFluxDiagnostic(lip, state);
  budget.landWeathering = carbonFluxDiagnostic(land, state);
  budget.seafloorWeathering = carbonFluxDiagnostic(seafloorSink, state);
  budget.organicBurial = carbonFluxDiagnostic(organic, state);
  const rates = [
    budget.volcanicOutgassing,
    budget.lipOutgassing,
    budget.landWeathering,
    budget.seafloorWeathering,
    budget.organicBurial,
    budget.civilizationEmissions,
    budget.clathrateRelease,
    budget.deviceSources,
    budget.deviceSinks,
  ];
  budget.net = carbonFluxDiagnostic(
    rates.reduce((sum, flux) => sum + flux.microbarPerYear, 0),
    state,
  );
}

/** Atmospheric carbon represented by one microbar of CO₂ on this planet, Gt C. */
export function gtCarbonPerMicrobar(state: PlanetState): number {
  const { radius, surfaceGravity } = state.planetParams;
  const earthScale =
    (radius / EARTH_RADIUS) ** 2 * (EARTH_SURFACE_GRAVITY / Math.max(0.01, surfaceGravity));
  // One microbar is 0.1 Pa; column mass is pressure/g and carbon is 12/44 of CO2.
  return (
    (0.1 * 4 * Math.PI * EARTH_RADIUS ** 2 * (12 / 44) * earthScale) / EARTH_SURFACE_GRAVITY / 1e12
  );
}

export function gtCarbonToMicrobar(carbon: number, state: PlanetState): number {
  return carbon / gtCarbonPerMicrobar(state);
}

/** Exact integration of formation at the step's burial rate and first-order geological loss. */
export function accumulateFossilCarbon(
  state: PlanetState,
  dtYears: number,
  burial = state.globals.carbon.burial,
): void {
  if (!(dtYears > 0)) return;
  const decay = Math.exp(-dtYears / FOSSIL_CARBON_LOSS_TIME);
  const sourceRate =
    MODERN_BURIAL_GT_C_PER_YEAR * RECOVERABLE_BURIAL_SHARE * Math.max(0, burial / MODERN_BURIAL);
  state.globals.fossilCarbon =
    Math.max(0, state.globals.fossilCarbon) * decay +
    sourceRate * FOSSIL_CARBON_LOSS_TIME * (1 - decay);
}

/**
 * Area-integrated spatial volcanism. A zero field is treated as an old/uninitialized
 * save and falls back to the former plate-speed formula, preserving its calibration.
 */
export function spatialVolcanicActivity(state: PlanetState): number {
  const mean = areaWeightedMean(state.grid, state.fields.volcanicActivity);
  return mean > 0
    ? mean
    : HOTSPOT_SHARE * mantleHeat(state.globals.year, state.planetParams.radius) +
        (1 - HOTSPOT_SHARE) * tectonicActivity(state);
}

/**
 * Internal heat of the planet relative to an Earth-like planet at 4.5 Gyr: young
 * planets have hotter mantles and far more volcanism.
 */
export function mantleHeat(ageYears: number, radius = EARTH_RADIUS): number {
  const radiusRatio = Math.max(0.1, radius / EARTH_RADIUS);
  // Heat production per surface area scales with size, while the cooling time
  // scales roughly with radius. Earth remains the exact normalization point.
  const excess = (age: number, coolingTime: number) => 1 + 1.5 * Math.exp(-age / coolingTime);
  return (
    (radiusRatio * excess(ageYears, MANTLE_COOLING_TIME * radiusRatio)) /
    excess(4.5e9, MANTLE_COOLING_TIME)
  );
}

/**
 * Vigour of plate tectonics relative to Earth: the area-weighted mean of the
 * plates' target speeds (what mantle convection drives), not their current
 * speeds, so temporary stalls in collisions do not swing the climate.
 */
export function tectonicActivity(state: PlanetState): number {
  if (state.globals.tectonicRegime === 'stagnant') return 0;
  const { plates, grid } = state;
  if (plates.length === 0) return 1;
  const cells = new Float64Array(plates.length);
  for (const id of state.fields.plateId) cells[id] = cells[id]! + 1;
  let speed = 0;
  for (const plate of plates) {
    // Average surface speed of a rotating cap is about π/4 of its maximum.
    speed += cells[plate.id]! * plate.targetSpeed * grid.radius * (Math.PI / 4);
  }
  return speed / grid.cellCount / REFERENCE_PLATE_SPEED;
}

/**
 * Seafloor weathering at 280 ppm and the current mean temperature, as shares of the
 * present-day carbon flux: scales with ocean area, spreading (plate vigour) and mantle heat.
 */
function seafloorWeathering(state: PlanetState): { modern: number; lowLand: number } {
  if (state.globals.runawayGreenhouse || liquidWaterGel(state) <= 1e-6)
    return { modern: 0, lowLand: 0 };
  const { grid, fields, globals } = state;
  let ocean = 0;
  for (let i = 0; i < grid.cellCount; i++) {
    if (isOcean(fields.elevation[i]!, globals.seaLevel)) {
      ocean += grid.rowAreaWeight[Math.floor(i / grid.width)]!;
    }
  }
  // Warm low-land planets need a stronger marine backstop. Krissansen-Totton et al.
  // (2018, PNAS 115:4105, doi:10.1073/pnas.1721296115) found temperature-dependent
  // seafloor weathering kept even their no-land Archean endmember temperate. This
  // boost fades out before modern land shares, preserving the Earth calibration.
  const land = Math.max(0, 1 - ocean);
  const lowLand = Math.max(
    0,
    Math.min(1, (SEAFLOOR_LAND_THRESHOLD - land) / SEAFLOOR_LAND_THRESHOLD),
  );
  const share =
    SEAFLOOR_SHARE *
    (ocean / REFERENCE_OCEAN_FRACTION) *
    tectonicActivity(state) *
    mantleHeat(globals.year, state.planetParams.radius);
  const warmth = globals.meanTemperature - 15;
  return {
    modern: share * Math.exp(SEAFLOOR_TEMPERATURE_SENSITIVITY * warmth),
    lowLand:
      share *
      MAX_LOW_LAND_SEAFLOOR_BOOST *
      lowLand *
      Math.exp(LOW_LAND_SEAFLOOR_TEMPERATURE_SENSITIVITY * warmth),
  };
}

/**
 * Unnormalized silicate weathering: land area fraction × runoff × temperature
 * and CO₂ factors, with no weathering under ice. `warming` (°C) is added to
 * every cell's temperature, to predict weathering at a different CO₂ level.
 */
export function rawWeathering(state: PlanetState, co2: number, warming = 0): number {
  // Silicate weathering needs liquid water and rain; it ceases after ocean loss.
  if (state.globals.runawayGreenhouse || liquidWaterGel(state) <= 1e-6) return 0;
  const { grid, fields } = state;
  const { elevation, airTemperature, precipitation, iceCover, biome, vegetation } = fields;
  let total = 0;
  for (let y = 0; y < grid.height; y++) {
    const weight = grid.rowAreaWeight[y]!;
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      if (isOcean(elevation[i]!, state.globals.seaLevel)) continue;
      const temperature = airTemperature[i]! + warming;
      const ice = Math.max(iceCover[i]!, temperature < -10 ? 1 : 0);
      const runoff = precipitation[i]! / 1000;
      // Plants speed weathering up several times; land without a biome counts as average.
      const plants = vegetation[i]!;
      const life =
        biome[i] === Biome.Ocean
          ? 1
          : BARREN_WEATHERING * (1 - plants) + BIOMES[biome[i] as Biome].weathering * plants;
      total +=
        weight *
        life *
        (1 - ice) *
        runoff *
        Math.exp(WEATHERING_TEMPERATURE_SENSITIVITY * (temperature - 15));
    }
  }
  return total * co2Factor(co2);
}

/** CO₂ dependence of weathering: acid soil water, fading out when CO₂ runs out. */
function co2Factor(co2: number): number {
  return (
    (Math.pow(co2 / 280, WEATHERING_CO2_EXPONENT) *
      ((co2 / (co2 + WEATHERING_CO2_HALF_SATURATION)) * (280 + WEATHERING_CO2_HALF_SATURATION))) /
    280
  );
}
