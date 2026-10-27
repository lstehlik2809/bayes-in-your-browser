/* Ordinal proportional-odds and hierarchical Gaussian model components. */
export const ORDINAL_OUTCOMES = ['JobSatisfaction', 'EnvironmentSatisfaction', 'WorkLifeBalance'];
export const ORDINAL_LABELS = { JobSatisfaction: ['Low', 'Medium', 'High', 'Very High'], EnvironmentSatisfaction: ['Low', 'Medium', 'High', 'Very High'], WorkLifeBalance: ['Bad', 'Good', 'Better', 'Best'] };
export const HIERARCHICAL_GROUPS = ['JobRole', 'Department'];
const parameter = (id, label, unit, extra = {}) => ({ id, label, unit, null: null, ...extra });
const sigmoid = x => x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
const softplus = x => Math.max(0, x) + Math.log1p(Math.exp(-Math.abs(x)));
const logOneMinusExp = negative => negative < -Math.LN2 ? Math.log1p(-Math.exp(negative)) : Math.log(-Math.expm1(negative));
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const zeros = n => Array.from({ length: n }, () => Array(n).fill(0));
function cholesky(A) {
  const L = zeros(A.length);
  for (let i = 0; i < A.length; i++) for (let j = 0; j <= i; j++) {
    let v = A[i][j]; for (let k = 0; k < j; k++) v -= L[i][k] * L[j][k];
    if (i === j && !(v > 0)) throw new Error('Matrix is not positive definite.');
    L[i][j] = i === j ? Math.sqrt(v) : v / L[j][j];
  }
  return L;
}
function solve(A, b) {
  const L = cholesky(A), y = [], x = Array(b.length);
  for (let i = 0; i < b.length; i++) { let v = b[i]; for (let j = 0; j < i; j++) v -= L[i][j] * y[j]; y[i] = v / L[i][i]; }
  for (let i = b.length - 1; i >= 0; i--) { let v = y[i]; for (let j = i + 1; j < b.length; j++) v -= L[j][i] * x[j]; x[i] = v / L[i][i]; }
  return x;
}
function inverse(A) {
  const columns = A.map((_, i) => solve(A, A.map((__, j) => +(i === j))));
  return A.map((_, i) => columns.map(col => col[i]));
}
export function buildOrdinal(selected, model, wide, X) {
  const outcome = model.config.outcome ?? 'JobSatisfaction';
  if (!ORDINAL_OUTCOMES.includes(outcome)) throw new Error('Choose a supported ordered outcome.');
  const y = selected.map(row => row[outcome]);
  if (y.some(v => !Number.isInteger(v) || v < 1 || v > 4)) throw new Error(`${outcome} must use ordered category codes 1, 2, 3 or 4.`);
  model.config.outcome = outcome;
  model.X = X;
  model.y = y;
  model.prior = { family: 'Independent Normal on first threshold, log gaps and slopes', mean: [-1.5, Math.log(1.5), Math.log(1.5), ...model.scales.map(() => 0)], sd: [wide ? 2.5 : 1.5, wide ? .9 : .5, wide ? .9 : .5, ...model.scales.map(() => wide ? 2.5 : 1)] };
  model.freeParameterIds = ['c1', 'log_gap_2', 'log_gap_3', ...model.scales.map(s => `beta_${s.field}`)];
  const labels = ORDINAL_LABELS[outcome];
  model.parameters = [parameter('c1', 'Threshold 1', 'cumulative logit', { transform: 'free[0]', family: 'threshold', cutoff: 1 }), parameter('log_gap_2', 'Log gap: threshold 2 − 1', 'log threshold gap', { transform: 'free[1]', family: 'log_gap' }), parameter('log_gap_3', 'Log gap: threshold 3 − 2', 'log threshold gap', { transform: 'free[2]', family: 'log_gap' }), ...model.scales.map((s, i) => parameter(`beta_${s.field}`, s.field, `log odds above a cutoff; ${s.change}`, { transform: `free[${i + 3}]`, null: 0, family: 'ordinal_slope' })), parameter('c2', 'Threshold 2', 'cumulative logit', { transform: 'free[0]+exp(free[1])', family: 'threshold', cutoff: 2 }), parameter('c3', 'Threshold 3', 'cumulative logit', { transform: 'free[0]+exp(free[1])+exp(free[2])', family: 'threshold', cutoff: 3 }), ...model.scales.map((s, i) => parameter(`multiplier_${s.field}`, `${s.field} odds ratio above a cutoff`, s.change, { transform: `exp(free[${i + 3}])`, null: 1, family: 'ratio' })), ...[1, 2, 3, 4].map(k => parameter(`p_category_${k}`, `${k} · ${labels[k - 1]} at reference profile`, 'probability', { transform: `Pr(Y=${k}|X=0)`, family: 'category_probability', category: k, categoryLabel: labels[k - 1] }))];
  model.observed = { employees: selected.length, outcome, categories: [1, 2, 3, 4].map(category => ({ category, label: labels[category - 1], n: y.filter(v => v === category).length })) };
  model.profile = { description: 'Included-row mean continuous predictors; OverTime = No when selected.', values: Object.fromEntries(model.scales.map(s => [s.field, s.binary ? 'No' : s.mean])), standardizedPredictors: model.scales.map(() => 0) };
  model.sampler = 'Preconditioned Metropolis-adjusted Langevin (MALA), ordered cumulative-logit';
  model.modelNotes = ['Proportional odds: each slope has the same effect on odds above every cutoff. Positive slopes favor higher categories; middle-category probabilities need not increase. This assumption is not tested by the sampler.', `${outcome}: ${labels.map((label, i) => `${i + 1} ${label}`).join('; ')}. Ordered categories, including absent ones, do not assume equal spacing.`, 'Reference-profile probabilities are not population averages or a posterior predictive check against all observed employees.'];
  return model;
}
/** Pure unnormalized log posterior and analytic gradient in free-vector order. */
export function ordinalLogDensity(model, free) {
  if (!Array.isArray(free) || free.length !== model.prior.mean.length) throw new Error('Ordinal free vector must contain c1, two log gaps and all selected slopes.');
  const invalid = () => ({ logp: -Infinity, grad: Array(free.length).fill(0) });
  if (free.some(v => !Number.isFinite(v))) return invalid();
  const gap2 = Math.exp(free[1]), gap3 = Math.exp(free[2]), c = [free[0], free[0] + gap2, free[0] + gap2 + gap3];
  if (!(c[1] > c[0] && c[2] > c[1]) || !Number.isFinite(c[2])) return invalid();
  const grad = free.map((v, j) => -(v - model.prior.mean[j]) / model.prior.sd[j] ** 2), dc = [0, 0, 0];
  let logp = -.5 * free.reduce((sum, v, j) => sum + ((v - model.prior.mean[j]) / model.prior.sd[j]) ** 2, 0);
  for (let i = 0; i < model.n; i++) {
    const x = model.X[i], eta = dot(x, free.slice(3)), y = model.y[i];
    let dEta;
    if (y === 1) { const upper = c[0] - eta, d = sigmoid(-upper); logp -= softplus(-upper); dc[0] += d; dEta = -d; }
    else if (y === 4) { const lower = c[2] - eta, d = sigmoid(lower); logp -= softplus(lower); dc[2] -= d; dEta = d; }
    else {
      const lowerIndex = y - 2, upperIndex = y - 1, lower = c[lowerIndex] - eta, upper = c[upperIndex] - eta, gap = c[upperIndex] - c[lowerIndex];
      logp += upper + logOneMinusExp(-gap) - softplus(upper) - softplus(lower);
      const dUpper = 1 / -Math.expm1(-gap) - sigmoid(upper), dLower = -1 / Math.expm1(gap) - sigmoid(lower);
      dc[upperIndex] += dUpper; dc[lowerIndex] += dLower; dEta = sigmoid(upper) + sigmoid(lower) - 1;
    }
    for (let j = 0; j < x.length; j++) grad[j + 3] += x[j] * dEta;
  }
  grad[0] += dc[0] + dc[1] + dc[2];
  grad[1] += gap2 * (dc[1] + dc[2]);
  grad[2] += gap3 * dc[2];
  return Number.isFinite(logp) && grad.every(Number.isFinite) ? { logp, grad } : invalid();
}
export function ordinalProbabilities(free, predictors = []) {
  const eta = dot(predictors, free.slice(3)), c = [free[0], free[0] + Math.exp(free[1]), free[0] + Math.exp(free[1]) + Math.exp(free[2])];
  // Evaluate middle probabilities without subtracting almost equal cumulative probabilities.
  const middle = (a, b) => Math.exp(b + logOneMinusExp(a - b) - softplus(b) - softplus(a));
  const probabilities = [sigmoid(c[0] - eta), middle(c[0] - eta, c[1] - eta), middle(c[1] - eta, c[2] - eta), sigmoid(eta - c[2])];
  const total = probabilities.reduce((s, p) => s + p, 0);
  return probabilities.map(p => p / total);
}
export function ordinalValues(model, free) {
  const c2 = free[0] + Math.exp(free[1]), c3 = c2 + Math.exp(free[2]);
  return [...free, c2, c3, ...free.slice(3).map(Math.exp), ...ordinalProbabilities(free, model.profile.standardizedPredictors)];
}
function ordinalHessian(model, point) {
  const n = point.length, H = zeros(n);
  for (let j = 0; j < n; j++) {
    const step = 1e-4 * (1 + Math.abs(point[j])), plus = [...point], minus = [...point]; plus[j] += step; minus[j] -= step;
    const gp = ordinalLogDensity(model, plus).grad, gm = ordinalLogDensity(model, minus).grad;
    for (let i = 0; i < n; i++) H[i][j] = -(gp[i] - gm[i]) / (2 * step);
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) H[i][j] = H[j][i] = .5 * (H[i][j] + H[j][i]);
  return H;
}
function regularize(H) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const ridge = attempt === 0 ? 0 : 1e-6 * 10 ** (attempt - 1), candidate = H.map((row, i) => row.map((v, j) => v + (i === j ? ridge : 0)));
    try { cholesky(candidate); return candidate; } catch { /* Increase a fixed metric ridge, never alter the target. */ }
  }
  throw new Error('Could not construct a stable ordinal sampling metric. Try fewer predictors.');
}
export function ordinalGeometry(model) {
  let beta = [...model.prior.mean], state = ordinalLogDensity(model, beta);
  for (let i = 0; i < 80; i++) {
    const H = regularize(ordinalHessian(model, beta)), change = solve(H, state.grad);
    if (Math.max(...change.map(Math.abs)) < 1e-8) break;
    let scale = 1, proposed, next;
    do { proposed = beta.map((v, j) => v + scale * change[j]); next = ordinalLogDensity(model, proposed); scale /= 2; } while (next.logp < state.logp && scale > 1e-10);
    if (next.logp < state.logp) break;
    beta = proposed; state = next;
  }
  const H = regularize(ordinalHessian(model, beta));
  return { beta, H, C: inverse(H) };
}
export function buildHierarchical(selected, model, wide) {
  const groupBy = model.config.groupBy ?? 'JobRole';
  if (!HIERARCHICAL_GROUPS.includes(groupBy)) throw new Error('Choose JobRole or Department for partial pooling.');
  const levels = [...new Set(selected.map(row => row[groupBy]))].sort();
  if (levels.some(v => typeof v !== 'string' || !v)) throw new Error('The grouping field contains missing or invalid values.');
  if (levels.length < 2) throw new Error('Hierarchical income needs at least two nonempty groups. Choose JobRole or a broader department scope.');
  model.config.groupBy = groupBy;
  model.groups = levels.map((level, index) => {
    const logs = selected.filter(row => row[groupBy] === level).map(row => {
      if (typeof row.MonthlyIncome !== 'number' || !(row.MonthlyIncome > 0) || !Number.isFinite(row.MonthlyIncome)) throw new Error('MonthlyIncome must be a positive finite number for every included employee.');
      return Math.log(row.MonthlyIncome);
    });
    const meanLog = logs.reduce((s, y) => s + y, 0) / logs.length;
    return { level, index, n: logs.length, meanLog, observedGeomean: Math.exp(meanLog), withinSS: logs.reduce((s, y) => s + (y - meanLog) ** 2, 0) };
  });
  model.prior = { family: 'Independent Normal and Inverse-Gamma', muMean: Math.log(5000), muSD: wide ? 4 : 2, sigmaShape: 2, sigmaScale: wide ? 4 : 1, tauShape: 2, tauScale: wide ? 1 : .25 };
  model.parameters = [parameter('mu', 'Typical-group log income baseline', 'log income units/month', { transform: 'mu', family: 'hierarchical_location' }), ...model.groups.map(g => parameter(`u_${g.index}`, `${g.level} deviation`, 'log income relative to typical group', { transform: `u[${g.index}]`, null: 0, family: 'group_deviation', group: g.level })), parameter('sigma', 'Within-group residual SD', 'log income units', { transform: 'sqrt(sigma2)', family: 'sigma' }), parameter('tau', 'Between-group SD', 'log income units', { transform: 'sqrt(tau2)', family: 'tau' }), ...model.groups.map(g => parameter(`location_${g.index}`, `${g.level} log geometric mean`, 'log income units/month', { transform: `mu+u[${g.index}]`, family: 'hierarchical_location', group: g.level })), ...model.groups.map(g => parameter(`geomean_${g.index}`, `${g.level} geometric mean`, 'income units/month', { transform: `exp(mu+u[${g.index}])`, family: 'hierarchical_income', group: g.level, observedGeomean: g.observedGeomean, n: g.n, medianOnly: true })), parameter('geomean_typical', 'Typical-group geometric income baseline', 'income units/month', { transform: 'exp(mu)', family: 'typical_income', medianOnly: true }), parameter('icc', 'Between-group share of log-income variance', 'share of modeled log-income variance', { transform: 'tau2/(tau2+sigma2)', family: 'icc' })];
  model.observed = { employees: selected.length, groupBy, groups: model.groups.map(g => ({ label: g.level, n: g.n, meanLog: g.meanLog, geometricMean: g.observedGeomean })) };
  model.sampler = 'Blocked Gibbs: joint baseline/group effects, then two variance conditionals';
  model.modelNotes = ['The baseline describes a typical group, not an employee-weighted company mean.', 'Groups share a Normal distribution of deviations; within-group log-income variance is common.', ...(levels.length < 5 ? [`Only ${levels.length} groups: between-group variance can be sensitive to its prior. Compare both prior settings.`] : []), 'Group differences describe associations in this dataset; they do not establish causes or pay equity.'];
  return model;
}
export function initialHierarchy(model, rng) {
  const p = model.prior;
  return { mu: p.muMean + p.muSD * rng.normal(), u: model.groups.map(() => 0), sigma2: p.sigmaScale / rng.gamma(p.sigmaShape), tau2: p.tauScale / rng.gamma(p.tauShape) };
}
export function hierarchySweep(model, state, rng) {
  const p = model.prior;
  let precision = 1 / p.muSD ** 2, rhs = p.muMean / p.muSD ** 2;
  for (const g of model.groups) { const weight = 1 / (state.tau2 + state.sigma2 / g.n); precision += weight; rhs += weight * g.meanLog; }
  const mu = rhs / precision + rng.normal() / Math.sqrt(precision);
  const u = model.groups.map(g => { const variance = 1 / (g.n / state.sigma2 + 1 / state.tau2); return variance * g.n * (g.meanLog - mu) / state.sigma2 + Math.sqrt(variance) * rng.normal(); });
  const residual = model.groups.reduce((s, g, j) => s + g.withinSS + g.n * (g.meanLog - mu - u[j]) ** 2, 0);
  const sigma2 = (p.sigmaScale + .5 * residual) / rng.gamma(p.sigmaShape + model.n / 2);
  const tau2 = (p.tauScale + .5 * u.reduce((s, v) => s + v * v, 0)) / rng.gamma(p.tauShape + model.groups.length / 2);
  const locations = u.map(v => mu + v);
  return { state: { mu, u, sigma2, tau2 }, draw: [mu, ...u, Math.sqrt(sigma2), Math.sqrt(tau2), ...locations, ...locations.map(Math.exp), Math.exp(mu), tau2 / (tau2 + sigma2)] };
}
