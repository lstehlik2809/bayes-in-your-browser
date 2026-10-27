# Bayes in your browser

A small educational People Analytics lab, built with HTML, CSS and JavaScript. It fits six model types on the fictional IBM attrition dataset, samples posterior draws locally, and presents distributions, credible intervals, traces and numerical tables.

[Open the site](https://lstehlik2809.github.io/bayesian-people-analytics/) · [LinkedIn draft](LINKEDIN_POST.txt) · [Design and metric definitions](DESIGN.md) · [Data provenance and terms](data/SOURCE.md)

## Run locally

Use a recent Node.js release (tested with Node 24). There are no npm dependencies, build step, runtime CDNs, API keys or model-fitting backend. Fonts (Bricolage Grotesque, Instrument Sans, Caveat) are self-hosted latin subsets in `fonts/`, each under the SIL Open Font License 1.1 with its license file alongside.

```sh
npm run dev
```

Open `http://127.0.0.1:4173`. Optional server arguments: `npm run dev -- --host 127.0.0.1 --port 8080`. Serve the directory over HTTP; opening `index.html` as a `file:` URL will not provide normal browser module/worker access.

All six analyses run inside a module Web Worker. Controls, navigation, theme changes and cancellation remain on the main thread. The bundled dataset loads from this same static site; there are no analytics or remote inference requests.

## Analyses

| Analysis | Question and result | Sampling method |
| --- | --- | --- |
| Estimate a proportion | What fraction of included employees have Attrition=Yes, overall or separately by category? | Independent draws from each exact Beta posterior |
| Compare income groups | How do two groups' geometric mean monthly incomes compare? | Independent draws from the exact Normal–Inverse-Gamma posterior |
| Model income | How is log monthly income associated with 1–5 selected predictors? | Independent draws from the exact Normal–Inverse-Gamma posterior |
| Model attrition | How is Attrition=Yes associated with 1–5 selected predictors, conditional on the others? | Preconditioned Metropolis-adjusted Langevin sampling (MALA) |
| Ordinal regression | How are ordered satisfaction or work-life-balance categories associated with 1–5 selected predictors? | MALA for a proportional-odds cumulative-logit model |
| Hierarchical income | How do job roles or departments compare after partial pooling? | Blocked Gibbs sampling of a typical-group baseline, group effects and variance components |

These are selected model families inspired by Andrew Marritt's [Bayesian Thinking for People Analytics](https://bayesian-thinking.andrewmarritt.ch/), rather than a general-purpose facility for arbitrary model specifications. They use different data and an independent implementation. The book's examples use R, brms and Stan/HMC. Relevant chapters are [4](https://bayesian-thinking.andrewmarritt.ch/chapters/04-bayes-theorem.html), [5](https://bayesian-thinking.andrewmarritt.ch/chapters/05-posteriors-priors-credible-intervals.html), [6](https://bayesian-thinking.andrewmarritt.ch/chapters/06-bayesian-regression.html), [7](https://bayesian-thinking.andrewmarritt.ch/chapters/07-groups-and-categories.html), [9](https://bayesian-thinking.andrewmarritt.ch/chapters/09-logistic-regression.html) and [11](https://bayesian-thinking.andrewmarritt.ch/chapters/11-mcmc-under-the-hood.html).

The new analyses also connect to [multilevel models (8)](https://bayesian-thinking.andrewmarritt.ch/chapters/08-multilevel-models.html), [hierarchical pay and variance (16)](https://bayesian-thinking.andrewmarritt.ch/chapters/16-hierarchical-pay-variance.html) and [Likert and survey data (18)](https://bayesian-thinking.andrewmarritt.ch/chapters/18-likert-survey-analysis.html).

## Data and interpretation

The original Kaggle CSV has 1,470 fictional employee records, 35 columns and 237 Attrition=Yes records. The JSON used by the browser contains the same values, with numeric strings parsed as numbers. The CSV remains available to download. See [data/SOURCE.md](data/SOURCE.md) for the source, checksum, counts and separate data licenses.

Department selection defines the included rows. Income comparisons also retain only the selected two groups. There is no documented attrition observation window: proportions are not annual turnover rates. Income currency is unspecified, so figures use **income units/month**. No missing values are imputed.

Continuous predictors are centered and divided by their **sample** standard deviation (denominator n−1) among included employees. Their coefficients describe a one-SD change. The binary OverTime field uses No=0 and Yes=1 without centering, so its coefficient describes No→Yes. A reference profile uses the included means of continuous predictors and OverTime=No when included. This profile may not correspond to an actual employee.

Identifiers, constants and ordinal codes are excluded from continuous predictor choices. All results describe model-conditional associations. The app does not establish causal effects or provide an operationally validated attrition prediction model. Proper priors do not remedy an unsuitable likelihood, unmeasured variables or an unrepresentative sample.

## Mathematical specification

### Proportions

For each included group independently, y is the number of Attrition=Yes records among n employees. The likelihood is Binomial(n,p). The default prior is Beta(1,1); the alternative is Beta(½,½), which puts more mass near 0 and 1 and is not uniformly less informative. The exact posterior is Beta(y+α,n−y+β). Two independent Gamma variates produce each Beta draw. There is no pooling between groups.

### Gaussian income models

The outcome is natural-log MonthlyIncome. Conditional on β and σ², observations are independent Normal(Xβ,σ²). Both comparison groups share a residual variance. The comparison design uses an intercept for group A and an indicator for group B. Linear regression uses an intercept and the selected standardized numeric/binary predictors.

The Normal–Inverse-Gamma prior is:

- σ² ∼ InverseGamma(a₀=2,b₀), with density proportional to (σ²)^(−a₀−1) exp(−b₀/σ²).
- β | σ² ∼ Normal(m₀,σ²V₀).
- m₀ = (log(5000),0,…,0).
- Default: b₀=1 and diagonal V₀=(4,1,…,1).
- Alternative: b₀=4 and diagonal V₀=(16,4,…,4).

The intercept prior depends on the reference coding. Recoding comparison groups while reusing these priors is a slightly different prior specification; exact reciprocity of independent fitted summaries is not guaranteed.

Let Vₙ=(V₀⁻¹+XᵀX)⁻¹, mₙ=Vₙ(V₀⁻¹m₀+Xᵀy), aₙ=a₀+n/2 and bₙ=b₀+½[(y−Xmₙ)ᵀ(y−Xmₙ)+(mₙ−m₀)ᵀV₀⁻¹(mₙ−m₀)]. Each posterior draw samples σ² from InverseGamma(aₙ,bₙ), then β from Normal(mₙ,σ²Vₙ), retaining their dependence.

Exponentiated log-location draws describe geometric means. Exponentiated slopes describe multiplicative changes in geometric mean income. They are not arithmetic mean incomes. Displayed summaries use **posterior medians and equal-tailed intervals**. The Student-t coefficient marginals have no finite exponential moments, so natural-scale posterior means are not displayed. σ is the residual SD on the log-income scale.

### Logistic regression

yᵢ ∼ Bernoulli(logistic(xᵢᵀβ)), with independent proper Normal priors. The default intercept SD is 2.5 and each slope SD is 1; the alternative SDs are 5 and 2.5. All prior means are zero. No coefficients are fixed at their estimated mode.

MALA uses an analytic log-posterior and gradient. A Newton search finds a posterior mode to construct a **fixed** inverse-Hessian preconditioner C. From β it proposes Normal(β+ε²C∇logπ(β)/2, ε²C), then applies the full forward/reverse proposal-density Metropolis–Hastings correction. Each chain starts with its own seeded jitter. Its step size adapts toward acceptance 0.574 during warmup, then remains fixed during retained sampling. Warmup is discarded. This samples coefficients directly, so no transformed-density Jacobian is required.

Odds ratios exp(βⱼ) are conditional odds multipliers, not probability multipliers. The reference-profile probability is logistic(β₀). Its interpretation depends on the chosen predictor coding described above.

### Ordinal regression

Choose JobSatisfaction or EnvironmentSatisfaction (1 Low, 2 Medium, 3 High, 4 Very High) or WorkLifeBalance (1 Bad, 2 Good, 3 Better, 4 Best), using the [source codebook](data/SOURCE.md). The model keeps category positions 1–4 even if a selected scope contains no observations in a category. It does not assume equal distances between the response labels.

For k=1,2,3, P(Yᵢ≤k)=logistic(cₖ−xᵢᵀβ). There is no separate intercept, which would be redundant with the thresholds. Sampled free parameters are the first threshold c₁, two log gaps g₂ and g₃, and the slopes. The ordering is c₂=c₁+exp(g₂), c₃=c₂+exp(g₃).

Independent priors on those **free** parameters are:

| Parameter | Default | Alternative |
| --- | --- | --- |
| c₁ | Normal(−1.5, 1.5²) | Normal(−1.5, 2.5²) |
| Each log gap | Normal(log(1.5), 0.5²) | Normal(log(1.5), 0.9²) |
| Each slope | Normal(0, 1²) | Normal(0, 2.5²) |

Because these priors are defined directly on the sampled log gaps, the target density does not acquire an extra threshold-transformation Jacobian. The analytic log posterior/gradient uses stable category log probabilities. MALA uses a fixed, regularized inverse Hessian at the independently optimized mode; a numerical Hessian affects the proposal metric rather than the target. Its full forward/reverse proposal correction and warmup-only step adaptation follow the same principles as the binary model.

A positive slope increases the odds of being **above** each cutoff. Proportional odds assumes that this slope is the same at every cutoff; the sampler does not test that assumption. Middle-category probabilities need not increase with a predictor. Threshold c_k is logit P(Y ≤ k | X=0), and there is no separate intercept. Sampled log gaps enforce ordering and are not slope effects. The overview displays all four category probabilities and their intervals at the explicitly defined reference profile, with probabilities summing to one in each draw; the separate posterior medians need not sum to one. These are fitted probabilities at that profile, not population averages. Observed category counts describe the included data; they are not a posterior predictive check against that single profile.

### Hierarchical income and partial pooling

Select JobRole or Department as the grouping field; department scope applies first. At least two observed groups are required. On the natural-log income scale:

- yᵢg ∼ Normal(μ+u_g,σ²).
- u_g ∼ Normal(0,τ²).
- μ ∼ Normal(log(5000),s_μ²), with s_μ=2 by default or 4 for the alternative.
- σ² ∼ InverseGamma(2,b_σ), with b_σ=1 or 4.
- τ² ∼ InverseGamma(2,b_τ), with b_τ=0.25 or 1.

The three hyperpriors are independent. The model assumes exchangeable group deviations and a common within-group residual variance. μ describes a **typical-group baseline**, not an employee-weighted company average. Between-group variance is often sensitive to its prior when there are few groups; the interface states this explicitly.

The Gibbs sampler draws the joint (μ,u) block by first drawing μ conditional on σ²,τ² and the data with u integrated out. Its precision is s_μ⁻²+Σ_g(τ²+σ²/n_g)⁻¹ and its mean uses the corresponding prior/group-mean weights. Then each u_g is drawn conditional on that new μ and the variances. Its variance is (n_g/σ²+1/τ²)⁻¹ and mean is that variance times n_g(ȳ_g−μ)/σ². The residual variance update is InverseGamma(2+n/2,b_σ+Σᵢg(yᵢg−μ−u_g)²/2); the group variance update is InverseGamma(2+G/2,b_τ+Σ_g u_g²/2). These are genuine joint-posterior sweeps, with discarded warmup and no tuning adaptation.

The partial-pooling chart puts each group's posterior geometric-income median and intervals on the same scale as its observed unpooled geometric mean, with the group size shown. exp(μ+u_g) is also the modeled individual conditional median, not an arithmetic mean. Shrinkage toward the typical baseline depends on group size and both σ (within-group SD) and τ (between-group SD) on the log scale. This group-only random-intercept model has no employee covariate adjustment. Interval overlap and rank order do not directly provide posterior pairwise contrasts. Natural-income summaries use medians by presentation choice. This posterior is not NIG; the previous NIG exponential-moment caveat must not be applied indiscriminately here. In particular, the independent Normal prior on μ gives exp(μ) finite moments. The optional variance share/ICC is τ²/(τ²+σ²), describing modeled **log-income** variation rather than a causal contribution.

## Summaries and diagnostics

The default retains **4,000 draws per chain**. Four separate deterministic random streams are derived from the supplied unsigned 32-bit seed. Repeating the same rows, configuration and seed reproduces draws. Exact conjugate models require no MCMC warmup. Logistic, ordinal and hierarchical settings include discarded warmup and retained draws per chain. Progress messages describe actual iterations/sweeps; cancelling terminates the Worker. Changing any model-setting input invalidates results, and generation IDs prevent stale responses from replacing a new fit.

Charts and tables use the retained draws. The nested 50% and 95% equal-tailed intervals use empirical 25th–75th and 2.5th–97.5th percentiles, conditional on the model, data and priors. They describe parameters rather than the spread of employees or future individual outcomes. Horizontal charts show a thin 95% line, a thick 50% line and a distinct median dot. The engine keeps `low`/`high` for 95% and adds `low50`/`high50`; exported `intervals` metadata describes both levels while retaining the existing `interval` field. Displayed numeric results use two fixed decimal places without negative zero; counts, seeds and iterations remain integers. Calculations, draws and JSON summary numbers retain full precision. Directional probabilities count retained draws above the stated reference (0 for log coefficients; 1 for multipliers).

The diagnostics are **classical split R-hat** and an **approximate initial-positive-pair autocorrelation ESS**. They are not rank-normalized R-hat or a full suite of modern bulk/tail diagnostics. R-hat above 1.01, ESS below 400, frozen streams and undefined/nonfinite diagnostics trigger warnings. Thresholds are evaluated on unrounded values; a displayed R-hat of 1.01 can therefore still be flagged. Passing is not proof of convergence or model adequacy. No posterior predictive check or test of proportional odds, common residual variance or group exchangeability is implemented. Exact independent draws still receive these implementation checks. Finite runs have Monte Carlo uncertainty.

Results export as JSON with their actual configuration, settings, prior specification, observed counts, scaling, parameter definitions, summaries and warnings. The export states that raw draws are excluded; retained draws remain available through the pure engine API. No incomplete fit is exported.

## Verification

```sh
npm run check
npm test
```

`tests/data.test.mjs` checks the original checksum, CSV↔JSON correspondence and independently counted overall/subgroup totals. `tests/independent.test.mjs` compares sampled distributions with separately generated reference posteriors, using seeds 17, 101 and 2026. Each numerical fixture uses four streams with 8,000 retained draws per stream; logistic runs use 2,000 discarded warmup iterations per chain. Independent batch estimates assess Monte Carlo error for means, medians and interval endpoints. The suite also checks joint Gaussian coefficient covariance, natural-scale draw transformations, zero/all-event rate cases, input validation, deterministic streams and failing diagnostic fixtures.

The Gaussian references use independently expressed conjugate algebra and Student-t / Inverse-Gamma distributions. The logistic references use two-dimensional numerical quadrature, with 1,001- and 2,001-point grid refinement and a negligible-boundary-density check. The JavaScript engine's likelihood and diagnostics are not used to construct these oracles.

To regenerate the checked-in oracle fixtures, use a development Python installation with NumPy and SciPy:

```sh
python tests/make_references.py
```

Python is not needed to use the site or run the checked-in Node tests. Browser checks cover all analyses, exports, progress/cancellation, invalidation, keyboard interaction, light/dark themes and narrow layouts. Browser screenshots and run logs are local QA artifacts excluded from Git. Agent inspection is not a representative-user comprehension study.

`tests/advanced.test.mjs` adds independent ordinal and hierarchical checks, including five-predictor gradient tests against a separately coded target, absent response categories, singleton groups and covariance between group locations. `tests/make_advanced_references.py` generates its checked-in fixtures: ordinal references use full-support multivariate-t importance integration with four independently scrambled Sobol replicates at 2¹⁷ and 2¹⁸ points and proposal scales 1 and 1.5; hierarchical references integrate μ and u analytically before 401/801-point two-dimensional log-variance quadrature, with expanded-domain and boundary-mass checks. Per-functional uncertainty/refinement errors are retained, including for quantiles. None calls the JavaScript engine to construct its target or summaries.

`tests/report.test.mjs` checks known empirical interval endpoints, two-decimal presentation without negative zero, validation for one through five distinct supported predictors, and five-predictor linear/logistic/ordinal fits against independently generated positive and negative associations for every predictor. `scripts/check-browser.cjs` verifies the default through actual UI fits, rendered precision, full-precision exports, diagnostic warning classes, and nested interval geometry/accessibility in parameter and overview charts.

## GitHub Pages

The repository root is the static site. `.nojekyll` allows direct serving without a Jekyll build. Publish the `main` branch root through GitHub Pages; all application assets, Worker imports and data requests use relative paths that support a project subdirectory. Deployment verification should include completed hosted logistic, ordinal and hierarchical fits, not just an HTTP check of the landing page.

## Files and licenses

`engine.js` contains the model/sampler API, with ordinal and hierarchical components in `advanced.js`; `worker.js` runs it away from the UI; `app.js` owns interaction and chart rendering. `scripts/serve.mjs` is a local static server. `scripts/record-demo.mjs` (Playwright, like the browser check) and `scripts/encode-demo-gif.py` (Pillow and ffmpeg) produce the demo GIF in `media/`. The app's code is MIT licensed. The IBM data retains its [separate Open Data Commons terms](data/SOURCE.md).
