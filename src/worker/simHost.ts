import { RENDERED_FIELDS } from '../render/mapRenderer';
import { areaWeightedMean } from '../sim/core/grid';
import { createRandomWorld, type World } from '../sim/world';
import type { Frame, WorkerRequest, WorkerResponse } from './protocol';

/** Simulated years per step. Will be driven by the selected time scale later. */
export const YEARS_PER_STEP = 1_000_000;

/**
 * Owns the simulation inside the worker. Kept free of worker globals so it can
 * be unit-tested: `post` sends responses and `schedule` queues the next
 * running step (setTimeout in the worker).
 */
export class SimHost {
  private world: World | undefined;
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
          this.world = createRandomWorld({
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
    this.world.simulation.step(this.world.planet, YEARS_PER_STEP);
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
    const { width, height, cellCount } = planet.grid;
    const frame: Frame = {
      grid: { width, height, cellCount },
      fields,
      year: planet.globals.year,
      meanTemperature: areaWeightedMean(planet.grid, planet.fields.airTemperature),
      timings: Object.fromEntries(simulation.timings),
    };
    this.post({ type: 'frame', frame }, transfer);
  }
}
