import { createFields, type Fields } from './fields';
import type { PlanetEvent } from '../events';
import { createHistory, type History } from '../history';
import { LIFE_CLASS_COUNT } from '../data/lifeClasses';
import { createGrid, type Grid } from './grid';
import type { Era } from '../eras';
import { EARTH_RADIUS } from './grid';

export const EARTH_SURFACE_GRAVITY = 9.80665;
export const EARTH_ROTATION_PERIOD_HOURS = 24;

export type StarType = 'F' | 'G' | 'K' | 'M';
export type TectonicRegime = 'mobile' | 'stagnant';

/** Fixed physical parameters and initial volatile/carbon inventories. */
export interface PlanetParameters {
  /** Mean solid-body radius, m. */
  radius: number;
  /** Surface gravity, m/s². May be overridden independently of radius. */
  surfaceGravity: number;
  /** Semi-major axis, astronomical units. */
  orbitalDistanceAu: number;
  starType: StarType;
  /** Sidereal rotation period, hours; negative values are retrograde. */
  rotationPeriodHours: number;
  hasMoon: boolean;
  /** Synchronously rotating, with a fixed equatorial substellar point. */
  tidallyLocked: boolean;
  /** Initial water inventory, m global-equivalent layer. */
  initialWaterGel: number;
  /** Initial nitrogen partial pressure, bar. */
  initialN2Bar: number;
  /** Initial carbon-dioxide partial pressure, microbar. */
  initialCo2Microbar: number;
  /** Total accessible crustal carbon, bar of CO₂ equivalent. */
  crustalCarbonBar: number;
  /** Initial tectonic style. It may later switch irreversibly to stagnant. */
  tectonicRegime: TectonicRegime;
  /** Dynamo efficiency relative to Earth; zero represents a permanently dead core. */
  dynamoStrength: number;
}

export const EARTH_PLANET_PARAMETERS: Readonly<PlanetParameters> = {
  radius: EARTH_RADIUS,
  surfaceGravity: EARTH_SURFACE_GRAVITY,
  orbitalDistanceAu: 1,
  starType: 'G',
  rotationPeriodHours: EARTH_ROTATION_PERIOD_HOURS,
  hasMoon: true,
  tidallyLocked: false,
  initialWaterGel: 2700,
  initialN2Bar: 0.78084,
  initialCo2Microbar: 280,
  crustalCarbonBar: 80,
  tectonicRegime: 'mobile',
  dynamoStrength: 1,
};

/** Earth-density gravity used when a custom radius does not override gravity. */
export function earthDensityGravity(radius: number): number {
  return EARTH_SURFACE_GRAVITY * (radius / EARTH_RADIUS);
}

/**
 * Default accessible crustal carbon, bar of CO₂ equivalent. Carbon mass scales with
 * planet mass (same composition); spread over the surface it is a column ∝ g that
 * weighs ∝ g again, so its pressure ∝ g² (Earth 80 bar, a Mars-size planet ~11 bar).
 */
export function defaultCrustalCarbonBar(surfaceGravity: number): number {
  return EARTH_PLANET_PARAMETERS.crustalCarbonBar * (surfaceGravity / EARTH_SURFACE_GRAVITY) ** 2;
}

/** Well-mixed atmospheric gases. */
export interface Atmosphere {
  /** Nitrogen partial pressure, bar (Earth: about 0.78 bar). */
  n2: number;
  /** Argon-like inert-gas partial pressure, bar (Earth: about 0.0093 bar). */
  inert: number;
  /** Carbon-dioxide partial pressure in microbar (280 microbar before industry). */
  co2: number;
  /** Methane partial pressure in microbar (0.7 microbar before industry). */
  ch4: number;
  /** Oxygen fraction by volume (0.21 on modern Earth); its partial pressure is derived. */
  o2: number;
  /** Atmospheric water-vapour column, expressed as an equivalent partial pressure, bar. */
  waterVapor: number;
}

