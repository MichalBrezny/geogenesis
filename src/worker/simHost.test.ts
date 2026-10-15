import { describe, expect, it } from 'vitest';
import type { WorkerResponse } from './protocol';
import { SimHost, YEARS_PER_STEP } from './simHost';

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
    host.handle({ type: 'create', seed: 1, width: 32, height: 16 });
    const frame = lastFrame(messages);
    expect(frame.year).toBe(0);
    expect(frame.grid).toEqual({ width: 32, height: 16, cellCount: 512 });
    expect(frame.fields.elevation).toHaveLength(512);
    expect(transfers[0]).toHaveLength(Object.keys(frame.fields).length);
  });

  it('steps once on request and keeps stepping while running', () => {
    const { host, messages, queue, runQueued } = createHost();
    host.handle({ type: 'create', seed: 1, width: 32, height: 16 });
    host.handle({ type: 'step' });
    expect(lastFrame(messages).year).toBe(YEARS_PER_STEP);

    host.handle({ type: 'run', running: true });
    runQueued();
    runQueued();
    expect(lastFrame(messages).year).toBe(3 * YEARS_PER_STEP);

    host.handle({ type: 'run', running: false });
    runQueued();
    expect(queue).toHaveLength(0);
    expect(lastFrame(messages).year).toBe(3 * YEARS_PER_STEP);
  });

  it('ignores manual steps while running', () => {
    const { host, messages } = createHost();
    host.handle({ type: 'create', seed: 1, width: 32, height: 16 });
    host.handle({ type: 'run', running: true });
    const count = messages.length;
    host.handle({ type: 'step' });
    expect(messages).toHaveLength(count);
  });
});
