import { parentPort, workerData } from 'node:worker_threads';
import { tsImport } from 'tsx/esm/api';
const { ChangeSessionRecords } = await tsImport('./changeSessionRecords.ts', import.meta.url);
const records = new ChangeSessionRecords(workerData.root);
parentPort.on('message', async ({ id, method, args }) => {
  try { parentPort.postMessage({ id, value: await records[method](...args) }); }
  catch (error) { parentPort.postMessage({ id, error: { message: error.message, code: error.code } }); }
});
