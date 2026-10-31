import type { SimComponent } from '../core/component';
import type {
  CivilizationPolicy,
  EnergySourceKey,
  InvestmentKey,
  ModelControls,
  PlanetState,
} from '../core/planet';
import { normalizeCivilizationPolicy } from '../data/civilization';
import { TECH_AGES } from '../data/civilization';
import { LIFE_CLASSES } from '../data/lifeClasses';
import { recordEvent } from '../events';
import { complexBiomass } from '../models/biosphere/life';
import { difficultyBalance } from '../balance';

export type GoalId = 'brighteningSun' | 'snowball' | 'cradle' | 'terraformMars' | 'exodus';
export type GoalStatus = 'active' | 'won' | 'lost';
export type ControlKey = keyof ModelControls;

/** Goal-owned data is deliberately restricted to JSON-safe scalar values. */
export type GoalMemory = Record<string, number | string | boolean | null>;

export interface GoalState {
  id: GoalId;
  status: GoalStatus;
  startYear: number;
  score: number;
  /** Year a sustained win condition first became true. */
  heldSince: number | null;
  outcomeYear: number | null;
  /** Stable string key describing the win or loss. */
  outcomeReason: string | null;
  memory: GoalMemory;
}

export interface GoalCondition {
  /** Translation key for the checklist label. */
  key: string;
  value: number;
  target: number;
  unit: string;
  met: boolean;
}

export interface GoalDefinition {
  id: GoalId;
  evaluate(state: PlanetState, goal: GoalState, dtYears: number): void;
  conditions(state: PlanetState, goal: GoalState): GoalCondition[];
  controlLimits?: Partial<Record<ControlKey, [number, number]>>;
  civPolicyLimits?: {
    energy?: Partial<Record<EnergySourceKey, [number, number]>>;
    investment?: Partial<Record<InvestmentKey, [number, number]>>;
  };
}

/** Normal target: untouched worlds should fail; active solar/climate management can survive. */
const BRIGHTENING_TARGET_YEAR = 8.5e9;
const SNOWBALL_TIME_LIMIT = 1e9;
const SNOWBALL_HOLD_YEARS = 5e6;
const CRADLE_TIME_LIMIT = 2e9;
const COMPLEX_LIFE_EPSILON = 1e-8;
const TERRAFORM_TIME_LIMIT: Partial<Record<GoalId, number>> = {
  terraformMars: 500e6,
  // A staged science/agriculture strategy reaches Exodus by 68 kyr; default policy misses 70 kyr.
  exodus: 70e3,
};
const TERRAFORM_HOLD_YEARS = 10e6;
/** Share of the planet's area that must be open (ice-free) sea. */
const OPEN_WATER_TARGET = 0.02;

export function createGoal(id: GoalId, startYear: number): GoalState {
  const deadlineYear =
    id === 'brighteningSun'
      ? BRIGHTENING_TARGET_YEAR
      : startYear +
        (TERRAFORM_TIME_LIMIT[id] ?? (id === 'snowball' ? SNOWBALL_TIME_LIMIT : CRADLE_TIME_LIMIT));
  return {
    id,
    status: 'active',
    startYear,
    score: 0,
    heldSince: null,
    outcomeYear: null,
    outcomeReason: null,
    memory: {
      deadlineYear,
      biodiversityIntegral: 0,
      complexLifeSeen: id === 'brighteningSun',
    },
  };
}

function evaluationYear(state: PlanetState, dtYears: number): number {
  return state.globals.year + Math.max(0, dtYears);
}

function deadline(goal: GoalState): number {
  const value = goal.memory.deadlineYear;
  return typeof value === 'number' ? value : Number.POSITIVE_INFINITY;
}

/** Difficulty stretches ordinary deadlines; survival goals invert it (easy ends earlier). */
function goalDeadline(state: PlanetState, goal: GoalState): number {
  const base = deadline(goal);
  const duration = base - goal.startYear;
  const tolerance = difficultyBalance(state).goalTolerance;
  return goal.id === 'brighteningSun'
    ? goal.startYear + duration / tolerance
    : goal.startYear + duration * tolerance;
}

