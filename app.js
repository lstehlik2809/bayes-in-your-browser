import { buildModel, validateSettings, GROUPS, HIERARCHICAL_GROUPS } from './engine.js';
const $ = id => document.getElementById(id);
const number = (x, digits = 4) => Number.isFinite(x) ? Number(x.toPrecision(digits)).toLocaleString('en', { maximumFractionDigits: 7 }) : '—';
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let rows = [], analysis = 'proportion', worker = null, generation = 0, result = null, activeConfig = null;
const copy = {
  proportion: ['How common is attrition?', 'Estimate a proportion for the included employees, or explore it separately by group.', 'Attrition proportions'],
  compare: ['How do two groups compare?', 'Compare monthly income in two groups, using a Gaussian model of log income and a shared residual variance.', 'Income group comparison'],
  linear: ['What is associated with income?', 'Model log monthly income with one to three predictors. Read the results as conditional associations.', 'Income regression'],
  logistic: ['What is associated with attrition?', 'Use Bayesian logistic regression to explore attrition associations with one to three predictors.', 'Attrition regression'],
  ordinal: ['What is associated with higher ratings?', 'Model an ordered four-category response without treating the category codes as equally spaced measurements.', 'Ordinal regression'],
  hierarchical: ['What changes when groups share information?', 'Estimate group geometric incomes with partial pooling: smaller groups can borrow information through a common distribution.', 'Hierarchical income']
};
const usesWarmup = type => ['logistic', 'ordinal', 'hierarchical'].includes(type);
function config() { return { type: analysis, department: $('department').value, groupBy: $('group-by').value, groupA: $('group-a').value, groupB: $('group-b').value, outcome: $('ordinal-outcome').value, predictors: [...document.querySelectorAll('input[name=predictor]:checked')].map(c => c.value), prior: $('prior').value }; }
function settings() { return { warmup: usesWarmup(analysis) ? Number($('warmup').value) : 0, draws: Number($('draws').value), seed: Number($('seed').value), chains: 4 }; }
function setState(state, title, message) { $('fit-state').dataset.state = state; $('state-title').textContent = title; $('state-message').textContent = message; $('fit-state').querySelector('.state-symbol').textContent = ({ loading: '○', ready: '○', sampling: '↻', completed: '✓', stale: '↺', error: '!', cancelled: '■' })[state] || '○'; }
function invalidate(reason = 'Your question changed. Sample again to see results for the current settings.') {
  const hadFit = Boolean(worker || result);
  generation++; if (worker) worker.terminate(); worker = null; result = null; activeConfig = null;
  $('results').hidden = true; $('progress-area').hidden = true; $('empty-guide').hidden = false; $('cancel-button').hidden = true; $('run-button').disabled = !rows.length; $('export-button').disabled = true;
  if (rows.length) setState(hadFit ? 'stale' : 'ready', hadFit ? 'Settings changed · previous fit cleared' : 'Ready when you are', hadFit ? reason : 'No posterior has been sampled yet. Choose your settings and run the analysis.');
}
function updateGroups(reset = false) {
  const groupSelect = $('group-by'), previous = groupSelect.value;
  const choices = analysis === 'hierarchical' ? HIERARCHICAL_GROUPS : analysis === 'proportion' ? ['Overall', ...GROUPS.filter(g => g !== 'Attrition')] : GROUPS;
  groupSelect.replaceChildren(...choices.map(value => new Option(value === 'OverTime' ? 'Overtime' : value === 'BusinessTravel' ? 'Business travel' : value, value)));
  groupSelect.value = choices.includes(previous) ? previous : analysis === 'hierarchical' ? 'JobRole' : analysis === 'compare' ? 'Gender' : 'Overall';
  if (reset && analysis === 'compare' && groupSelect.value === 'Department' && $('department').value !== 'All') groupSelect.value = 'Gender';
  const filtered = rows.filter(r => $('department').value === 'All' || r.Department === $('department').value), levels = [...new Set(filtered.map(r => r[groupSelect.value]))].filter(Boolean).sort();
  const oldA = $('group-a').value, oldB = $('group-b').value;
  for (const id of ['group-a', 'group-b']) $(id).replaceChildren(...levels.map(v => new Option(v, v)));
  $('group-a').value = levels.includes(oldA) ? oldA : levels[0] ?? '';
  $('group-b').value = levels.includes(oldB) ? oldB : levels[1] ?? levels[0] ?? '';
}
function refreshScope() {
  try { const model = buildModel(rows, config()); $('scope-note').textContent = model.observed.groups ? `${model.n.toLocaleString()} included employees · ${model.observed.groups.map(g => `${g.label}: ${g.n}${g.events != null ? ` (${g.events} Yes)` : ''}`).join(' · ')}` : `${model.n.toLocaleString()} included employees${model.observed.categories ? ` · observed categories ${model.observed.categories.map(c => `${c.category}: ${c.n}`).join(', ')}` : model.observed.events != null ? ` · ${model.observed.events} Attrition = Yes` : ''}`; }
  catch (error) { $('scope-note').textContent = error.message; }
}
function refreshExplanation() {
  const wide = $('prior').value === 'wide';
  let html;
  if (analysis === 'proportion') html = `<p>Each included outcome is Bernoulli with probability p. Each group gets its own independent prior.</p><p><strong>${wide ? 'Beta(0.5, 0.5)' : 'Beta(1, 1)'}</strong> prior. ${wide ? 'This puts more mass near 0 and 1 than a uniform prior; it is not uniformly less informative.' : 'This is uniform on the probability scale.'} The posterior is Beta(prior α + Yes, prior β + No).</p><p>We draw directly from that posterior in four independently seeded streams. Exact sampling needs no warmup. Grouping does not create a hierarchical model.</p>`;
  else if (analysis === 'logistic') html = `<p>Attritionᵢ ~ Bernoulli(logistic(β₀ + Xᵢβ)). Proper independent Normal priors: intercept β₀ ~ N(0, ${wide ? '5' : '2.5'}²); each slope β ~ N(0, ${wide ? '2.5' : '1'}²).</p><p>MALA proposals use a fixed inverse-Hessian preconditioner at the posterior mode, with a Metropolis–Hastings correction. Step size adapts only during discarded warmup. Retained draws never adapt.</p><p>An odds ratio is a multiplier of odds, not of probability or risk. The reference probability uses included-row mean continuous predictors and Overtime = No when selected. All-one-outcome data are supported by the proper prior.</p>`;
  else if (analysis === 'ordinal') html = `<p>Pr(Yᵢ ≤ k) = logistic(cₖ − Xᵢβ), k = 1, 2, 3. There is no separate intercept. Thresholds are ordered: c₂ = c₁ + exp(g₂), c₃ = c₂ + exp(g₃).</p><p>Independent priors: c₁ ~ N(−1.5, ${wide ? '2.5' : '1.5'}²), g₂ and g₃ ~ N(log(1.5), ${wide ? '.9' : '.5'}²), slopes β ~ N(0, ${wide ? '2.5' : '1'}²). Priors are directly on the sampled log gaps, so no additional change-of-variable Jacobian is needed.</p><p><strong>Positive slopes mean greater odds of being above any cutoff.</strong> The proportional-odds assumption gives each predictor one slope shared across the three cutoffs. Category codes 1–4 express order; equal spacing is not assumed, and absent categories are retained.</p><p>A fixed, regularized posterior-mode Hessian preconditions MALA proposals. Every proposal has the full forward/reverse Metropolis correction; step-size adaptation occurs only in discarded warmup.</p><p>Category probabilities use continuous predictors at their included-row means and Overtime = No. Their comparison with the overall observed counts is not a predictive check at that single profile.</p>`;
  else if (analysis === 'hierarchical') html = `<p>log(MonthlyIncomeᵢg) ~ Normal(μ + u_g, σ²); u_g ~ Normal(0, τ²). Groups share a common within-group residual variance.</p><p>Independent priors: μ ~ N(log(5000), ${wide ? '4' : '2'}²); σ² ~ Inverse-Gamma(shape 2, scale ${wide ? '4' : '1'}); τ² ~ Inverse-Gamma(shape 2, scale ${wide ? '1' : '.25'}). The inverse-gamma density for a variance v is proportional to v<sup>−3</sup> exp(−scale/v).</p><p>Each blocked-Gibbs sweep draws μ after marginalizing group effects given the variances, then draws u_g conditional on μ, followed by the two inverse-gamma variance conditionals. Warmup sweeps are discarded; this sampler needs no proposal tuning.</p><p><strong>μ describes a typical group</strong>, not an employee-weighted company mean. Natural group incomes are exp(μ + u_g), reported as posterior medians and intervals by presentation choice. This model has independent Normal/variance priors; its full posterior is not Normal–Inverse-Gamma.</p><p>With few groups, the between-group variance can depend strongly on its prior. Compare both prior settings. Differences do not establish causes or pay equity.</p>`;
  else html = `<p>log(MonthlyIncomeᵢ) ~ Normal(Xᵢβ, σ²). ${analysis === 'compare' ? 'X = [1, group B indicator]. The two groups share a common residual variance; β₀ is group A’s log geometric mean.' : 'The intercept is log geometric income at the reference profile: included-row mean continuous predictors and Overtime = No when selected.'}</p><p>Normal–Inverse-Gamma prior: σ² ~ Inverse-Gamma(shape 2, scale ${wide ? '4' : '1'}), with density proportional to (σ²)<sup>−3</sup> exp(−${wide ? '4' : '1'}/σ²). β | σ² ~ Normal(m₀, σ² V₀); m₀ = [log(5000), 0, …], V₀ = diag(${wide ? '16, 4, …' : '4, 1, …'}). These fixed priors do not use the observed income outcomes.</p><p>We draw σ² from its exact inverse-gamma posterior, then β conditional on that draw. No warmup is needed. Exponentiated log means are geometric means, not arithmetic means. We show their medians and quantiles: exponentiated coefficients under this prior have no finite posterior means.</p>`;
  html += '<p>The outcome distribution, conditional independence and model structure are assumptions. Neither diagnostics nor narrow intervals establish model adequacy or causation.</p><p><a href="https://bayesian-thinking.andrewmarritt.ch/chapters/' + (analysis === 'proportion' ? '05-posteriors-priors-credible-intervals.html' : analysis === 'logistic' ? '09-logistic-regression.html' : analysis === 'compare' ? '07-groups-and-categories.html' : analysis === 'ordinal' ? '18-likert-survey-analysis.html' : analysis === 'hierarchical' ? '08-multilevel-models.html' : '06-bayesian-regression.html') + '" target="_blank" rel="noreferrer">Read the related book chapter ↗</a></p>';
  $('model-explanation').innerHTML = html;
  $('warmup').disabled = !usesWarmup(analysis);
  $('sampler-help').textContent = analysis === 'hierarchical' ? 'Live blocked Gibbs: warmup sweeps are discarded; no proposal tuning. Only retained sweeps enter results.' : usesWarmup(analysis) ? 'Live MCMC: warmup tunes the step size and is discarded. Only retained draws enter results.' : 'Exact posterior draws: warmup is unnecessary and disabled. Every generated draw is retained.';
}
function selectAnalysis(type, focus = false) {
  if (type === analysis && rows.length) return;
  invalidate(); analysis = type;
  for (const tab of document.querySelectorAll('[role=tab]')) { const selected = tab.dataset.type === type; tab.setAttribute('aria-selected', selected); tab.tabIndex = selected ? 0 : -1; if (selected && focus) tab.focus(); }
  $('analysis-panel').setAttribute('aria-labelledby', `tab-${type}`);
  $('analysis-title').textContent = copy[type][0]; $('analysis-description').textContent = copy[type][1];
  $('group-controls').hidden = !['proportion', 'compare', 'hierarchical'].includes(type); $('group-pair').hidden = type !== 'compare'; $('predictor-controls').hidden = !['linear', 'logistic', 'ordinal'].includes(type); $('ordinal-controls').hidden = type !== 'ordinal';
  $('group-controls').querySelector('label').textContent = type === 'compare' ? 'Compare groups defined by' : type === 'hierarchical' ? 'Partially pool across' : 'Estimate separately by';
  updateGroups(true); refreshExplanation(); if (rows.length) refreshScope();
}
for (const tab of document.querySelectorAll('[role=tab]')) {
  tab.addEventListener('click', () => selectAnalysis(tab.dataset.type));
  tab.addEventListener('keydown', event => { const tabs = [...document.querySelectorAll('[role=tab]')], index = tabs.indexOf(tab); let target;
    if (event.key === 'ArrowRight') target = tabs[(index + 1) % tabs.length]; if (event.key === 'ArrowLeft') target = tabs[(index + tabs.length - 1) % tabs.length]; if (event.key === 'Home') target = tabs[0]; if (event.key === 'End') target = tabs.at(-1); if (target) { event.preventDefault(); selectAnalysis(target.dataset.type, true); }
  });
}
$('model-form').addEventListener('input', event => { invalidate(); if (['group-by', 'department'].includes(event.target.id)) updateGroups(); refreshScope(); if (event.target.id === 'prior') refreshExplanation(); });
$('cancel-button').addEventListener('click', () => { if (!worker) return; invalidate(); setState('cancelled', 'Sampling cancelled', 'No results from the cancelled run were retained. Change settings or sample again.'); });
$('model-form').addEventListener('submit', event => {
  event.preventDefault(); invalidate(); const requestConfig = config(); let requestSettings;
  try { if (['draws', 'seed'].some(id => $(id).value.trim() === '') || (usesWarmup(analysis) && $('warmup').value.trim() === '')) throw new Error('Enter a value for every active sampling setting.'); requestSettings = validateSettings(settings()); buildModel(rows, requestConfig); }
  catch (error) { setState('error', 'Check your selection', error.message); return; }
  const id = ++generation; activeConfig = requestConfig;
  $('empty-guide').hidden = true; $('progress-area').hidden = false; $('fit-progress').value = 0; $('progress-label').textContent = 'Starting four sampling streams'; $('progress-detail').textContent = 'Preparing the model on a separate browser thread.'; $('run-button').disabled = true; $('cancel-button').hidden = false;
  $('chain-progress').innerHTML = Array.from({ length: 4 }, (_, c) => `<div id="chain-${c + 1}"><strong>Chain ${c + 1}</strong><span>Waiting</span></div>`).join('');
  setState('sampling', 'Sampling in your browser', 'You can use the page while the worker runs. Cancel stops this fit immediately.');
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { if (data.id !== generation) return;
      if (data.type === 'started') $('progress-detail').textContent = `${data.sampler} · ${data.n.toLocaleString()} employees.`;
      if (data.type === 'progress') { const p = data.progress; $('fit-progress').value = p.completed / p.total * 100; $('progress-label').textContent = `Chain ${p.chain} of 4 · ${p.phase === 'warmup' ? 'discarded warmup' : 'retained sampling'} · ${p.iteration.toLocaleString()} / ${p.phaseTotal.toLocaleString()}`; for (let c = 1; c <= 4; c++) { const node = $(`chain-${c}`); node.classList.toggle('active', c === p.chain); node.querySelector('span').textContent = c < p.chain ? 'Complete' : c === p.chain ? `${p.phase}: ${p.iteration.toLocaleString()}` : 'Waiting'; } }
      if (data.type === 'error') finishError(data.message);
      if (data.type === 'result') { worker.terminate(); worker = null; result = data.result; $('progress-area').hidden = true; $('results').hidden = false; $('cancel-button').hidden = true; $('run-button').disabled = false; $('export-button').disabled = false; setState('completed', 'Posterior sampling complete', `${(4 * result.settings.draws).toLocaleString()} retained draws across four independently seeded streams. ${result.settings.warmup ? `${result.settings.warmup.toLocaleString()} warmup ${result.config.type === 'hierarchical' ? 'sweeps' : 'iterations'} per chain discarded.` : result.config.type === 'hierarchical' ? 'No warmup sweeps requested.' : usesWarmup(result.config.type) ? 'No warmup requested; MALA used its initial step size.' : 'Exact posterior sampling; no warmup needed.'}`); renderResult(); }
    };
    worker.onerror = error => { if (id === generation) finishError(error.message || 'The browser worker could not start. Serve this app over HTTP and try again.'); };
    worker.postMessage({ id, rows, config: requestConfig, settings: requestSettings });
  } catch (error) { finishError(error.message); }
});
function finishError(message) { generation++; if (worker) worker.terminate(); worker = null; result = null; activeConfig = null; $('progress-area').hidden = true; $('results').hidden = true; $('empty-guide').hidden = false; $('cancel-button').hidden = true; $('run-button').disabled = false; $('export-button').disabled = true; setState('error', 'The fit could not complete', `${message} Review the inputs and try again.`); }
function isPercent(p) { return p.unit === 'probability' || p.family === 'icc'; }
function axisLabel(p) { return p.family === 'icc' ? 'Between-group share (%)' : p.unit === 'probability' ? 'Probability (%)' : p.family === 'ratio' ? 'Multiplier' : p.unit.split(';')[0]; }
function formatted(value, p, digits = 4) { return isPercent(p) ? `${number(value * 100, digits)}%` : number(value, digits); }
function renderResult() {
  $('result-title').textContent = copy[result.config.type][2];
  $('result-context').textContent = `${result.config.department === 'All' ? 'All departments' : result.config.department} · ${result.n.toLocaleString()} included employees · ${result.config.prior} prior · seed ${result.settings.seed} · ${result.observed.groups ? result.observed.groups.map(g => `${g.label}: n = ${g.n}${g.events != null ? `, Yes = ${g.events}` : ''}`).join('; ') : `${result.scales.map(s => s.field).join(', ')}${result.observed.categories ? `; ${result.observed.outcome}; observed category counts ${result.observed.categories.map(c => `${c.category}: ${c.n}`).join(', ')}` : result.observed.events == null ? '' : `; ${result.observed.events} Attrition = Yes`}`}`;
  $('model-notes').hidden = !result.modelNotes?.length;
  $('model-notes').innerHTML = (result.modelNotes || []).map(note => `<p>${escape(note)}</p>`).join('');
  const banner = $('diagnostic-banner'); banner.classList.toggle('warning', Boolean(result.warnings.length));
  banner.textContent = result.warnings.length ? `Sampling warning · ${result.warnings.length} parameter(s) need attention. Treat estimates as provisional. ${result.warnings.join(' · ')}` : 'Sampling checks within thresholds · split R-hat ≤ 1.01 and approximate ESS ≥ 400 for all parameters. This does not establish model adequacy.';
  const selector = $('parameter-select'); selector.replaceChildren(...result.parameters.map(p => new Option(p.label, p.id)));
  selector.value = result.config.type === 'compare' ? 'ratio' : ['linear', 'logistic', 'ordinal'].includes(result.config.type) ? `multiplier_${result.scales[0].field}` : result.config.type === 'hierarchical' ? 'icc' : result.parameters[0].id;
  $('summary-body').innerHTML = result.summary.map(p => `<tr><th scope="row">${escape(p.label)}<small>${escape(p.family === 'icc' ? 'percent of modeled log-income variance' : p.unit === 'probability' ? 'percent' : p.unit)}${p.null == null ? '' : ` · reference ${p.null}`}</small></th><td>${formatted(p.median, p, 5)}</td><td>${formatted(p.low, p, 5)}</td><td>${formatted(p.high, p, 5)}</td><td>${p.probabilityAboveNull == null ? '—' : `${number(p.probabilityAboveNull * 100, 4)}%`}</td><td class="${p.rhat == null || p.rhat > 1.01 ? 'warn' : ''}">${p.rhat == null ? 'Undefined' : p.rhat.toFixed(4)}</td><td class="${p.ess == null || p.ess < 400 ? 'warn' : ''}">${p.ess == null ? 'Undefined' : Math.round(p.ess).toLocaleString()}</td></tr>`).join('');
  $('scaling-details').innerHTML = result.scales.length ? `<p><strong>Reference profile:</strong> continuous predictors at their included-row means; Overtime = No when selected. Slopes hold the other selected predictors fixed.</p>${result.scales.map(s => `<p>${escape(s.field)}: ${s.binary ? 'No = 0; Yes = 1.' : `mean ${number(s.mean, 6)}, sample SD ${number(s.sd, 6)}. A coefficient describes +1 SD.`}</p>`).join('')}` : '';
  $('results').dataset.motion = 'on'; renderOverview(); renderParameter();
}
$('parameter-select').addEventListener('change', () => { $('results').dataset.motion = 'on'; renderParameter(); });
function renderParameter() {
  if (!result) return; const index = result.parameters.findIndex(p => p.id === $('parameter-select').value), p = result.summary[index], vals = result.chains.flatMap(c => c.map(d => d[index]));
  let interpretation = `<p><strong>${formatted(p.median, p)}</strong> posterior median for ${escape(p.label.toLowerCase())}.</p><p>The 95% equal-tailed credible interval is <strong>${formatted(p.low, p)}–${formatted(p.high, p)}</strong>${isPercent(p) ? '' : ` ${escape(p.unit)}`}, conditional on this model, prior and included data.</p>`;
  if (p.probabilityAboveNull != null) interpretation += `<p>${number(100 * p.probabilityAboveNull, 4)}% of retained draws are above ${p.null}${p.null === 1 ? ', the no-change reference for a multiplier' : p.family === 'group_deviation' ? ', zero log-income deviation from the typical-group baseline' : ', the no-change reference for this slope'}. This is not a p-value or a causal effect.</p>`;
  if (result.config.type === 'ordinal' && ['ratio', 'ordinal_slope'].includes(p.family)) interpretation += '<p>A positive slope, or an odds ratio above 1, means greater conditional odds of being above each cutoff. It is not a multiplier of category probabilities.</p>';
  if (p.id === 'icc') interpretation += '<p>This is the modeled share of log-income variance between groups: τ² / (τ² + σ²). It describes variation under this model, not causes of income differences.</p>';
  if (result.warnings.length) interpretation += '<p><strong>Sampling warning:</strong> inspect the diagnostics before interpreting this estimate.</p>';
  $('interpretation').innerHTML = interpretation;
  histogram(vals, p); intervals(p); trace(result.chains.map(c => c.map(d => d[index])), p);
}
const svg = (w, h, title, content) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(title)}"><title>${escape(title)}</title>${content}</svg>`;
const tickFormat = (v, p) => isPercent(p) ? `${number(100 * v, 3)}%` : number(v, 3);
function renderOverview() {
  const type = result.config.type, ordinal = type === 'ordinal', hierarchy = type === 'hierarchical';
  $('model-overview').hidden = !ordinal && !hierarchy;
  if (!ordinal && !hierarchy) return;
  const shown = result.summary.filter(p => p.family === (ordinal ? 'category_probability' : 'hierarchical_income'));
  if (hierarchy) shown.sort((a, b) => b.median - a.median); // Groups are unordered, so rank by pooled median; ordinal categories keep their natural order.
  const w = Math.max(270, $('overview-chart').clientWidth), h = shown.length * 58 + 66, left = 28, right = w - 25, bottom = h - 47;
  const [lo, hi] = ordinal ? [0, 1] : domain(shown.flatMap(p => [p.low, p.high, p.observedGeomean]));
  const x = value => left + (value - lo) / (hi - lo) * (right - left);
  let content = '';
  for (const [i, p] of shown.entries()) {
    const y = 40 + i * 58, label = ordinal ? `Category ${p.category}` : `${p.group} · n = ${p.n}`, maxChars = Math.floor((right - left) / 6);
    content += `<text x="${left}" y="${y - 15}" class="chart-label">${escape(label.length > maxChars ? label.slice(0, maxChars - 1) + '…' : label)}</text><line x1="${x(p.low)}" x2="${x(p.high)}" y1="${y}" y2="${y}" class="chart-range"/><line x1="${x(p.low)}" x2="${x(p.low)}" y1="${y - 4}" y2="${y + 4}" class="chart-range"/><line x1="${x(p.high)}" x2="${x(p.high)}" y1="${y - 4}" y2="${y + 4}" class="chart-range"/>`;
    if (hierarchy) { const ox = x(p.observedGeomean); content += `<path d="M${ox},${y - 7} l7,7 l-7,7 l-7,-7 Z" class="chart-unpooled"/>`; }
    content += `<circle cx="${x(p.median)}" cy="${y}" r="4" class="chart-dot"/>`;
  }
  content += xAxis(lo, hi, left, right, bottom, shown[0]) + `<text x="${(left + right) / 2}" y="${h - 4}" text-anchor="middle" class="chart-label">${ordinal ? 'Reference-profile category probability (%)' : 'Geometric income · income units/month'}</text>`;
  $('overview-title').textContent = ordinal ? 'Which categories are plausible at the reference profile?' : 'Group income, with and without partial pooling';
  $('overview-chart').innerHTML = svg(w, h, `${ordinal ? 'Reference-profile category probabilities' : 'Group geometric income on a shared scale'}: ${shown.map(p => `${ordinal ? `category ${p.category}` : p.group}: posterior median ${formatted(p.median, p)}; 95% interval ${formatted(p.low, p)} to ${formatted(p.high, p)}${hierarchy ? `; observed geometric mean ${number(p.observedGeomean)}; n ${p.n}` : ''}`).join('; ')}`, content);
  $('overview-note').textContent = ordinal ? 'Dots: posterior medians; lines: 95% equal-tailed credible intervals. Profile: included-row continuous means and Overtime = No when selected. Every posterior probability vector sums to 100%; separate medians need not. Observed counts below describe all included rows, not just this profile, and are not a predictive check.' : 'Groups are sorted by pooled posterior median. Solid dots and lines: pooled posterior medians and 95% credible intervals. Hollow diamonds: observed, unpooled group geometric means. All marks share one income scale. The typical-group baseline is not an employee-weighted company mean. These are descriptive model estimates, not causal or pay-equity conclusions.';
  $('overview-table').innerHTML = ordinal ? `<table><caption>Reference-profile estimates and separate observed data context</caption><thead><tr><th scope="col">Ordered category</th><th scope="col">Observed count</th><th scope="col">Profile median</th><th scope="col">95% interval</th></tr></thead><tbody>${shown.map(p => `<tr><th scope="row">${p.category}</th><td>${result.observed.categories.find(c => c.category === p.category).n}</td><td>${formatted(p.median, p, 5)}</td><td>${formatted(p.low, p, 5)}–${formatted(p.high, p, 5)}</td></tr>`).join('')}</tbody></table>` : `<table><caption>Income units/month · observed geometric means and pooled posterior summaries</caption><thead><tr><th scope="col">Group</th><th scope="col">Employees</th><th scope="col">Observed</th><th scope="col">Pooled median</th><th scope="col">95% interval</th></tr></thead><tbody>${shown.map(p => `<tr><th scope="row">${escape(p.group)}</th><td>${p.n}</td><td>${number(p.observedGeomean, 6)}</td><td>${formatted(p.median, p, 6)}</td><td>${formatted(p.low, p, 6)}–${formatted(p.high, p, 6)}</td></tr>`).join('')}</tbody></table>`;
}
function domain(values, extra = []) { let lo = Infinity, hi = -Infinity; for (const v of [...values, ...extra]) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } if (lo === Infinity) return [0, 1]; const span = hi - lo || Math.abs(lo) * .1 || 1; return [lo - span * .06, hi + span * .06]; }
// Round tick values (1, 2 or 5 × 10^k) inside the data domain, so axes read as numbers rather than arbitrary fractions.
function niceTicks(lo, hi, target) { const raw = (hi - lo) / Math.max(target, 1), power = 10 ** Math.floor(Math.log10(raw)), f = raw / power, step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * power, ticks = []; for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Number((Math.round(v / step) * step).toPrecision(12))); return ticks; }
function xAxis(lo, hi, left, right, y, p) { const scale = v => left + (v - lo) / (hi - lo) * (right - left); return niceTicks(lo, hi, Math.max(4, Math.min(6, Math.floor((right - left) / 70)))).map(v => `<line x1="${scale(v)}" x2="${scale(v)}" y1="${y}" y2="${y + 4}" class="chart-gridline"/><text x="${scale(v)}" y="${y + 19}" text-anchor="middle" class="chart-axis">${tickFormat(v, p)}</text>`).join(''); }
function histogram(values, p) {
  const w = Math.max(270, $('histogram').clientWidth), h = 265, left = 42, right = w - 16, bottom = 212, top = 20, bins = Array(32).fill(0), [lo, hi] = domain(values), x = v => left + (v - lo) / (hi - lo) * (right - left);
  values.forEach(v => { if (Number.isFinite(v)) bins[Math.min(31, Math.max(0, Math.floor((v - lo) / (hi - lo) * 32)))]++; });
  const max = Math.max(...bins, 1), y = v => bottom - v / max * (bottom - top), bw = (right - left) / bins.length;
  let content = [0, .5, 1].map(f => `<line x1="${left}" x2="${right}" y1="${y(max * f)}" y2="${y(max * f)}" class="chart-gridline"/><text x="${left - 6}" y="${y(max * f) + 4}" text-anchor="end" class="chart-axis">${Math.round(max * f)}</text>`).join('');
  content += bins.map((n, i) => { const centre = lo + (i + .5) / bins.length * (hi - lo); return `<rect x="${left + i * bw + .5}" y="${y(n)}" width="${bw - 1}" height="${bottom - y(n)}" class="chart-bar${centre < p.low || centre > p.high ? ' chart-bar-tail' : ''}" style="--i:${i}"/>`; }).join('');
  content += `<line x1="${x(p.median)}" x2="${x(p.median)}" y1="${top}" y2="${bottom}" class="chart-median"/>` + xAxis(lo, hi, left, right, bottom, p) + `<text x="${left}" y="11" class="chart-axis">Retained draws / bin</text><text x="${(left + right) / 2}" y="254" class="chart-label" text-anchor="middle">${escape(axisLabel(p))}</text>`;
  $('histogram').innerHTML = svg(w, h, `${p.label}: histogram of ${values.length} retained draws. Median ${formatted(p.median, p)}, 95% interval ${formatted(p.low, p)} to ${formatted(p.high, p)}.`, content);
}
function intervals(p) {
  const family = p.family || (p.unit === 'probability' ? 'probability' : p.unit.split(';')[0]);
  let shown = result.summary.filter(s => (s.family || (s.unit === 'probability' ? 'probability' : s.unit.split(';')[0])) === family); if (!shown.length) shown = [p];
  const w = Math.max(270, $('interval-chart').clientWidth), h = Math.max(210, shown.length * 55 + 65), left = 24, right = w - 22, bottom = h - 45, [lo, hi] = domain(shown.flatMap(s => [s.low, s.high]), p.null == null ? [] : [p.null]), x = v => left + (v - lo) / (hi - lo) * (right - left);
  let content = '';
  if (p.null != null) content += `<line x1="${x(p.null)}" x2="${x(p.null)}" y1="10" y2="${bottom}" class="chart-reference"/>`;
  content += shown.map((s, i) => { const y = 38 + i * 55, maxChars = Math.floor((right - left) / 6); return `<text x="${left}" y="${y - 13}" class="chart-label">${escape(s.label.length > maxChars ? s.label.slice(0, maxChars - 1) + '…' : s.label)}</text><line x1="${x(s.low)}" x2="${x(s.high)}" y1="${y}" y2="${y}" class="chart-range"/><line x1="${x(s.low)}" x2="${x(s.low)}" y1="${y - 4}" y2="${y + 4}" class="chart-range"/><line x1="${x(s.high)}" x2="${x(s.high)}" y1="${y - 4}" y2="${y + 4}" class="chart-range"/><circle cx="${x(s.median)}" cy="${y}" r="4" class="chart-dot"/>`; }).join('');
  content += xAxis(lo, hi, left, right, bottom, p) + `<text x="${(left + right) / 2}" y="${h - 4}" text-anchor="middle" class="chart-label">${escape(axisLabel(p))}</text>`;
  $('interval-chart').innerHTML = svg(w, h, `Shared-scale median and 95% credible intervals: ${shown.map(s => `${s.label}: ${formatted(s.median, s)} (${formatted(s.low, s)} to ${formatted(s.high, s)})`).join('; ')}`, content);
  $('interval-note').textContent = `Dots: posterior medians. Lines: empirical 2.5th–97.5th percentiles.${p.null == null ? '' : ` Dashed reference: ${p.null}.`} Same-unit parameters share this axis.`;
}
function trace(chains, p) {
  const w = Math.max(270, $('trace-chart').clientWidth), h = 240, left = 54, right = w - 18, top = 39, bottom = 187, [lo, hi] = domain(chains.flat()), n = chains[0].length, x = i => left + i / Math.max(n - 1, 1) * (right - left), y = v => bottom - (v - lo) / (hi - lo) * (bottom - top);
  let content = niceTicks(lo, hi, 3).map(v => { return `<line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" class="chart-gridline"/><text x="${left - 8}" y="${y(v) + 4}" text-anchor="end" class="chart-axis">${tickFormat(v, p)}</text>`; }).join('');
  const dashes = ['', '7 3', '2 3', '9 3 2 3'];
  content += `<g class="trace-lines">${chains.map((c, k) => { const stride = Math.max(1, Math.floor(c.length / 650)), points = c.map((v, i) => i % stride === 0 || i === c.length - 1 ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : null).filter(Boolean).join(' '); return `<polyline points="${points}" fill="none" stroke="var(--chain${k + 1})" stroke-width="1" stroke-dasharray="${dashes[k]}" opacity=".75"/>`; }).join('')}</g>`;
  content += [0, .25, .5, .75, 1].map(f => `<text x="${x(f * (n - 1))}" y="${bottom + 20}" text-anchor="middle" class="chart-axis">${Math.round(1 + f * (n - 1)).toLocaleString()}</text>`).join('');
  content += `<text x="0" y="12" class="chart-axis">${escape(p.label.length > Math.floor(w / 6) ? p.label.slice(0, Math.floor(w / 6) - 1) + '…' : p.label)}</text><text x="0" y="27" class="chart-axis">${escape(p.family === 'icc' ? '% of modeled log-income variance' : p.unit === 'probability' ? '%' : p.unit.split(';')[0])}</text><text x="${(left + right) / 2}" y="232" class="chart-label" text-anchor="middle">Retained iteration within each chain</text>`;
  $('trace-chart').innerHTML = svg(w, h, `${p.label}: trace of four labeled chains. ${n} retained iterations per chain, no warmup displayed.`, content);
}
$('export-button').addEventListener('click', () => {
  if (!result || worker || !activeConfig) return;
  const { chains, ...numerical } = result;
  const output = { title: 'Bayes in your browser', exportedAt: new Date().toISOString(), source: { dataset: 'IBM HR Analytics Employee Attrition & Performance', fictional: true, url: 'https://www.kaggle.com/datasets/pavansubhasht/ibm-hr-analytics-attrition-dataset', totalBundledRows: rows.length, timeWindow: 'No documented attrition observation window', incomeUnits: 'unspecified income units/month', license: 'Open Database License 1.0 and Database Contents License 1.0' }, caveats: ['Educational cross-sectional demonstration; associations do not establish causation.', 'Parameter intervals, not individual prediction intervals.', ...(['compare', 'linear'].includes(result.config.type) ? ['Income natural-scale summaries use medians; exponentiated NIG coefficients have undefined posterior means.'] : result.config.type === 'hierarchical' ? ['Natural income summaries use medians by presentation choice. The independent-prior hierarchical posterior is not Normal–Inverse-Gamma.'] : []), 'Diagnostics do not establish convergence or model adequacy.', ...(result.modelNotes || [])], rawDrawsIncluded: false, ...numerical };
  const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `bayes-${result.config.type}-seed-${result.settings.seed}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (result) { $('results').dataset.motion = 'off'; renderOverview(); renderParameter(); } }, 100); });
function applyTheme(theme) { document.documentElement.dataset.theme = theme; $('theme-toggle').setAttribute('aria-pressed', theme === 'dark'); $('theme-toggle').textContent = theme === 'dark' ? 'Light mode' : 'Dark mode'; }
try { applyTheme(localStorage.getItem('bayes-theme') === 'dark' ? 'dark' : 'light'); } catch { applyTheme('light'); }
$('theme-toggle').addEventListener('click', () => { const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(theme); try { localStorage.setItem('bayes-theme', theme); } catch { /* Private storage must not prevent analysis. */ } });
refreshExplanation();
try {
  const response = await fetch(new URL('./data/ibm-hr-attrition.json', import.meta.url)); if (!response.ok) throw new Error(`Data request returned HTTP ${response.status}.`); rows = await response.json(); if (!Array.isArray(rows) || !rows.length) throw new Error('The bundled dataset is empty.');
  const events = rows.filter(r => r.Attrition === 'Yes').length; $('dataset-badge').textContent = `${rows.length.toLocaleString()} fictional employees · ${events} attrition records`; updateGroups(); refreshScope(); invalidate();
} catch (error) { $('dataset-badge').textContent = 'Dataset unavailable'; setState('error', 'The data could not load', `${error.message} Serve the app over HTTP and reload to retry.`); $('empty-guide').hidden = true; }