/** Planet-wide (non-gridded) state. */
export interface GlobalState {
  /** Simulated years since the planet formed (the star is assumed to be the same age). */
  year: number;
  /** Star luminosity relative to the present Sun (1 = 1361 W/m² at the planet). */
  solarInput: number;
  atmosphere: Atmosphere;
  /** Total surface pressure, bar, derived from the well-mixed gas inventory. */
  surfacePressure: number;
  /** Area-weighted mean surface air temperature, °C (written by the climate model). */
  meanTemperature: number;
  /** Fraction of the surface covered by ice, 0..1 (written by the climate model). */
  iceFraction: number;
  /** Ocean surface elevation relative to the ice-free datum, m. */
  seaLevel: number;
  /** Total extant planetary water inventory, metres of global equivalent layer (GEL). */
  water: number;
  /** Water inventory when the represented planet was initialized, m GEL. */
  initialWater: number;
  /** Cumulative water lost to space as escaping hydrogen, m GEL. */
  escapedWater: number;
  /** Whether the planet has crossed the moist/runaway-greenhouse threshold. */
  runawayGreenhouse: boolean;
  /** Present dipole shielding strength, 0 (none) to 1 (modern Earth). */
  magneticField: number;
  /** Current tectonic style; ocean loss can irreversibly stop mobile-lid tectonics. */
  tectonicRegime: TectonicRegime;
  /** Carbon still available for net degassing, bar of CO₂ equivalent. */
  crustalCarbon: number;
  /** Condensed surface CO2, bar equivalent when spread over the whole planet. */
  co2Ice: number;
  /** Atmospheric dust optical depth (impacts, eruptions, nuclear war); 0 = clear sky. */
  dust: number;
  /** Surface-ocean acidification, pH units below the pre-perturbation value (0 = none). */
  oceanAcidity: number;
  /** Methane stored in clathrates and permafrost, microbar of CH₄ equivalent. */
  clathrateCarbon: number;
  /** Biodiversity index, 0..1 (life model). */
  biodiversity: number;
  /** Year of the last recorded mass extinction, or -1 if none. */
  lastMassExtinctionYear: number;
  /** Cumulative non-water atmospheric escape, in partial-pressure equivalents. */
  escapedAtmosphere: { n2: number; co2: number; inert: number; waterVapor: number };
  /** Cumulative sediment exported beyond represented marine accommodation, m³. */
  sedimentExport: number;
  /** Area-mean total cloud cover, 0..1 (written by the cloud model). */
  cloudCover?: number;
  /** Shape of the general circulation (written by the circulation model). */
  circulation?: { hadleyWidth: number; meanItcz: number };
  /** Carbon fluxes relative to present-day Earth (written by the carbon cycle). */
  carbon: { outgassing: number; weathering: number; burial: number };
  /** Cooling radiative forcing from volcanic aerosols, W/m² (positive means cooling). */
  volcanicAerosol: number;
  /** Outgassing of active large igneous provinces over the last step, relative to modern. */
  lipOutgassing: number;
  /** Expected natural impact flux at the current age, impacts per year. */
  impactFlux: number;
  /** Number of natural impacts represented by the last simulation step. */
  impactsThisStep: number;
  /** Cumulative cometary water delivery, metres of global equivalent layer. */
  waterDelivered: number;
  /** Time-averaged radiative forcing from impact heat over the current step, W/m². */
  impactHeating: number;
  /** Player energy budget (Ω). */
  energy: number;
  /** Experimental mode: tools cost nothing. */
  unlimitedEnergy: boolean;
  /** Era the planet was in after the last step (see eras.ts); absent before the first step. */
  era?: Era;
}

/** A rigid tectonic plate rotating about an Euler pole. */
export interface Plate {
  id: number;
  /** Unit vector of the rotation axis through the planet centre. */
  eulerPole: [number, number, number];
  /** Rotation rate in radians per year (surface speed = rate × radius × sin(angle to pole)). */
  angularSpeed: number;
  /**
   * Rotation rate the plate's driving forces aim for (rad/yr). Collisions slow the
   * plate below it; it recovers once free.
   */
  targetSpeed: number;
  /**
   * Total rotation of the plate since its crust was anchored, as a row-major 3×3
   * matrix mapping reference positions to current positions.
   */
  rotation: number[];
  /**
   * The plate's crust in its own reference frame, on a grid identical to the
   * planet's. Moving the plate only changes `rotation`; the planet fields are
   * re-composed from these rasters, so plate shapes never degrade from repeated
   * resampling.
   */
  crust: PlateCrust;
}

export interface PlateCrust {
  /** 1 where the plate has crust at this reference cell. */
  owned: Uint8Array;
  elevation: Float32Array;
  /** Same meaning as the crustType field. */
  type: Uint8Array;
}

/** A long-lived mantle plume fixed in the planet/mantle reference frame. */
export interface MantleHotspot {
  id: number;
  /** Unit vector through the plume centre. */
  position: [number, number, number];
  /** Relative plume strength. */
  strength: number;
  birthYear: number;
  deathYear: number;
}

