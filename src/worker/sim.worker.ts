/// <reference lib="webworker" />
import type { WorkerRequest } from './protocol';
import { SimHost } from './simHost';

declare const self: DedicatedWorkerGlobalScope;

const host = new SimHost(
  (message, transfer) => self.postMessage(message, transfer),
  (callback) => setTimeout(callback, 0),
);

self.onmessage = (event: MessageEvent<WorkerRequest>) => host.handle(event.data);
