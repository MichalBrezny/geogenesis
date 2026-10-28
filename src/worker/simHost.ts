import { RENDERED_FIELDS, type RenderedField } from '../render/mapRenderer';
import { HISTORY_SERIES, type HistorySeries } from '../sim/history';
import { inspectCellLife, updateDiversity } from '../sim/models/biosphere/diversity';
import { oxygenPartialPressure } from '../sim/models/atmosphere/atmosphere';
import { createScenario, isScenarioId, restoreScenario, type ScenarioId } from '../sim/scenarios';
import { compress, decompress, deserializeGame, serializeGame } from '../sim/serialize';
import { applyTool, energyCap } from '../sim/tools/tools';
import type { World } from '../sim/world';
import type { FrameUpdate, WorkerRequest, WorkerResponse } from './protocol';
import { clampGoalCivilizationPolicy, clampGoalControls, GOALS } from '../sim/goals/goals';
import { biosignature } from '../sim/models/biosphere/biosignature';
import { updateCivilizationPolicy } from '../sim/data/civilization';
import { monthlyClimate } from '../sim/models/atmosphere/climateDiagram';
import { MAX_EVENTS } from '../sim/events';
import { updateMapNames } from '../sim/mapNames';
import { gaiaDiagnostic } from '../sim/diagnostics';
import { modelControlChangeCost } from '../sim/controls';
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
  private quietTicks = 0;
  private autoPause: AutoPauseSettings = { ...DEFAULT_AUTO_PAUSE };
  private worldRevision = 0;
  private requestedFields = new Set<RenderedField>(RENDERED_FIELDS);
  private fullFramePending = true;
  private frameBackpressure = false;
  private frameOutstanding = false;
  private framePending = false;

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
          this.fullFramePending = true;
          this.frameOutstanding = false;
          this.framePending = false;
          this.scenario = request.scenario;
          this.world = createScenario(request.scenario, {
            seed: request.seed,
            width: request.width,
            height: request.height,
            start: request.start,
            continentalFraction: request.continentalFraction,
            planetParams: request.planetParams,
            difficulty: request.difficulty,
            adaptivePacing: request.adaptivePacing,
          });
          this.sendFrame();
          break;
        case 'run':
          this.running = request.running;
          this.notePlayerInput();
          this.scheduleTick();
          break;
        case 'step':
          if (!this.running) {
            this.notePlayerInput();
            this.advance(false);
          }
          break;
        case 'tool': {
          if (!this.world) break;
          this.notePlayerInput();
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
          this.notePlayerInput();
          {
            const changes = clampGoalControls(this.world.planet, request.controls);
            const cost = modelControlChangeCost(this.world.planet, changes);
            const globals = this.world.planet.globals;
            if (!globals.unlimitedEnergy && globals.energy + 1e-9 < cost) {
              this.post({ type: 'toolRefused', reason: 'energy' }, []);
            } else {
              if (!globals.unlimitedEnergy) globals.energy = Math.max(0, globals.energy - cost);
              Object.assign(this.world.planet.controls, changes);
            }
          }
          this.sendFrame();
          break;
        case 'civPolicy':
          if (!this.world) break;
          this.notePlayerInput();
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
          this.notePlayerInput();
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
          this.notePlayerInput();
          break;
        case 'save':
          void this.save(request.fileName);
          break;
        case 'load':
          void this.load(request.bytes);
          break;
        case 'unlimitedEnergy':
          if (!this.world) break;
          this.notePlayerInput();
          this.world.planet.globals.unlimitedEnergy = request.enabled;
          this.sendFrame();
          break;
        case 'view':
          this.requestedFields = new Set(
            request.fields.filter((field) => RENDERED_FIELDS.includes(field)),
          );
          this.sendFrame();
          break;
        case 'frameAck':
          this.frameBackpressure = true;
          this.frameOutstanding = false;
          if (this.framePending) {
            this.framePending = false;
            this.sendFrame();
          }
          break;
        case 'pacing':
          if (!this.world) break;
          this.notePlayerInput();
          this.world.planet.pacing.adaptive = request.adaptive;
          this.sendFrame();
          break;
      }
    } catch (error) {
      this.post({ type: 'error', message: String(error) }, []);
    }
  }

  private async save(requestedFileName?: string): Promise<void> {
    if (!this.world) return;
    const { planet } = this.world;
    try {
      const bytes = await compress(
        serializeGame({ scenario: this.scenario, settings: this.world.settings, planet }),
      );
      const fileName = requestedFileName ?? `planet-${Math.round(planet.globals.year)}.geogenesis`;
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
      this.fullFramePending = true;
      this.frameOutstanding = false;
      this.framePending = false;
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
      this.advance(true);
      this.scheduleTick();
    }, this.delayMs);
  }

  private advance(allowBatch: boolean): void {
    if (!this.world) return;
    const planet = this.world.planet;
    const batches =
      allowBatch && planet.pacing.adaptive && this.delayMs === 0
        ? this.quietTicks >= 5
          ? 8
          : this.quietTicks >= 2
            ? 4
            : 1
        : 1;
    let quiet = true;
    for (let step = 0; step < batches; step++) {
      const beforeEvent = planet.events.at(-1);
      const beforeEra = this.world.era(planet);
      const wasActive = planet.goal?.status === 'active';
      this.world.simulation.step(planet, this.world.stepYears(planet));
      const previousIndex = beforeEvent === undefined ? -1 : planet.events.indexOf(beforeEvent);
      const newEvents = planet.events.slice(previousIndex + 1);
      if (newEvents.length > 0 || this.world.era(planet) !== beforeEra) quiet = false;
      if (this.running && autoPauseEvent(newEvents, this.autoPause)) {
        this.running = false;
        break;
      }
      if (wasActive && planet.goal?.status !== 'active') {
        this.running = false;
        quiet = false;
        break;
      }
      if (!quiet) break;
    }
    this.quietTicks = quiet ? this.quietTicks + 1 : 0;
    this.sendFrame();
  }

  private notePlayerInput(): void {
    this.quietTicks = 0;
  }

  private sendFrame(): void {
    if (!this.world) return;
    if (this.frameBackpressure && this.frameOutstanding && this.running) {
      this.framePending = true;
      return;
    }
    const frameStarted = performance.now();
    const { planet, simulation } = this.world;
    const fieldsToSend = this.fullFramePending ? RENDERED_FIELDS : [...this.requestedFields];
    if (fieldsToSend.includes('diversity')) updateDiversity(planet);
    const fields: FrameUpdate['fields'] = {};
    const transfer: Transferable[] = [];
    let transferBytes = 0;
    for (const name of fieldsToSend) {
      const copy = planet.fields[name].slice();
      (fields as Record<string, Float32Array | Int32Array>)[name] = copy;
      transfer.push(copy.buffer);
      transferBytes += copy.byteLength;
    }
    const history = {} as Record<HistorySeries, Float64Array>;
    for (const name of HISTORY_SERIES) {
      history[name] = Float64Array.from(planet.history[name]);
      transfer.push(history[name].buffer);
      transferBytes += history[name].byteLength;
    }
    const { width, height, cellCount } = planet.grid;
    const frame: FrameUpdate = {
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
      energyCap: energyCap(planet),
      unlimitedEnergy: planet.globals.unlimitedEnergy,
      controls: { ...planet.controls },
      effectiveControls: { ...planet.effectiveControls },
      difficulty: planet.difficulty,
      adaptivePacing: planet.pacing.adaptive,
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
      frameTiming: { buildMs: 0, transferBytes },
    };
    frame.frameTiming.buildMs = performance.now() - frameStarted;
    this.fullFramePending = false;
    if (this.frameBackpressure) this.frameOutstanding = true;
    this.post({ type: 'frame', frame }, transfer);
  }
}