function finish(
  goal: GoalState,
  status: Exclude<GoalStatus, 'active'>,
  year: number,
  reason: string,
) {
  goal.status = status;
  goal.outcomeYear = year;
  goal.outcomeReason = reason;
}

function hasEvent(
  state: PlanetState,
  key: PlanetState['events'][number]['key'],
  since: number,
): boolean {
  return state.events.some((event) => event.key === key && event.year >= since);
}

function hasLiquidOceans(state: PlanetState): boolean {
  return (
    state.globals.water > 1 &&
    state.globals.iceFraction < 0.95 &&
    !state.globals.runawayGreenhouse &&
    !hasEvent(state, 'oceansLost', 0)
  );
}

function complexLife(state: PlanetState): number {
  return complexBiomass(state.biota.cover);
}

function complexClassCount(state: PlanetState): number {
  return LIFE_CLASSES.reduce(
    (count, lifeClass, index) =>
      count + (lifeClass.tier !== 'microbes' && state.biota.cover[index]! > 0 ? 1 : 0),
    0,
  );
}

function updateComplexLifeMemory(state: PlanetState, goal: GoalState): boolean {
  const alive = complexLife(state) > COMPLEX_LIFE_EPSILON;
  if (alive) goal.memory.complexLifeSeen = true;
  return alive;
}

function sentienceReached(state: PlanetState, goal: GoalState): boolean {
  return state.civilization.sentientSince !== null || hasEvent(state, 'sentience', goal.startYear);
}

function landVertebrateClasses(state: PlanetState): number {
  return LIFE_CLASSES.reduce(
    (count, lifeClass, index) =>
      count + (lifeClass.tier === 'landVertebrates' && state.biota.cover[index]! > 0 ? 1 : 0),
    0,
  );
}

function percent(value: number): number {
  return value * 100;
}

const brighteningSun: GoalDefinition = {
  id: 'brighteningSun',
  controlLimits: {
    solarFactor: [0.92, 1.08],
    greenhouse: [0.8, 1.2],
    cloudAlbedo: [0.8, 1.3],
    surfaceAlbedo: [0.8, 1.3],
    airSeaHeat: [0.8, 1.2],
    rainfall: [0.8, 1.2],
  },
  evaluate(state, goal, dtYears) {
    const year = evaluationYear(state, dtYears);
    const elapsed = Math.max(0, year - goal.startYear);
    const previousIntegral = Number(goal.memory.biodiversityIntegral) || 0;
    goal.memory.biodiversityIntegral =
      previousIntegral + state.globals.biodiversity * Math.max(0, dtYears);
    const meanBiodiversity =
      elapsed > 0 ? Number(goal.memory.biodiversityIntegral) / elapsed : state.globals.biodiversity;
    const targetYear = goalDeadline(state, goal);
    const targetDuration = targetYear - goal.startYear;
    goal.score = Math.min(1000, (1000 * elapsed * (0.5 + 0.5 * meanBiodiversity)) / targetDuration);

    const lifeAlive = updateComplexLifeMemory(state, goal);
    if (hasEvent(state, 'oceansLost', goal.startYear) || state.globals.water <= 1) {
      finish(goal, 'lost', year, 'oceansLost');
    } else if (
      state.globals.runawayGreenhouse ||
      hasEvent(state, 'runawayGreenhouse', goal.startYear)
    ) {
      finish(goal, 'lost', year, 'runawayGreenhouse');
    } else if (goal.memory.complexLifeSeen === true && !lifeAlive) {
      finish(goal, 'lost', year, 'complexLifeExtinct');
    } else if (year >= targetYear && hasLiquidOceans(state) && lifeAlive) {
      finish(goal, 'won', year, 'survivedBrightening');
    }
  },
  conditions(state, goal) {
    const alive = complexLife(state) > COMPLEX_LIFE_EPSILON;
    return [
      {
        key: 'goal.condition.liquidOceans',
        value: state.globals.water,
        target: 1,
        unit: 'goal.unit.mGel',
        met: hasLiquidOceans(state),
      },
      {
        key: 'goal.condition.complexLife',
        value: complexClassCount(state),
        target: 1,
        unit: '',
        met: alive,
      },
      {
        key: 'goal.condition.surviveUntil',
        value: state.globals.year / 1e9,
        target: goalDeadline(state, goal) / 1e9,
        unit: 'goal.unit.gyr',
        met: goal.status === 'won' || state.globals.year >= goalDeadline(state, goal),
      },
    ];
  },
};