/** A large igneous province that releases its carbon over a finite interval. */
export interface LargeIgneousProvince {
  id: number;
  position: [number, number, number];
  startYear: number;
  endYear: number;
  /** Extra CO₂ outgassing while active, relative to the modern volcanic flux. */
  outgassing: number;
}

/** Plain-data state owned by plate cleanup and volcanism. */
export interface GeosphereState {
  /** Plate count at generation; cleanup may use up to twice this many stable slots. */
  initialPlateCount: number;
  hotspots: MantleHotspot[];
  /** Player-created activity, decayed separately from the diagnosed natural field. */
  volcanicBoost: Float32Array;
  activeLips: LargeIgneousProvince[];
  nextLipId: number;
  lipCount: number;
  /** Accumulated plate time since the last connected-component cleanup. */
  cleanupElapsedYears: number;
  /** Mantle-heat multiplier already folded into plate angular speeds. */
  plateSpeedMantleFactor: number;
  /** Instantaneous impact heat carried between steps, W/m². */
  impactHeat: number;
  /** Total natural impacts sampled since this planet was created. */
  impactCount: number;
  /** Abiogenesis is prevented until this planet age after a sterilising impact. */
  abiogenesisSuppressedUntil: number;
  /** Next deterministic moonless-obliquity update and its sequence index. */
  nextObliquityUpdateYear: number;
  obliquityUpdateIndex: number;
  /** Scenario calibration may hold the present-day obliquity fixed. */
  fixedObliquity: boolean;
}

/** Life on the planet (see models/biosphere/life.ts). */
export interface Biota {
  /** populations[c * cellCount + i]: class c in cell i, as a fraction of carrying capacity. */
  populations: Float32Array;
  /** Year each class first appeared, or null if it never has. Indexed like LIFE_CLASSES. */
  appeared: (number | null)[];
  /** Area-weighted mean population of each class over the planet (written each step). */
  cover: number[];
}

/** The planet's sentient species and its civilization (see models/civilization). */
export interface CivilizationState {
  /** Life class index of the sentient species, or null when there is none. */
  species: number | null;
  /** Index into TECH_AGES. */
  age: number;
  /** Progress through the current age, 0..1. */
  progress: number;
  /** World population in billions. */
  population: number;
  /** Year the current species became sentient. */
  sentientSince: number | null;
  /** Year a civilization left the planet, if one has. */
  exodusYear: number | null;
}

/**
 * Player-adjustable model parameters, as multipliers on each process (1 = normal),
 * like the model control panels of SimEarth.
 */
export interface ModelControls {
  /** Plate speeds. */
  driftSpeed: number;
  /** Volcanic CO₂ outgassing. */
  volcanism: number;
  /** River, glacial and hillslope erosion. */
  erosion: number;
  /** Rate at which new life classes evolve. */
  mutationRate: number;
  /** The star's brightness. */
  solarFactor: number;
  /** Axial tilt relative to the orbital plane's normal, degrees. */
  obliquity: number;
  /** Greenhouse forcing (CO₂, CH₄, water vapour bands). */
  greenhouse: number;
  /** Brightening by low cloud relative to the reference cover. */
  cloudAlbedo: number;
  /** Ice-free surface albedo (the result is clamped to 0.03..0.9). */
  surfaceAlbedo: number;
  /** Air–sea heat transfer: how fast temperatures follow the ocean-lagged equilibrium (inverse of the 40-year response time). */
  airSeaHeat: number;
  /** Hydrological intensity: evaporation, and with it rainfall, in the moisture budget. */
  rainfall: number;
  /** Overall tempo of life's progress: abiogenesis and evolutionary transitions (mutationRate acts on evolution only). */
  advanceRate: number;
  /** Population growth and decline rate towards carrying capacity. */
  reproduction: number;
  /** Width of the temperature range every life class tolerates. */
  thermalTolerance: number;
}

export const DEFAULT_CONTROLS: Readonly<ModelControls> = {
  driftSpeed: 1,
  volcanism: 1,
  erosion: 1,
  mutationRate: 1,
  solarFactor: 1,
  obliquity: 23.44,
  greenhouse: 1,
  cloudAlbedo: 1,
  surfaceAlbedo: 1,
  airSeaHeat: 1,
  rainfall: 1,
  advanceRate: 1,
  reproduction: 1,
  thermalTolerance: 1,
};

