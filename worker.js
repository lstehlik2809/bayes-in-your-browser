import { buildModel, runChains } from './engine.js';
self.onmessage = async ({ data }) => {
  const { id, rows, config, settings } = data;
  try {
    const model = buildModel(rows, config);
    self.postMessage({ id, type: 'started', sampler: model.sampler, n: model.n });
    const result = await runChains(model, settings, progress => self.postMessage({ id, type: 'progress', progress }));
    self.postMessage({ id, type: 'result', result });
  } catch (error) { self.postMessage({ id, type: 'error', message: error.message || String(error) }); }
};
