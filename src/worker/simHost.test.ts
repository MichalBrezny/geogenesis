import { describe, expect, it, vi } from 'vitest';
import type { WorkerResponse } from './protocol';
import { SimHost } from './simHost';

function createHost() {
  const messages: WorkerResponse[] = [];
  const transfers: Transferable[][] = [];
  const queue: (() => void)[] = [];
  const host = new SimHost(
    (message, transfer) => {
      messages.push(message);
      transfers.push(transfer);
    },
    (callback) => queue.push(callback),
  );
  const runQueued = () => queue.splice(0).forEach((callback) => callback());
  return { host, messages, transfers, queue, runQueued };
}

function lastFrame(messages: WorkerResponse[]) {
  const last = messages[messages.length - 1];
  if (last?.type !== 'frame') throw new Error(`Expected a frame, got ${JSON.stringify(last)}`);
  return last.frame;
}

describe('SimHost', () => {
  it('sends a frame for a new planet with transferable field copies', () => {
    const { host, messages, transfers } = createHost();
    host.handle({
      type: 'create',
      scenario: 'random',
      seed: 1,
      width: 32,
      height: 16,
      start: 'young',
    });
    const frame = lastFrame(messages);
    expect(frame.year).toBeGreaterThan(0);
    expect(frame.grid).toEqual({ width: 32, height: 16, cellCount: 512 });
    expect(frame.fields.elevation).toHaveLength(512);
    expect(transfers[0]).toHaveLength(
      Object.keys(frame.fields).length + Object.keys(frame.history).length,
    );
    expect(frame.history.year).toEqual(Float64Array.of(frame.year));
  });

  it('steps once on request and keeps stepping while running', () => {
    const { host, messages, queue, runQueued } = createHost();
    host.handle({
      type: 'create',
      scenario: 'random',
      seed: 1,
      width: 32,
      height: 16,
      start: 'young',
    });
    // Each frame announces the length of the next step (set by the planet's era).
    const advance = () => {
      const before = lastFrame(messages);
      return before.year + before.stepYears;
    };
    let expected = advance();
    host.handle({ type: 'step' });
    expect(lastFrame(messages).year).toBe(expected);
    expect(lastFrame(messages).era).toBe('geological');

    host.handle({ type: 'run', running: true });
    expected = advance();
    runQueued();
    expect(lastFrame(messages).year).toBe(expected);
    expected = advance();
    runQueued();
    expect(lastFrame(messages).year).toBe(expected);

    host.handle({ type: 'run', running: false });
    runQueued();
    expect(queue).toHaveLength(0);
    expect(lastFrame(messages).year).toBe(expected);
  });

  it('saves a planet and loads it back', async () => {
    const { host, messages } = createHost();
    host.handle({
      type: 'create',
      scenario: 'daisyworld',
      seed: 2,
      width: 32,
      height: 16,
      start: 'young',
    });
    host.handle({ type: 'step' });
    const saved = lastFrame(messages);
    host.handle({ type: 'save' });
    await vi.waitFor(() => expect(messages.at(-1)?.type).toBe('saved'));
    const file = messages.at(-1) as Extract<WorkerResponse, { type: 'saved' }>;
    expect(file.fileName).toMatch(/.geogenesis$/);

    host.handle({
      type: 'create',
      scenario: 'random',
      seed: 9,
      width: 32,
      height: 16,
      start: 'young',
    });
    host.handle({ type: 'load', bytes: file.bytes });
    await vi.waitFor(() => expect(lastFrame(messages).scenario).toBe('daisyworld'));
    expect(lastFrame(messages).year).toBe(saved.year);
    expect(lastFrame(messages).fields.elevation).toEqual(saved.fields.elevation);
  });

  it('reports a broken save file', async () => {
    const { host, messages } = createHost();
    host.handle({ type: 'load', bytes: new Uint8Array([1, 2, 3]).buffer });
    await vi.waitFor(() => expect(messages.at(-1)?.type).toBe('error'));
  });

  it('ignores manual steps while running', () => {
    const { host, messages } = createHost();
    host.handle({
      type: 'create',
      scenario: 'random',
      seed: 1,
      width: 32,
      height: 16,
      start: 'young',
    });
    host.handle({ type: 'run', running: true });
    const count = messages.length;
    host.handle({ type: 'step' });
    expect(messages).toHaveLength(count);
  });

  it('clamps controls to the active goal ranges', () => {
    const { host, messages } = createHost();
    host.handle({
      type: 'create',
      scenario: 'brighteningSun',
      seed: 1,
      width: 32,
      height: 16,
      start: 'quick',
    });
    host.handle({
      type: 'controls',
      controls: { solarFactor: 0.2, cloudAlbedo: 9, driftSpeed: 2 },
    });
    const frame = lastFrame(messages);
    expect(frame.controls.solarFactor).toBe(0.92);
    expect(frame.controls.cloudAlbedo).toBe(1.3);
    expect(frame.controls.driftSpeed).toBe(2);
    expect(frame.goal?.conditions.length).toBeGreaterThan(0);
  });

  it('stops the run loop when a goal reaches an outcome', () => {
    const { host, messages, queue, runQueued } = createHost();
    host.handle({
      type: 'create',
      scenario: 'snowball',
      seed: 1,
      width: 32,
      height: 16,
      start: 'quick',
    });
    host.handle({ type: 'controls', controls: { surfaceAlbedo: 0.9 } });
    for (let i = 0; i < 5; i++) {
      host.handle({ type: 'tool', use: { tool: 'addCo2', x: 0, y: 0 } });
    }
    host.handle({ type: 'run', running: true });
    for (let i = 0; i < 10 && lastFrame(messages).goal?.status === 'active'; i++) runQueued();
    const outcome = lastFrame(messages);
    expect(outcome.goal?.status).toBe('won');
    expect(outcome.events.at(-1)?.key).toBe('goalWon');
    expect(queue).toHaveLength(0);
    runQueued();
    expect(lastFrame(messages).year).toBe(outcome.year);
  });
});

describe('SimHost cell inspection', () => {
  it('answers an inspect request with that cell life and monthly climate only', () => {
    const { host, messages } = createHost();
    host.handle({
      type: 'create',
      scenario: 'random',
      seed: 1,
      width: 32,
      height: 16,
      start: 'quick',
    });
    const framesBefore = messages.length;
    host.handle({ type: 'inspect', cell: 5 });
    expect(messages).toHaveLength(framesBefore + 1);
    const reply = messages[messages.length - 1]!;
    expect(reply.type).toBe('cellLife');
    if (reply.type === 'cellLife') {
      expect(reply.life.cell).toBe(5);
      expect(reply.climate?.temperature).toHaveLength(12);
      expect(reply.climate?.precipitation).toHaveLength(12);
    }
    expect(lastFrameFields(messages)).not.toContain('populations');
  });
});

function lastFrameFields(messages: WorkerResponse[]): string[] {
  const frame = messages.find((m) => m.type === 'frame');
  return frame?.type === 'frame' ? Object.keys(frame.frame.fields) : [];
}
