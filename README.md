# Bayes in your browser

A small educational People Analytics lab, built with HTML, CSS and JavaScript. It fits four model types on the fictional IBM attrition dataset, samples posterior draws locally, and presents distributions, credible intervals, traces and numerical tables.

[Open the site](https://lstehlik2809.github.io/bayesian-people-analytics/) · [LinkedIn draft](LINKEDIN_POST.txt) · [Design and metric definitions](DESIGN.md) · [Data provenance and terms](data/SOURCE.md)

## Run locally

Use a recent Node.js release (tested with Node 24). There are no npm dependencies, build step, runtime CDNs, API keys or model-fitting backend.

```sh
npm run dev
```

Open `http://127.0.0.1:4173`. Optional server arguments: `npm run dev -- --host 127.0.0.1 --port 8080`. Serve the directory over HTTP; opening `index.html` as a `file:` URL will not provide normal browser module/worker access.

All four analyses run inside a module Web Worker. Controls, navigation, theme changes and cancellation remain on the main thread. The bundled dataset loads from this same static site; there are no analytics or remote inference requests.

## Analyses

| Analysis | Question and result | Sampling method |
| --- | --- | --- |
| Estimate a proportion | What fraction of included employees have Attrition=Yes, overall or separately by category? | Independent draws from each exact Beta posterior |
| Compare income groups | How do two groups' geometric mean monthly incomes compare? | Independent draws from the exact Normal–Inverse-Gamma posterior |
| Model income | How is log monthly income associated with 1–3 selected predictors? | Independent draws from the exact Normal–Inverse-Gamma posterior |
| Model attrition | How is Attrition=Yes associated with 1–3 selected predictors, conditional on the others? | Preconditioned Metropolis-adjusted Langevin sampling (MALA) |

These are selected model families inspired by Andrew Marritt's [Bayesian Thinking for People Analytics](https://bayesian-thinking.andrewmarritt.ch/), rather than a general-purpose facility for arbitrary model specifications. They use different data and an independent implementation. The book's examples use R, brms and Stan/HMC. Relevant chapters are [4](https://bayesian-thinking.andrewmarritt.ch/chapters/04-bayes-theorem.html), [5](https://bayesian-thinking.andrewmarritt.ch/chapters/05-posteriors-priors-credible-intervals.html), [6](https://bayesian-thinking.andrewmarritt.ch/chapters/06-bayesian-regression.html), [7](https://bayesian-thinking.andrewmarritt.ch/chapters/07-groups-and-categories.html), [9](https://bayesian-thinking.andrewmarritt.ch/chapters/09-logistic-regression.html) and [11](https://bayesian-thinking.andrewmarritt.ch/chapters/11-mcmc-under-the-hood.html).

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

## Summaries and diagnostics

Four separate deterministic random streams are derived from the supplied unsigned 32-bit seed. Repeating the same rows, configuration and seed reproduces draws. Exact conjugate models require no MCMC warmup. Logistic settings include discarded warmup and retained draws per chain. Progress messages describe actual iterations; cancelling terminates the Worker. Changing any model-setting input invalidates results, and generation IDs prevent stale responses from replacing a new fit.

Charts and tables use the retained draws. Intervals are empirical 2.5th–97.5th percentiles, conditional on the model, data and priors. They describe parameters rather than the spread of employees or future individual outcomes. Directional probabilities count retained draws above the stated reference (0 for log coefficients; 1 for multipliers).

The diagnostics are **classical split R-hat** and an **approximate initial-positive-pair autocorrelation ESS**. They are not rank-normalized R-hat or a full suite of modern bulk/tail diagnostics. R-hat above 1.01, ESS below 400, frozen streams and undefined/nonfinite diagnostics trigger warnings. Passing is not proof of convergence or model adequacy. Exact independent draws still receive these implementation checks. Finite runs have Monte Carlo uncertainty.

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

## GitHub Pages

The repository root is the static site. `.nojekyll` allows direct serving without a Jekyll build. Publish the `main` branch root through GitHub Pages; all application assets, Worker imports and data requests use relative paths that support a project subdirectory. Deployment verification should include a completed hosted logistic fit, not just an HTTP check of the landing page.

## Files and licenses

`engine.js` contains the pure model/sampler API; `worker.js` runs it away from the UI; `app.js` owns interaction and chart rendering. `scripts/serve.mjs` is a local static server. The app's code is MIT licensed. The IBM data retains its [separate Open Data Commons terms](data/SOURCE.md).
