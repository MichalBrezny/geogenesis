import { RENDERED_FIELDS } from '../render/mapRenderer';
import { HISTORY_SERIES, type HistorySeries } from '../sim/history';
import { inspectCellLife, updateDiversity } from '../sim/models/biosphere/diversity';
import { oxygenPartialPressure } from '../sim/models/atmosphere/atmosphere';
import { createScenario, isScenarioId, restoreScenario, type ScenarioId } from '../sim/scenarios';
import { compress, decompress, deserializeGame, serializeGame } from '../sim/serialize';
import { applyTool } from '../sim/tools/tools';
import type { World } from '../sim/world';
import type { Frame, WorkerRequest, WorkerResponse } from './protocol';
import { clampGoalCivilizationPolicy, clampGoalControls, GOALS } from '../sim/goals/goals';
import { biosignature } from '../sim/models/biosphere/biosignature';
import { updateCivilizationPolicy } from '../sim/data/civilization';
import { monthlyClimate } from '../sim/models/atmosphere/climateDiagram';
import { MAX_EVENTS } from '../sim/events';
import { updateMapNames } from '../sim/mapNames';
import { gaiaDiagnostic } from '../sim/diagnostics';
import { autoPauseEvent, DEFAULT_AUTO_PAUSE, type AutoPauseSettings } from '../sim/autoPause';

/** How many recent events each frame carries. */
const EVENTS_IN_FRAME = MAX_EVENTS;

/**
 * Owns the simulation inside the worker. Kept free of worker globals so it can
 * be unit-tested: `post` sends responses and `schedule` queues the next
 * running step (setTimeout in the worker).
 */
export class SimHost {
  private world: World | undefined;
  private scenario: ScenarioId = 'random';
  private running = false;
  private scheduled = false;
  private delayMs = 0;
  private autoPause: AutoPauseSettings = { ...DEFAULT_AUTO_PAUSE };
  private worldRevision = 0;

  constructor(
    private readonly post: (message: WorkerResponse, transfer: Transferable[]) => void,
    private readonly schedule: (callback: () => void, delayMs: number) => void,
  ) {}

  handle(request: WorkerRequest): void {
    try {
      switch (request.type) {
        case 'create':
          this.running = false;
          this.worldRevision++;
          this.scenario = request.scenario;
          this.world = createScenario(request.scenario, {
            seed: request.seed,
            width: request.width,
            height: request.height,
            start: request.start,
            continentalFraction: request.continentalFraction,
            planetParams: request.planetParams,
          });
          this.sendFrame();
          break;
        case 'run':
          this.running = request.running;
          this.scheduleTick();
          break;
        case 'step':
          if (!this.running) this.advance();
          break;
        case 'tool': {
          if (!this.world) break;
          const events = this.world.planet.events;
          const previousLastEvent = events.at(-1);
          const result = applyTool(this.world.planet, request.use);
          if (!result.ok) this.post({ type: 'toolRefused', reason: result.reason }, []);
          else {
            const previousIndex =
              previousLastEvent === undefined ? -1 : events.indexOf(previousLastEvent);
            if (this.running && autoPauseEvent(events.slice(previousIndex + 1), this.autoPause)) {
              this.running = false;
            }
            this.post(
              {
                type: 'toolApplied',
                tool: request.use.tool,
                cell: request.use.y * this.world.planet.grid.width + request.use.x,
              },
              [],
            );
          }
          this.sendFrame();
          break;
        }
        case 'controls':
          if (!this.world) break;
          Object.assign(
            this.world.planet.controls,
            clampGoalControls(this.world.planet, request.controls),
          );
          this.sendFrame();
          break;
        case 'civPolicy':
          if (!this.world) break;
          this.world.planet.civPolicy = clampGoalCivilizationPolicy(
            this.world.planet,
            updateCivilizationPolicy(
              this.world.planet.civPolicy,
              request.policy,
              this.world.planet.civilization.age,
            ),
          );
          this.sendFrame();
          break;
        case 'disasters':
          if (!this.world) break;
          Object.assign(this.world.planet.disasters, request.disasters);
          this.sendFrame();
          break;
        case 'autoPause':
          this.autoPause = { ...request.settings };
          break;
        case 'inspect':
          if (!this.world) break;
          this.post(
            {
              type: 'cellLife',
              life: inspectCellLife(this.world.planet, request.cell),
              ...(this.scenario === 'daisyworld'
                ? {}
                : { climate: monthlyClimate(this.world.planet, request.cell) }),
            },
            [],
          );
          break;
        case 'speed':
          this.delayMs = Math.max(0, request.delayMs);
          break;
        case 'save':
          void this.save();
          break;
        case 'load':
          void this.load(request.bytes);
          break;
        case 'unlimitedEnergy':
          if (!this.world) break;
          this.world.planet.globals.unlimitedEnergy = request.enabled;
          this.sendFrame();
          break;
      }
    } catch (error) {
      this.post({ type: 'error', message: String(error) }, []);
    }
  }

  private async save(): Promise<void> {
    if (!this.world) return;
    const { planet } = this.world;
    try {
      const bytes = await compress(
        serializeGame({ scenario: this.scenario, settings: this.world.settings, planet }),
      );
      const fileName = `planet-${Math.round(planet.globals.year)}.geogenesis`;
      this.post({ type: 'saved', bytes: bytes.buffer as ArrayBuffer, fileName }, [bytes.buffer]);
    } catch (error) {
      this.post({ type: 'error', message: String(error) }, []);
    }
  }

