/// <reference lib="webworker" />
import type { WorkerRequest } from './protocol';
import { SimHost } from './simHost';

declare const self: DedicatedWorkerGlobalScope;

const host = new SimHost(
  (message, transfer) => self.postMessage(message, transfer),
  (callback, delayMs) => setTimeout(callback, delayMs),
);

self.onmessage = (event: MessageEvent<WorkerRequest>) => host.handle(event.data);
