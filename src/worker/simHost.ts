import { RENDERED_FIELDS } from '../render/mapRenderer';
import { HISTORY_SERIES, type HistorySeries } from '../sim/history';
import { createScenario, type ScenarioId } from '../sim/scenarios';
import type { World } from '../sim/world';
import type { Frame, WorkerRequest, WorkerResponse } from './protocol';

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

  constructor(
    private readonly post: (message: WorkerResponse, transfer: Transferable[]) => void,
    private readonly schedule: (callback: () => void) => void,
  ) {}

  handle(request: WorkerRequest): void {
    try {
      switch (request.type) {
        case 'create':
          this.scenario = request.scenario;
          this.world = createScenario(request.scenario, {
            seed: request.seed,
            width: request.width,
            height: request.height,
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
      }
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
    });
  }

  private advance(): void {
    if (!this.world) return;
    this.world.simulation.step(this.world.planet, this.world.yearsPerStep);
    this.sendFrame();
  }

  private sendFrame(): void {
    if (!this.world) return;
    const { planet, simulation } = this.world;
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
      scenario: this.scenario,
      grid: { width, height, cellCount },
      fields,
      year: planet.globals.year,
      meanTemperature: planet.globals.meanTemperature,
      solarInput: planet.globals.solarInput,
      co2: planet.globals.atmosphere.co2,
      iceFraction: planet.globals.iceFraction,
      timings: Object.fromEntries(simulation.timings),
      history,
    };
    this.post({ type: 'frame', frame }, transfer);
  }
}