function thawed(state: PlanetState): boolean {
  return state.globals.iceFraction < 0.15 && state.globals.meanTemperature > 5;
}

const snowball: GoalDefinition = {
  id: 'snowball',
  controlLimits: {
    solarFactor: [0.9, 1.1],
    greenhouse: [0.8, 1.4],
    cloudAlbedo: [0.8, 1.3],
    surfaceAlbedo: [0.75, 1.3],
    volcanism: [0, 2],
  },
  evaluate(state, goal, dtYears) {
    const year = evaluationYear(state, dtYears);
    if (thawed(state)) {
      goal.heldSince ??= year;
    } else {
      goal.heldSince = null;
    }
    const remainingMyr = Math.max(0, goalDeadline(state, goal) - year) / 1e6;
    goal.score = remainingMyr + state.globals.energy / 10;
    if (goal.heldSince !== null && year - goal.heldSince >= SNOWBALL_HOLD_YEARS) {
      finish(goal, 'won', year, 'snowballThawed');
    } else if (year >= goalDeadline(state, goal)) {
      finish(goal, 'lost', year, 'timeExpired');
    }
  },
  conditions(state, goal) {
    const year = state.globals.year;
    const held = goal.heldSince === null ? 0 : Math.max(0, year - goal.heldSince);
    return [
      {
        key: 'goal.condition.iceCoverBelow',
        value: percent(state.globals.iceFraction),
        target: 15,
        unit: 'goal.unit.percent',
        met: state.globals.iceFraction < 0.15,
      },
      {
        key: 'goal.condition.temperatureAbove',
        value: state.globals.meanTemperature,
        target: 5,
        unit: 'goal.unit.celsius',
        met: state.globals.meanTemperature > 5,
      },
      {
        key: 'goal.condition.holdFor',
        value: held / 1e6,
        target: SNOWBALL_HOLD_YEARS / 1e6,
        unit: 'goal.unit.myr',
        met: held >= SNOWBALL_HOLD_YEARS,
      },
    ];
  },
};

const cradle: GoalDefinition = {
  id: 'cradle',
  controlLimits: {
    mutationRate: [0.5, 2],
    advanceRate: [0.5, 2],
    reproduction: [0.5, 2],
    thermalTolerance: [0.8, 1.3],
    solarFactor: [0.92, 1.08],
    greenhouse: [0.8, 1.2],
  },
  evaluate(state, goal, dtYears) {
    const year = evaluationYear(state, dtYears);
    const lifeAlive = updateComplexLifeMemory(state, goal);
    const remainingMyr = Math.max(0, goalDeadline(state, goal) - year) / 1e6;
    goal.score = remainingMyr + landVertebrateClasses(state) * 100;
    if (sentienceReached(state, goal)) {
      finish(goal, 'won', year, 'sentience');
    } else if (goal.memory.complexLifeSeen === true && !lifeAlive) {
      finish(goal, 'lost', year, 'complexLifeExtinct');
    } else if (year >= goalDeadline(state, goal)) {
      finish(goal, 'lost', year, 'timeExpired');
    }
  },
  conditions(state, goal) {
    const vertebrates = landVertebrateClasses(state);
    return [
      {
        key: 'goal.condition.complexLife',
        value: complexClassCount(state),
        target: 1,
        unit: '',
        met: complexLife(state) > COMPLEX_LIFE_EPSILON,
      },
      {
        key: 'goal.condition.landVertebrates',
        value: vertebrates,
        target: 1,
        unit: '',
        met: vertebrates > 0,
      },
      {
        key: 'goal.condition.sentience',
        value: sentienceReached(state, goal) ? 1 : 0,
        target: 1,
        unit: '',
        met: sentienceReached(state, goal),
      },
    ];
  },
};

/** Area share of the planet covered by sea that is not frozen over. */
export function openWaterFraction(state: PlanetState): number {
  const { grid, fields, globals } = state;
  let open = 0;
  let total = 0;
  for (let y = 0; y < grid.height; y++) {
    const weight = grid.rowAreaWeight[y]!;
    total += weight * grid.width;
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      if (fields.elevation[i]! < globals.seaLevel && fields.iceCover[i]! < 0.5) open += weight;
    }
  }
  return total > 0 ? open / total : 0;
}

