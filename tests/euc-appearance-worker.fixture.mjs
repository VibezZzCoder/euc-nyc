// Node-only adapter for the actual browser module worker. No production test hooks or browser dependencies.
import { parentPort, workerData } from 'node:worker_threads';

globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
const ready = import(workerData.entry);
parentPort.on('message', async data => {
  await ready;
  globalThis.onmessage({ data });
});