  private async load(buffer: ArrayBuffer): Promise<void> {
    try {
      const game = deserializeGame(await decompress(new Uint8Array(buffer)));
      if (!isScenarioId(game.scenario)) throw new Error(`Unknown scenario "${game.scenario}"`);
      this.scenario = game.scenario;
      this.running = false;
      this.worldRevision++;
      this.world = restoreScenario(game.scenario, game.planet, game.settings);
      if (this.world.planet.mapNaming.updatedYear < 0) updateMapNames(this.world.planet);
      this.sendFrame();
    } catch (error) {
      this.post({ type: 'error', message: String(error) }, []);
    }
  }

  private scheduleTick(): void {
    if (!this.running || this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      if (!this.running) return;
      this.advance();
      this.scheduleTick();
    }, this.delayMs);
  }

  private advance(): void {
    if (!this.world) return;
    const events = this.world.planet.events;
    const previousLastEvent = events.at(-1);
    const wasActive = this.world.planet.goal?.status === 'active';
    this.world.simulation.step(this.world.planet, this.world.stepYears(this.world.planet));
    const previousIndex = previousLastEvent === undefined ? -1 : events.indexOf(previousLastEvent);
    const newEvents = events.slice(previousIndex + 1);
    if (this.running && autoPauseEvent(newEvents, this.autoPause)) this.running = false;
    if (wasActive && this.world.planet.goal?.status !== 'active') this.running = false;
    this.sendFrame();
  }

  private sendFrame(): void {
    if (!this.world) return;
    const { planet, simulation } = this.world;
    updateDiversity(planet);
    const fields = {} as Frame['fields'];
    const transfer: Transferable[] = [];
    for (const name of RENDERED_FIELDS) {
      const copy = planet.fields[name].slice();
      (fields as Record<string, Float32Array | Int32Array>)[name] = copy;
      transfer.push(copy.buffer);
    }
    const history = {} as Record<HistorySeries, Float64Array>;
    for (const name of HISTORY_SERIES) {
      history[name] = Float64Array.from(planet.history[name]);
      transfer.push(history[name].buffer);
    }
    const { width, height, cellCount } = planet.grid;
    const frame: Frame = {
      worldRevision: this.worldRevision,
      running: this.running,
      scenario: this.scenario,
      grid: { width, height, cellCount },
      fields,
      seaLevel: planet.globals.seaLevel,
      clathrateCarbon: planet.globals.clathrateCarbon,
      water: planet.globals.water,
      year: planet.globals.year,
      meanTemperature: planet.globals.meanTemperature,
      runawayMargin: planet.globals.runawayMargin,
      solarInput: planet.globals.solarInput,
      co2: planet.globals.atmosphere.co2,
      surfacePressure: planet.globals.surfacePressure,
      o2Pressure: oxygenPartialPressure(planet.globals.atmosphere),
      iceFraction: planet.globals.iceFraction,
      o2: planet.globals.atmosphere.o2,
      ch4: planet.globals.atmosphere.ch4,
      life: { cover: [...planet.biota.cover], appeared: [...planet.biota.appeared] },
      civilization: { ...planet.civilization },
      civPolicy: {
        energy: { ...planet.civPolicy.energy },
        investment: { ...planet.civPolicy.investment },
      },
      fossilCarbon: planet.globals.fossilCarbon,
      pollution: planet.globals.pollution,
      carbonBudget: structuredClone(planet.globals.carbonBudget),
      energyBalance: structuredClone(planet.globals.energyBalance),
      gaia: gaiaDiagnostic(planet),
      events: planet.events.slice(-EVENTS_IN_FRAME),
      mapFeatures: planet.mapNaming.features.map((feature) => ({
        id: feature.id,
        kind: feature.kind,
        name: feature.name,
        cell: feature.cell,
        size: feature.size,
        ...(feature.plateId === undefined ? {} : { plateId: feature.plateId }),
      })),
      tectonics: {
        plates: planet.plates.map(({ id, eulerPole, angularSpeed }) => ({
          id,
          eulerPole: [...eulerPole] as [number, number, number],
          angularSpeed,
        })),
        hotspots: planet.geosphere.hotspots.map(({ id, position, strength }) => ({
          id,
          position: [...position] as [number, number, number],
          strength,
        })),
      },
      stepYears: this.world.stepYears(planet),
      era: this.world.era(planet),
      energy: planet.globals.energy,
      unlimitedEnergy: planet.globals.unlimitedEnergy,
      controls: { ...planet.controls },
      disasters: { ...planet.disasters },
      devices: planet.devices.map((device) => ({ ...device })),
      biosignature: biosignature(planet.globals.atmosphere),
      goal: planet.goal
        ? {
            ...planet.goal,
            memory: { ...planet.goal.memory },
            conditions: GOALS[planet.goal.id].conditions(planet, planet.goal),
            controlLimits: GOALS[planet.goal.id].controlLimits,
            civPolicyLimits: GOALS[planet.goal.id].civPolicyLimits,
          }
        : null,
      planetParams: { ...planet.planetParams },
      magneticField: planet.globals.magneticField,
      tectonicRegime: planet.globals.tectonicRegime,
      timings: Object.fromEntries(simulation.timings),
      history,
    };
    this.post({ type: 'frame', frame }, transfer);
  }
}