function plantsGrowing(state: PlanetState): boolean {
  return state.biota.cover[LIFE_CLASSES.findIndex((c) => c.key === 'plants')]! > 0;
}

interface TerraformTargets {
  minPressure: number;
  maxPressure: number;
  minTemperature: number;
  maxTemperature: number;
}

/** Conditions shared by the terraforming goals: air, warmth, open sea and plants. */
function terraformConditions(
  state: PlanetState,
  goal: GoalState,
  targets: TerraformTargets,
): GoalCondition[] {
  const { surfacePressure, meanTemperature } = state.globals;
  const held = goal.heldSince === null ? 0 : Math.max(0, state.globals.year - goal.heldSince);
  const water = openWaterFraction(state);
  const pressure =
    targets.maxPressure < Number.POSITIVE_INFINITY
      ? {
          key: 'goal.condition.pressureBelow',
          value: surfacePressure,
          target: targets.maxPressure,
          unit: 'goal.unit.bar',
          met: surfacePressure <= targets.maxPressure,
        }
      : {
          key: 'goal.condition.pressureAbove',
          value: surfacePressure,
          target: targets.minPressure,
          unit: 'goal.unit.bar',
          met: surfacePressure >= targets.minPressure,
        };
  const temperature =
    meanTemperature > targets.maxTemperature
      ? {
          key: 'goal.condition.temperatureBelow',
          value: meanTemperature,
          target: targets.maxTemperature,
          unit: 'goal.unit.celsius',
          met: false,
        }
      : {
          key: 'goal.condition.temperatureAbove',
          value: meanTemperature,
          target: targets.minTemperature,
          unit: 'goal.unit.celsius',
          met: meanTemperature >= targets.minTemperature,
        };
  return [
    pressure,
    temperature,
    {
      key: 'goal.condition.openWater',
      value: percent(water),
      target: percent(OPEN_WATER_TARGET),
      unit: 'goal.unit.percent',
      met: water >= OPEN_WATER_TARGET,
    },
    {
      key: 'goal.condition.plants',
      value: plantsGrowing(state) ? 1 : 0,
      target: 1,
      unit: '',
      met: plantsGrowing(state),
    },
    {
      key: 'goal.condition.holdFor',
      value: held / 1e6,
      target: TERRAFORM_HOLD_YEARS / 1e6,
      unit: 'goal.unit.myr',
      met: held >= TERRAFORM_HOLD_YEARS,
    },
  ];
}

function terraformGoal(
  id: GoalId,
  targets: TerraformTargets,
  controlLimits: GoalDefinition['controlLimits'],
): GoalDefinition {
  return {
    id,
    controlLimits,
    evaluate(state, goal, dtYears) {
      const year = evaluationYear(state, dtYears);
      const habitable = terraformConditions(state, goal, targets)
        .slice(0, 4)
        .every((condition) => condition.met);
      if (habitable) goal.heldSince ??= year;
      else goal.heldSince = null;
      const remainingMyr = Math.max(0, goalDeadline(state, goal) - year) / 1e6;
      goal.score = remainingMyr + state.globals.energy / 10;
      if (goal.heldSince !== null && year - goal.heldSince >= TERRAFORM_HOLD_YEARS) {
        finish(goal, 'won', year, 'terraformed');
      } else if (year >= goalDeadline(state, goal)) {
        finish(goal, 'lost', year, 'timeExpired');
      }
    },
    conditions: (state, goal) => terraformConditions(state, goal, targets),
  };
}

const terraformMars = terraformGoal(
  'terraformMars',
  {
    minPressure: 0.5,
    maxPressure: Number.POSITIVE_INFINITY,
    minTemperature: 5,
    maxTemperature: 40,
  },
  {
    // Orbital mirrors and super-greenhouse gases are the classic Mars levers.
    solarFactor: [0.9, 1.3],
    greenhouse: [0.8, 1.5],
    surfaceAlbedo: [0.7, 1.2],
  },
);

/** Ages the civilization has completed or entered, counting from the Stone Age as 1. */
function agesReached(state: PlanetState): number {
  return state.civilization.species === null ? 0 : state.civilization.age + 1;
}

