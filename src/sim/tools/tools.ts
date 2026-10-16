import type { SimComponent } from '../core/component';
import { cellIndex } from '../core/grid';
import type { PlanetState } from '../core/planet';
import { SENTIENCE_POTENTIAL } from '../data/civilization';
import { LIFE_CLASSES, lifeClassIndex, type LifeClassKey } from '../data/lifeClasses';
import { recordEvent } from '../events';
import { classSuitability } from '../models/biosphere/life';
import { makeSentient } from '../models/civilization/civilization';
import { SEA_LEVEL } from '../models/geosphere/flowRouting';

/** Player interventions and their cost in Ω, after SimEarth's tool palette. */
export const TOOLS = {
  raise: { cost: 20 },
  lower: { cost: 20 },
  volcano: { cost: 100 },
  meteor: { cost: 150 },
  seedLife: { cost: 60 },
  monolith: { cost: 500 },
  addCo2: { cost: 50 },
  removeCo2: { cost: 80 },
} as const;
export type ToolId = keyof typeof TOOLS;
export const TOOL_IDS = Object.keys(TOOLS) as ToolId[];

export interface ToolUse {
  tool: ToolId;
  /** Target cell on the planet grid. */
  x: number;
  y: number;
  /** Class to place, for seedLife. */
  lifeClass?: LifeClassKey;
}

export type ToolResult = { ok: true } | { ok: false; reason: 'energy' | 'notAllowed' };

/** Energy income per year of simulated time, Ω (≈ 10 Ω per million years). */
const ENERGY_PER_YEAR = 1e-5;
/** Energy cannot be stockpiled beyond this. */
export const MAX_ENERGY = 5000;
export const STARTING_ENERGY = 500;

/** Physical brush radius of terrain tools, in metres. */
const BRUSH_RADIUS = 450_000;
const TERRAIN_STEP = 500;
const CRATER_DEPTH = 2000;
const VOLCANO_HEIGHT = 1500;
const VOLCANO_CO2 = 30;
const SEEDED_POPULATION = 0.5;

/** Applies a tool to the planet, paying its cost unless energy is unlimited. */
export function applyTool(state: PlanetState, use: ToolUse): ToolResult {
  const cost = TOOLS[use.tool].cost;
  const { globals } = state;
  if (!globals.unlimitedEnergy && globals.energy < cost) return { ok: false, reason: 'energy' };
  const centre = cellIndex(state.grid, use.x, use.y);
  const done = TOOL_EFFECTS[use.tool](state, centre, use);
  if (!done) return { ok: false, reason: 'notAllowed' };
  if (!globals.unlimitedEnergy) globals.energy -= cost;
  return { ok: true };
}

type Effect = (state: PlanetState, centre: number, use: ToolUse) => boolean;

const TOOL_EFFECTS: Record<ToolId, Effect> = {
  raise: (state, centre) => shapeTerrain(state, centre, TERRAIN_STEP, 1),
  lower: (state, centre) => shapeTerrain(state, centre, -TERRAIN_STEP, 1),
  volcano(state, centre) {
    shapeTerrain(state, centre, VOLCANO_HEIGHT, 0.5);
    state.globals.atmosphere.co2 += VOLCANO_CO2;
    return true;
  },
  meteor(state, centre) {
    shapeTerrain(state, centre, -CRATER_DEPTH, 1);
    // The blast and its fires wipe out life and settlements over a wide region.
    for (const [i, falloff] of brush(state, centre, 3)) {
      const survival = 1 - 0.95 * falloff;
      const n = state.grid.cellCount;
      for (let c = 0; c < LIFE_CLASSES.length; c++) {
        state.biota.populations[c * n + i] = state.biota.populations[c * n + i]! * survival;
      }
      state.fields.civilization[i] = state.fields.civilization[i]! * survival;
    }
    recordEvent(state, 'meteor');
    return true;
  },
  seedLife(state, centre, use) {
    if (!use.lifeClass) return false;
    const c = lifeClassIndex(use.lifeClass);
    // Only life that has evolved somewhere before can be placed, as in SimEarth.
    if (state.biota.appeared[c] === null) return false;
    const suitability = classSuitability(state, c);
    const n = state.grid.cellCount;
    let placed = false;
    for (const [i] of brush(state, centre, 1)) {
      if (suitability[i]! <= 0) continue;
      state.biota.populations[c * n + i] = Math.max(
        state.biota.populations[c * n + i]!,
        SEEDED_POPULATION * suitability[i]!,
      );
      placed = true;
    }
    return placed;
  },
  monolith(state, centre) {
    const civ = state.civilization;
    if (civ.species !== null) {
      // An existing civilization gets a leap in knowledge.
      civ.progress = Math.min(0.99, civ.progress + 0.5);
      recordEvent(state, 'monolith');
      return true;
    }
    // Otherwise the most promising animal near the monolith wakes up.
    const n = state.grid.cellCount;
    let best = -1;
    let bestScore = 0;
    let home = centre;
    for (const [i] of brush(state, centre, 2)) {
      LIFE_CLASSES.forEach((lifeClass, c) => {
        const score =
          (SENTIENCE_POTENTIAL[lifeClass.key] ?? 0) * state.biota.populations[c * n + i]!;
        if (score > bestScore) {
          bestScore = score;
          best = c;
          home = i;
        }
      });
    }
    if (best < 0) return false;
    recordEvent(state, 'monolith');
    makeSentient(state, best, home);
    return true;
  },
  addCo2(state) {
    state.globals.atmosphere.co2 += 200;
    return true;
  },
  removeCo2(state) {
    state.globals.atmosphere.co2 *= 0.5;
    return true;
  },
};

/** Raises (or lowers) terrain around a cell; new land on ocean crust becomes continental. */
function shapeTerrain(state: PlanetState, centre: number, amount: number, scale: number): boolean {
  const { elevation, crustType } = state.fields;
  for (const [i, falloff] of brush(state, centre, scale)) {
    elevation[i] = elevation[i]! + amount * falloff;
    if (elevation[i]! >= SEA_LEVEL) crustType[i] = 1;
  }
  return true;
}

/**
 * Cells within `scale` × the brush radius of a cell, with a linear falloff
 * (1 at the centre, 0 at the edge). Distances are measured on the sphere.
 */
function brush(state: PlanetState, centre: number, scale: number): [number, number][] {
  const { grid } = state;
  const radius = (BRUSH_RADIUS * scale) / grid.radius;
  const p = grid.cellPosition;
  const [cx, cy, cz] = [p[centre * 3]!, p[centre * 3 + 1]!, p[centre * 3 + 2]!];
  const result: [number, number][] = [];
  const rows = Math.ceil(radius / (Math.PI / grid.height)) + 1;
  const centreRow = Math.floor(centre / grid.width);
  for (
    let y = Math.max(0, centreRow - rows);
    y <= Math.min(grid.height - 1, centreRow + rows);
    y++
  ) {
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      const dot = cx * p[i * 3]! + cy * p[i * 3 + 1]! + cz * p[i * 3 + 2]!;
      const distance = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (distance <= radius) result.push([i, 1 - distance / radius]);
    }
  }
  return result;
}

/** Earns energy over time, as SimEarth's Ω budget. */
export const energyIncome: SimComponent = {
  name: 'energy',
  inputs: [],
  outputs: [],
  runOneStep(state, dtYears) {
    const { globals } = state;
    globals.energy = Math.min(MAX_ENERGY, globals.energy + ENERGY_PER_YEAR * dtYears);
  },
};
