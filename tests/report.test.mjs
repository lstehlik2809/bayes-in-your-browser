import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, runChains, summarize, DEFAULT_SETTINGS, PREDICTORS } from '../engine.js';
import { formatNumber } from '../formatting.js';

test('report uses fixed two decimals without negative zero, leaving inputs unchanged', () => {
  for (const [value, expected] of [[0, '0.00'], [-0, '0.00'], [-.0049, '0.00'], [.0049, '0.00'], [-.005, '-0.01'], [1.23456, '1.23'], [12345, '12,345.00'], [1.0101, '1.01'], [399.999, '400.00'], [NaN, '—'], [Infinity, '—']]) assert.equal(formatNumber(value), expected);
  const raw = 1.0101;
  assert.ok(raw > 1.01, 'a rounded R-hat at the boundary still exceeds the raw threshold');
  assert.equal(raw, 1.0101);
  assert.equal(DEFAULT_SETTINGS.draws, 4000);
});

test('empirical central 50% and 95% intervals use all retained values at full precision', () => {
  const chains = Array.from({ length: 4 }, (_, c) => Array.from({ length: 4 }, (_, i) => [c * 4 + i]));
  const before = structuredClone(chains);
  const [p] = summarize(chains, [{ id: 'known', label: 'Known quantiles', unit: 'units' }]);
  assert.equal(p.low50, 3.75);
  assert.equal(p.median, 7.5);
  assert.equal(p.high50, 11.25);
  assert.equal(p.low, .375);
  assert.equal(p.high, 14.625);
  assert.deepEqual(chains, before);
});

// Independent generated outcomes make every supported predictor carry a known
// association. The generator and outcome probabilities do not use the engine.
function fivePredictorRows() {
  let state = 701;
  const uniform = () => ((state = (1664525 * state + 1013904223) >>> 0) + .5) / 4294967296;
  const rows = Array.from({ length: 480 }, () => ({ Department: 'Sales', Age: 20 + 40 * uniform(), YearsAtCompany: 20 * uniform(), DistanceFromHome: 30 * uniform(), TotalWorkingYears: 35 * uniform(), OverTime: uniform() < .5 ? 'No' : 'Yes' }));
  const continuous = PREDICTORS.filter(field => field !== 'OverTime');
  const stats = Object.fromEntries(continuous.map(field => {
    const mean = rows.reduce((s, r) => s + r[field], 0) / rows.length;
    const sd = Math.sqrt(rows.reduce((s, r) => s + (r[field] - mean) ** 2, 0) / (rows.length - 1));
    return [field, { mean, sd }];
  }));
  const sigmoid = v => 1 / (1 + Math.exp(-v));
  for (const row of rows) {
    const z = continuous.map(field => (row[field] - stats[field].mean) / stats[field].sd);
    const eta = .9 * (z[0] - z[1] + z[2] - z[3] + +(row.OverTime === 'Yes'));
    row.MonthlyIncome = Math.exp(8 + eta + .15 * (uniform() - .5));
    row.Attrition = uniform() < sigmoid(eta - .4) ? 'Yes' : 'No';
    const u = uniform();
    row.JobSatisfaction = u < sigmoid(-1 - eta) ? 1 : u < sigmoid(.4 - eta) ? 2 : u < sigmoid(1.7 - eta) ? 3 : 4;
  }
  return rows;
}
const rows = fivePredictorRows();

for (const type of ['linear', 'logistic', 'ordinal']) {
  test(`${type} validates one through five distinct supported predictors`, () => {
    for (let count = 1; count <= 5; count++) assert.equal(buildModel(rows, { type, predictors: PREDICTORS.slice(0, count) }).scales.length, count);
    for (const predictors of [[], [...PREDICTORS, 'Age'], ['Age', 'Age'], ['JobLevel'], [...PREDICTORS.slice(0, 4), 'JobLevel']]) assert.throws(() => buildModel(rows, { type, predictors }), /one to five different supported/);
    assert.throws(() => buildModel(rows.map(r => ({ ...r, OverTime: 'No' })), { type, predictors: PREDICTORS }), /constant/);
  });

  test(`${type} fits all five predictors and recovers every generated association`, async () => {
    const fit = await runChains(buildModel(rows, { type, predictors: PREDICTORS }), { warmup: 600, draws: 600, seed: 101 });
    assert.equal(fit.config.predictors.length, 5);
    assert.equal(fit.chains.length, 4);
    assert.ok(fit.chains.every(c => c.length === 600));
    assert.ok(fit.chains.flat(2).every(Number.isFinite));
    assert.equal(fit.interval, '95% equal-tailed credible interval (empirical 2.5th–97.5th percentiles)');
    assert.deepEqual(fit.intervals.map(i => [i.level, i.lowerQuantile, i.upperQuantile]), [[.5, .25, .75], [.95, .025, .975]]);
    assert.ok(fit.summary.every(s => s.low <= s.low50 && s.low50 <= s.median && s.median <= s.high50 && s.high50 <= s.high));
    for (const [i, field] of PREDICTORS.entries()) {
      const summary = fit.summary.find(p => p.id === `beta_${field}`);
      const negative = i === 1 || i === 3;
      assert.ok(negative ? summary.probabilityAboveNull < .1 : summary.probabilityAboveNull > .9, `${type} recovers ${field}'s ${negative ? 'negative' : 'positive'} association`);
      const beta = fit.parameters.findIndex(p => p.id === `beta_${field}`), ratio = fit.parameters.findIndex(p => p.id === `multiplier_${field}`);
      for (const draw of fit.chains.flat()) assert.equal(draw[ratio], Math.exp(draw[beta]), `${field} transformed on every retained draw`);
    }
    if (type === 'logistic') {
      const probability = fit.parameters.findIndex(p => p.id === 'p_profile');
      for (const draw of fit.chains.flat()) assert.ok(Math.abs(draw[probability] - 1 / (1 + Math.exp(-draw[0]))) < 1e-14);
    }
    if (type === 'ordinal') {
      const cuts = ['c1', 'c2', 'c3'].map(id => fit.parameters.findIndex(p => p.id === id));
      const categories = fit.parameters.map((p, i) => p.family === 'category_probability' ? i : -1).filter(i => i >= 0);
      assert.deepEqual(categories.map(i => fit.parameters[i].categoryLabel), ['Low', 'Medium', 'High', 'Very High']);
      for (const draw of fit.chains.flat()) {
        assert.ok(draw[cuts[0]] < draw[cuts[1]] && draw[cuts[1]] < draw[cuts[2]]);
        assert.ok(Math.abs(categories.reduce((s, i) => s + draw[i], 0) - 1) < 1e-14);
      }
    }
  });
}