const exodus: GoalDefinition = {
  id: 'exodus',
  evaluate(state, goal, dtYears) {
    const year = evaluationYear(state, dtYears);
    goal.memory.bestAge = Math.max(Number(goal.memory.bestAge) || 0, agesReached(state));
    const remainingKyr = Math.max(0, goalDeadline(state, goal) - year) / 1e3;
    goal.score = remainingKyr + 100 * Number(goal.memory.bestAge);
    if (hasEvent(state, 'exodus', goal.startYear)) {
      finish(goal, 'won', year, 'exodus');
    } else if (
      hasEvent(state, 'civilizationCollapsed', goal.startYear) ||
      state.civilization.species === null
    ) {
      finish(goal, 'lost', year, 'civilizationCollapsed');
    } else if (year >= goalDeadline(state, goal)) {
      finish(goal, 'lost', year, 'timeExpired');
    }
  },
  conditions(state, goal) {
    const reached = Math.max(Number(goal.memory.bestAge) || 0, agesReached(state));
    const left = hasEvent(state, 'exodus', goal.startYear);
    return [
      {
        key: 'goal.condition.techAges',
        value: left ? TECH_AGES.length : reached,
        target: TECH_AGES.length,
        unit: '',
        met: left || reached >= TECH_AGES.length,
      },
      {
        key: 'goal.condition.exodus',
        value: left ? 1 : 0,
        target: 1,
        unit: '',
        met: left,
      },
    ];
  },
};

/** Stable registry: adding a future goal only needs data plus an evaluator. */
export const GOALS: Readonly<Record<GoalId, GoalDefinition>> = {
  brighteningSun,
  snowball,
  cradle,
  terraformMars,
  exodus,
};

/** Final pipeline component for goal scenarios. */
export const goalTracker: SimComponent = {
  name: 'goals',
  inputs: [],
  outputs: [],
  runOneStep(state, dtYears) {
    const goal = state.goal;
    if (!goal || goal.status !== 'active') return;
    const previous = goal.status as GoalStatus;
    GOALS[goal.id].evaluate(state, goal, dtYears);
    if (previous === 'active' && goal.status !== 'active') {
      recordEvent(
        state,
        goal.status === 'won' ? 'goalWon' : 'goalLost',
        goal.outcomeReason ?? undefined,
        goal.outcomeYear ?? evaluationYear(state, dtYears),
      );
    }
  },
};

/** Enforces scenario ranges at the authoritative simulation boundary. */
export function clampGoalControls(
  state: PlanetState,
  changes: Partial<ModelControls>,
): Partial<ModelControls> {
  const limits = state.goal ? GOALS[state.goal.id].controlLimits : undefined;
  if (!limits) return { ...changes };
  const clamped: Partial<ModelControls> = {};
  for (const key of Object.keys(changes) as ControlKey[]) {
    const value = changes[key];
    if (value === undefined || !Number.isFinite(value)) continue;
    const range = limits[key];
    clamped[key] = range ? Math.min(range[1], Math.max(range[0], value)) : value;
  }
  return clamped;
}

/** Applies any scenario policy ranges and restores the two 100% totals. */
export function clampGoalCivilizationPolicy(
  state: PlanetState,
  policy: CivilizationPolicy,
): CivilizationPolicy {
  const limits = state.goal ? GOALS[state.goal.id].civPolicyLimits : undefined;
  if (!limits) return normalizeCivilizationPolicy(policy);
  const next: CivilizationPolicy = {
    energy: { ...policy.energy },
    investment: { ...policy.investment },
  };
  if (limits.energy) {
    for (const key of Object.keys(limits.energy) as EnergySourceKey[]) {
      const range = limits.energy[key];
      if (!range) continue;
      next.energy[key] = Math.min(range[1], Math.max(range[0], next.energy[key]));
    }
  }
  if (limits.investment) {
    for (const key of Object.keys(limits.investment) as InvestmentKey[]) {
      const range = limits.investment[key];
      if (!range) continue;
      next.investment[key] = Math.min(range[1], Math.max(range[0], next.investment[key]));
    }
  }
  return normalizeCivilizationPolicy(next);
}
