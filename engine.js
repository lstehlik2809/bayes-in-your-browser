/* Dependency-free posterior sampling. Priors and transformations are part of the public model. */
export const CONTINUOUS = ['Age', 'YearsAtCompany', 'DistanceFromHome', 'TotalWorkingYears'];
export const PREDICTORS = [...CONTINUOUS, 'OverTime'];
export const GROUPS = ['Gender', 'OverTime', 'Department', 'BusinessTravel', 'Attrition'];
export const DEFAULT_SETTINGS = { warmup: 1000, draws: 1500, seed: 2026, chains: 4 };
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const mv = (A, v) => A.map(r => dot(r, v));
const quadratic = (v, A) => dot(v, mv(A, v));
const zeros = n => Array.from({ length: n }, () => Array(n).fill(0));
export function quantile(sorted, p) { const k = (sorted.length - 1) * p, i = Math.floor(k); return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (k - i); }
function cholesky(A) {
  const L = zeros(A.length);
  for (let i = 0; i < A.length; i++) for (let j = 0; j <= i; j++) {
    let s = A[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    if (i === j && !(s > 0)) throw new Error('The model matrix could not be factored. Choose different predictors.');
    L[i][j] = i === j ? Math.sqrt(s) : s / L[j][j];
  } return L;
}
function solve(A, b) {
  const L = cholesky(A), n = b.length, y = [], x = Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let j = 0; j < i; j++) s -= L[i][j] * y[j]; y[i] = s / L[i][i]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let j = i + 1; j < n; j++) s -= L[j][i] * x[j]; x[i] = s / L[i][i]; }
  return x;
}
function inverse(A) { const n = A.length, columns = Array.from({ length: n }, (_, i) => solve(A, Array.from({ length: n }, (_, j) => +(i === j)))); return columns[0].map((_, i) => columns.map(c => c[i])); }
export function createRng(seed) {
  let state = seed >>> 0, spare;
  const uniform = () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const normal = () => { if (spare !== undefined) { const z = spare; spare = undefined; return z; } const r = Math.sqrt(-2 * Math.log(Math.max(uniform(), Number.MIN_VALUE))), t = 2 * Math.PI * uniform(); spare = r * Math.sin(t); return r * Math.cos(t); };
  const gamma = shape => {
    if (shape < 1) return gamma(shape + 1) * Math.pow(Math.max(uniform(), Number.MIN_VALUE), 1 / shape);
    const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
    while (true) { const x = normal(), v0 = 1 + c * x; if (v0 <= 0) continue; const v = v0 ** 3, u = uniform(); if (u < 1 - .0331 * x ** 4 || Math.log(u) < .5 * x * x + d * (1 - v + Math.log(v))) return d * v; }
  };
  return { uniform, normal, gamma };
}
function parameter(id, label, unit, extra = {}) { return { id, label, unit, ...extra }; }
function requireNumber(value, name) { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} contains a missing or invalid number.`); return value; }
function yesNo(value, field) { if (value !== 'Yes' && value !== 'No') throw new Error(`${field} must contain Yes or No.`); return +(value === 'Yes'); }
export function buildModel(rows, config = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('No employees are available for this selection.');
  const type = config.type ?? 'proportion', priorName = config.prior ?? 'default';
  if (!['proportion', 'compare', 'linear', 'logistic'].includes(type)) throw new Error('Choose a supported analysis.');
  if (!['default', 'wide'].includes(priorName)) throw new Error('Choose a supported prior.');
  const department = config.department ?? 'All';
  if (!['All', 'Human Resources', 'Research & Development', 'Sales'].includes(department)) throw new Error('Choose a supported department.');
  let selected = rows.filter(r => department === 'All' || r.Department === department);
  if (!selected.length) throw new Error('No employees are available for this department.');
  const model = { type, config: { ...config, type, prior: priorName, department }, n: selected.length, parameters: [], scales: [], prior: {}, observed: {}, sampler: '' };
  const wide = priorName === 'wide';
  if (type === 'proportion') {
    const groupBy = config.groupBy ?? 'Overall';
    if (groupBy !== 'Overall' && !GROUPS.includes(groupBy)) throw new Error('Choose a supported grouping field.');
    const levels = groupBy === 'Overall' ? ['All employees'] : [...new Set(selected.map(r => r[groupBy]))].sort();
    if (levels.some(x => typeof x !== 'string' || !x)) throw new Error('The grouping field contains invalid values.');
    model.groups = levels.map((level, i) => { const group = groupBy === 'Overall' ? selected : selected.filter(r => r[groupBy] === level); const events = group.reduce((s, r) => s + yesNo(r.Attrition, 'Attrition'), 0); return { level, n: group.length, events, alpha: (wide ? .5 : 1) + events, beta: (wide ? .5 : 1) + group.length - events, id: `p_${i}` }; });
    model.parameters = model.groups.map(g => parameter(g.id, g.level, 'probability', { transform: 'identity', null: null, n: g.n, events: g.events }));
    model.prior = { family: 'Beta', alpha: wide ? .5 : 1, beta: wide ? .5 : 1 };
    model.sampler = 'Exact independent Beta posterior draws';
    model.observed = { employees: selected.length, events: model.groups.reduce((s, g) => s + g.events, 0), groups: model.groups.map(g => ({ label: g.level, n: g.n, events: g.events })) };
    return model;
  }
  let X;
  if (type === 'compare') {
    const { groupBy, groupA, groupB } = config;
    if (!GROUPS.includes(groupBy)) throw new Error('Choose a supported grouping field.');
    if (typeof groupA !== 'string' || typeof groupB !== 'string' || groupA === groupB) throw new Error('Choose two different groups.');
    selected = selected.filter(r => r[groupBy] === groupA || r[groupBy] === groupB);
    const nA = selected.filter(r => r[groupBy] === groupA).length, nB = selected.length - nA;
    if (!nA || !nB) throw new Error('Both selected groups need at least one employee in this department.');
    model.n = selected.length;
    model.observed.groups = [{ label: groupA, n: nA }, { label: groupB, n: nB }];
    X = selected.map(r => [1, +(r[groupBy] === groupB)]);
    model.parameters = [parameter('intercept', 'Group A log geometric mean', 'log income units/month', { transform: 'beta[0]' }), parameter('beta_group', 'Group B − A, log income', 'log multiplier', { transform: 'beta[1]', null: 0 }), parameter('geomean_A', `${groupA} geometric mean`, 'income units/month', { transform: 'exp(beta[0])', family: 'income' }), parameter('geomean_B', `${groupB} geometric mean`, 'income units/month', { transform: 'exp(beta[0]+beta[1])', family: 'income' }), parameter('ratio', `${groupB} / ${groupA}`, 'income multiplier', { transform: 'exp(beta[1])', null: 1, family: 'ratio' })];
  } else {
    const predictors = config.predictors;
    if (!Array.isArray(predictors) || predictors.length < 1 || predictors.length > 3 || new Set(predictors).size !== predictors.length || predictors.some(p => !PREDICTORS.includes(p))) throw new Error('Choose one to three different suitable predictors.');
    model.scales = predictors.map(field => {
      const binary = field === 'OverTime'; const values = selected.map(r => binary ? yesNo(r[field], field) : requireNumber(r[field], field));
      const center = mean(values), sd = Math.sqrt(values.reduce((s, v) => s + (v - center) ** 2, 0) / (values.length - 1));
      if (!(sd > 0) || !Number.isFinite(sd)) throw new Error(`${field} is constant in this selection. Choose another predictor or department.`);
      return { field, mean: binary ? 0 : center, sd: binary ? 1 : sd, sampleMean: center, sampleSD: sd, binary, change: binary ? 'No → Yes' : `+1 SD (${sd.toPrecision(4)} ${field === 'Age' || field.includes('Years') ? 'years' : 'distance units'})` };
    });
    X = selected.map(r => [1, ...model.scales.map(s => ((s.binary ? yesNo(r[s.field], s.field) : r[s.field]) - s.mean) / s.sd)]);
    model.parameters = [parameter('intercept', 'Intercept', type === 'linear' ? 'log income units/month' : 'log odds', { transform: 'beta[0]', null: null })];
    model.scales.forEach((s, i) => model.parameters.push(parameter(`beta_${s.field}`, s.field, type === 'linear' ? `log multiplier; ${s.change}` : `log odds; ${s.change}`, { transform: `beta[${i + 1}]`, null: 0 })));
    if (type === 'linear') model.parameters.push(parameter('geomean_profile', 'Geometric mean at reference profile', 'income units/month', { transform: 'exp(beta[0])', family: 'income' }));
    else model.parameters.push(parameter('p_profile', 'Attrition probability at reference profile', 'probability', { transform: 'logistic(beta[0])', family: 'probability' }));
    model.scales.forEach((s, i) => model.parameters.push(parameter(`multiplier_${s.field}`, `${s.field} ${type === 'linear' ? 'income multiplier' : 'odds ratio'}`, s.change, { transform: `exp(beta[${i + 1}])`, null: 1, family: 'ratio' })));
  }
  model.X = X;
  model.observed.employees = selected.length;
  model.y = selected.map(r => type === 'logistic' ? yesNo(r.Attrition, 'Attrition') : Math.log(requireNumber(r.MonthlyIncome, 'MonthlyIncome')));
  if (type !== 'logistic' && model.y.some(y => !Number.isFinite(y))) throw new Error('MonthlyIncome must be positive for every included employee.');
  const p = X[0].length;
  if (type === 'logistic') {
    model.prior = { family: 'Independent Normal', mean: Array(p).fill(0), sd: [wide ? 5 : 2.5, ...Array(p - 1).fill(wide ? 2.5 : 1)] };
    model.observed.events = model.y.reduce((a, b) => a + b, 0);
    model.sampler = 'Preconditioned Metropolis-adjusted Langevin (MALA)';
  } else {
    model.prior = { family: 'Normal–Inverse-Gamma', a: 2, b: wide ? 4 : 1, mean: [Math.log(5000), ...Array(p - 1).fill(0)], variance: [wide ? 16 : 4, ...Array(p - 1).fill(wide ? 4 : 1)] };
    model.parameters.forEach(p => { if (p.transform.startsWith('exp(')) p.undefinedMoments = true; });
    model.parameters.push(parameter('sigma', 'Residual SD on log income', 'log income units', { transform: 'sqrt(sigma2)', family: 'sigma' }));
    model.sampler = 'Exact independent Normal–Inverse-Gamma posterior draws';
    const precision = zeros(p), rhs = Array(p).fill(0);
    for (let j = 0; j < p; j++) { precision[j][j] = 1 / model.prior.variance[j]; rhs[j] = model.prior.mean[j] / model.prior.variance[j]; }
    X.forEach((x, i) => { for (let j = 0; j < p; j++) { rhs[j] += x[j] * model.y[i]; for (let k = 0; k < p; k++) precision[j][k] += x[j] * x[k]; } });
    const location = solve(precision, rhs), covariance = inverse(precision);
    let residual = 0; X.forEach((x, i) => { residual += (model.y[i] - dot(x, location)) ** 2; });
    location.forEach((b, j) => { residual += (b - model.prior.mean[j]) ** 2 / model.prior.variance[j]; });
    model.posterior = { mean: location, covariance, a: model.prior.a + model.n / 2, b: model.prior.b + residual / 2 };
  }
  return model;
}
function logisticState(model, beta, hessian = false) {
  const grad = beta.map((b, j) => -b / model.prior.sd[j] ** 2), H = hessian ? zeros(beta.length) : null;
  let logp = -.5 * beta.reduce((s, b, j) => s + (b / model.prior.sd[j]) ** 2, 0);
  if (H) beta.forEach((_, j) => { H[j][j] = 1 / model.prior.sd[j] ** 2; });
  for (let i = 0; i < model.n; i++) {
    const x = model.X[i], eta = dot(x, beta), prob = eta >= 0 ? 1 / (1 + Math.exp(-eta)) : Math.exp(eta) / (1 + Math.exp(eta));
    logp += model.y[i] * eta - (Math.max(0, eta) + Math.log1p(Math.exp(-Math.abs(eta))));
    for (let j = 0; j < beta.length; j++) { grad[j] += x[j] * (model.y[i] - prob); if (H) for (let k = 0; k < beta.length; k++) H[j][k] += x[j] * x[k] * prob * (1 - prob); }
  }
  return { logp, grad, H };
}
function logisticGeometry(model) {
  let beta = Array(model.X[0].length).fill(0), state = logisticState(model, beta, true);
  for (let i = 0; i < 60; i++) {
    const change = solve(state.H, state.grad); if (Math.max(...change.map(Math.abs)) < 1e-9) break;
    let scale = 1, proposed, candidate;
    do { proposed = beta.map((v, j) => v + scale * change[j]); candidate = logisticState(model, proposed, true); scale /= 2; } while (candidate.logp < state.logp && scale > 1e-10);
    beta = proposed; state = candidate;
  }
  return { beta, H: state.H, C: inverse(state.H) };
}
function valuesFor(model, beta, sigma) {
  if (model.type === 'compare') return [beta[0], beta[1], Math.exp(beta[0]), Math.exp(beta[0] + beta[1]), Math.exp(beta[1]), sigma];
  return [...beta, model.type === 'linear' ? Math.exp(beta[0]) : 1 / (1 + Math.exp(-beta[0])), ...beta.slice(1).map(Math.exp), ...(model.type === 'linear' ? [sigma] : [])];
}
export function validateSettings(settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  if (!Number.isInteger(s.warmup) || s.warmup < 0 || s.warmup > 50000) throw new Error('Warmup must be a whole number from 0 to 50,000.');
  if (!Number.isInteger(s.draws) || s.draws < 50 || s.draws > 50000) throw new Error('Retained draws per chain must be a whole number from 50 to 50,000.');
  if (!Number.isInteger(s.seed) || s.seed < 0 || s.seed > 4294967295) throw new Error('Seed must be a whole number from 0 to 4,294,967,295.');
  if (s.chains !== 4) throw new Error('This demonstration requires four independently seeded chains.');
  return s;
}
export async function runChains(model, settings = {}, onProgress = () => {}) {
  const requested = validateSettings(settings), s = { ...requested, warmup: model.type === 'logistic' ? requested.warmup : 0 }, chains = [], chainInfo = [], total = s.warmup + s.draws;
  const geometry = model.type === 'logistic' ? logisticGeometry(model) : null;
  const L = geometry ? cholesky(geometry.C) : model.posterior ? cholesky(model.posterior.covariance) : null;
  for (let c = 0; c < 4; c++) {
    const chainSeed = ((s.seed >>> 0) + Math.imul(c + 1, 0x9e3779b9)) >>> 0, rng = createRng(chainSeed), draws = [];
    const initialZ = geometry ? L.map(() => rng.normal()) : null;
    let beta = geometry ? geometry.beta.map((v, j) => v + 2 * dot(L[j], initialZ)) : null;
    let state = geometry ? logisticState(model, beta) : null, logStep = Math.log(1), accepted = 0;
    for (let i = 0; i < total; i++) {
      let draw;
      if (model.type === 'proportion') draw = model.groups.map(g => { const a = rng.gamma(g.alpha), b = rng.gamma(g.beta); return a / (a + b); });
      else if (model.posterior) {
        const sigma2 = model.posterior.b / rng.gamma(model.posterior.a), z = L.map(() => rng.normal());
        const b = model.posterior.mean.map((m, j) => m + Math.sqrt(sigma2) * dot(L[j], z)); draw = valuesFor(model, b, Math.sqrt(sigma2));
      } else {
        const step = Math.exp(logStep), step2 = step * step, drift = mv(geometry.C, state.grad), z = L.map(() => rng.normal());
        const proposal = beta.map((v, j) => v + .5 * step2 * drift[j] + step * dot(L[j], z));
        const next = logisticState(model, proposal), nextDrift = mv(geometry.C, next.grad);
        const forward = proposal.map((v, j) => v - beta[j] - .5 * step2 * drift[j]);
        const reverse = beta.map((v, j) => v - proposal[j] - .5 * step2 * nextDrift[j]);
        const logRatio = next.logp - state.logp + .5 / step2 * (quadratic(forward, geometry.H) - quadratic(reverse, geometry.H));
        const probability = Number.isFinite(logRatio) ? Math.exp(Math.min(0, logRatio)) : 0;
        if (rng.uniform() < probability) { beta = proposal; state = next; if (i >= s.warmup) accepted++; }
        if (i < s.warmup) logStep = Math.max(-5, Math.min(1.5, logStep + Math.min(.05, 1 / Math.sqrt(i + 10)) * (probability - .574)));
        draw = valuesFor(model, beta);
      }
      if (i >= s.warmup) draws.push(draw);
      if ((i + 1) % 100 === 0 || i + 1 === s.warmup || i + 1 === total) {
        onProgress({ chain: c + 1, chains: 4, phase: i < s.warmup ? 'warmup' : 'sampling', iteration: i < s.warmup ? i + 1 : i + 1 - s.warmup, phaseTotal: i < s.warmup ? s.warmup : s.draws, completed: c * total + i + 1, total: 4 * total });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    chains.push(draws); chainInfo.push({ seed: chainSeed, acceptance: geometry ? accepted / s.draws : 1, stepSize: geometry ? Math.exp(logStep) : null });
  }
  const summary = summarize(chains, model.parameters);
  const warnings = summary.filter(r => r.warning).map(r => `${r.label}: ${r.warning}`);
  return { version: 1, config: model.config, requestedSettings: requested, settings: s, n: model.n, observed: model.observed, scales: model.scales, prior: model.prior, sampler: model.sampler, parameters: model.parameters, chains, chainInfo, summary, warnings, interval: '95% equal-tailed credible interval (empirical 2.5th–97.5th percentiles)', diagnosticsMethod: 'Classical split R-hat; approximate initial-positive-pair autocorrelation ESS, not rank-normalized. Thresholds: R-hat ≤ 1.01 and ESS ≥ 400. Passing is not proof of convergence or model adequacy.' };
}
export function diagnostics(chains) {
  if (!Array.isArray(chains) || chains.length < 2 || chains.some(c => !Array.isArray(c) || c.length < 4 || c.some(v => !Number.isFinite(v)))) return { rhat: null, ess: null, warning: 'Diagnostics undefined: insufficient or nonfinite draws.' };
  const n = Math.floor(Math.min(...chains.map(c => c.length)) / 2), split = chains.flatMap(c => [c.slice(0, n), c.slice(c.length - n)]), m = split.length;
  const means = split.map(mean), variances = split.map((c, j) => c.reduce((s, v) => s + (v - means[j]) ** 2, 0) / (n - 1));
  if (variances.some(v => !(v > 0))) return { rhat: null, ess: null, warning: 'Frozen chain or undefined variance; do not interpret this fit.' };
  const W = mean(variances), grand = mean(means), B = n * means.reduce((s, x) => s + (x - grand) ** 2, 0) / (m - 1), varPlus = (n - 1) / n * W + B / n;
  const rhat = Math.max(1, Math.sqrt(varPlus / W));
  const rho = lag => { let cov = 0; for (let c = 0; c < m; c++) { let ac = 0; for (let j = 0; j < n - lag; j++) ac += (split[c][j] - means[c]) * (split[c][j + lag] - means[c]); cov += ac / n; } return 1 - (W - cov / m) / varPlus; };
  let sumPairs = 0, previous = Infinity;
  for (let lag = 1; lag < Math.min(n - 1, 2000); lag += 2) { const pair = rho(lag) + rho(lag + 1); if (pair <= 0) break; const monotone = Math.min(previous, pair); sumPairs += monotone; previous = monotone; }
  const ess = Math.min(m * n, m * n / Math.max(1, 1 + 2 * sumPairs));
  const warnings = []; if (!Number.isFinite(rhat) || !Number.isFinite(ess)) warnings.push('Diagnostics undefined'); if (rhat > 1.01) warnings.push('R-hat exceeds 1.01'); if (ess < 400) warnings.push('ESS below 400');
  return { rhat: Number.isFinite(rhat) ? rhat : null, ess: Number.isFinite(ess) ? ess : null, warning: warnings.join('; ') || null };
}
export function summarize(chains, parameters) {
  return parameters.map((p, j) => {
    const series = chains.map(chain => chain.map(draw => draw[j])), all = series.flat(), sorted = [...all].sort((a, b) => a - b), d = diagnostics(series);
    const avg = mean(all), sd = Math.sqrt(all.reduce((s, v) => s + (v - avg) ** 2, 0) / (all.length - 1));
    return { ...p, mean: p.undefinedMoments ? null : avg, median: quantile(sorted, .5), low: quantile(sorted, .025), high: quantile(sorted, .975), sd: p.undefinedMoments ? null : sd, ...d, mcse: p.undefinedMoments ? null : d.ess ? sd / Math.sqrt(d.ess) : null, probabilityAboveNull: p.null == null ? null : all.filter(v => v > p.null).length / all.length };
  });
}