/** Complete simulation state. Must stay plain data so it can be serialized and sent to a worker. */
export interface PlanetState {
  grid: Grid;
  planetParams: PlanetParameters;
  fields: Fields;
  globals: GlobalState;
  plates: Plate[];
  geosphere: GeosphereState;
  /** Global quantities over time, one sample per step (thinned on long runs). */
  history: History;
  biota: Biota;
  civilization: CivilizationState;
  /** Notable moments, most recent last (see events.ts). */
  events: PlanetEvent[];
  controls: ModelControls;
  /** Year each simulation component last ran, by component name (see simulation.ts). */
  lastRunYear: Record<string, number>;
  seed: number;
  rngState: number;
}

export interface PlanetOptions {
  width?: number;
  height?: number;
  seed?: number;
  /** Physical parameters; omitted values inherit the Earth calibration. */
  planetParams?: Partial<PlanetParameters>;
}

export const DEFAULT_GRID_WIDTH = 128;
export const DEFAULT_GRID_HEIGHT = 64;

export function createPlanet(options: PlanetOptions = {}): PlanetState {
  const radius = options.planetParams?.radius ?? EARTH_PLANET_PARAMETERS.radius;
  const planetParams: PlanetParameters = {
    ...EARTH_PLANET_PARAMETERS,
    ...options.planetParams,
    radius,
    surfaceGravity:
      options.planetParams?.surfaceGravity ??
      (options.planetParams?.radius === undefined
        ? EARTH_PLANET_PARAMETERS.surfaceGravity
        : earthDensityGravity(radius)),
  };
  if (options.planetParams?.crustalCarbonBar === undefined) {
    planetParams.crustalCarbonBar = defaultCrustalCarbonBar(planetParams.surfaceGravity);
  }
  const grid = createGrid(
    options.width ?? DEFAULT_GRID_WIDTH,
    options.height ?? DEFAULT_GRID_HEIGHT,
    radius,
  );
  const seed = (options.seed ?? 1) >>> 0;
  return {
    grid,
    planetParams,
    fields: createFields(grid.cellCount),
    globals: {
      year: 0,
      solarInput: 1,
      atmosphere: {
        n2: planetParams.initialN2Bar,
        inert: 0.00934,
        co2: planetParams.initialCo2Microbar,
        ch4: 0.7,
        o2: 0.21,
        waterVapor: 0.0025,
      },
      surfacePressure: 1.00375,
      meanTemperature: 0,
      iceFraction: 0,
      seaLevel: 0,
      // Terrain generation replaces this with the basin volume below the 0 m datum.
      water: 2700,
      initialWater: 2700,
      escapedWater: 0,
      runawayGreenhouse: false,
      magneticField: planetParams.dynamoStrength > 0 ? 1 : 0,
      tectonicRegime: planetParams.tectonicRegime,
      crustalCarbon: Math.max(
        0,
        planetParams.crustalCarbonBar - planetParams.initialCo2Microbar * 1e-6,
      ),
      co2Ice: 0,
      dust: 0,
      oceanAcidity: 0,
      clathrateCarbon: 0,
      biodiversity: 0,
      lastMassExtinctionYear: -1,
      escapedAtmosphere: { n2: 0, co2: 0, inert: 0, waterVapor: 0 },
      sedimentExport: 0,
      carbon: { outgassing: 1, weathering: 1, burial: 0 },
      volcanicAerosol: 0,
      lipOutgassing: 0,
      impactFlux: 0,
      impactsThisStep: 0,
      waterDelivered: 0,
      impactHeating: 0,
      energy: 0,
      unlimitedEnergy: false,
    },
    plates: [],
    geosphere: {
      initialPlateCount: 0,
      hotspots: [],
      volcanicBoost: new Float32Array(grid.cellCount),
      activeLips: [],
      nextLipId: 1,
      lipCount: 0,
      cleanupElapsedYears: 0,
      plateSpeedMantleFactor: 1,
      impactHeat: 0,
      impactCount: 0,
      abiogenesisSuppressedUntil: 0,
      nextObliquityUpdateYear: 0,
      obliquityUpdateIndex: 0,
      fixedObliquity: false,
    },
    history: createHistory(),
    biota: {
      populations: new Float32Array(grid.cellCount * LIFE_CLASS_COUNT),
      appeared: Array.from({ length: LIFE_CLASS_COUNT }, () => null),
      cover: Array.from({ length: LIFE_CLASS_COUNT }, () => 0),
    },
    civilization: {
      species: null,
      age: 0,
      progress: 0,
      population: 0,
      sentientSince: null,
      exodusYear: null,
    },
    events: [],
    controls: { ...DEFAULT_CONTROLS },
    lastRunYear: {},
    seed,
    rngState: seed,
  };
}
