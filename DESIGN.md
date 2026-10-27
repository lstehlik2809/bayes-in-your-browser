# Design contract

## Reader and task

A People Analytics practitioner or curious non-programmer opens this educational site to ask a question about the fictional IBM workforce, choose an appropriate analysis, fit it locally, then inspect the estimate, uncertainty, and sampling diagnostics. Results can suggest further investigation; they are not intervention recommendations.

The reading journey is: introductory explanation → choose an analysis → choose relevant fields and scope → run and observe progress → inspect posterior and comparison → examine exact results and diagnostics → export if useful.

Primary viewport: ordinary desktop browser; also support narrow screens and enlarged text through reflow. Light mode is the initial default; a deliberate theme choice persists locally. No account, backend, tracking, remote model API, or runtime CDN dependency is needed.

## Measures and interpretation

| Measure | Definition and scope | Unit / interpretation |
| --- | --- | --- |
| Employees | Number of included employee rows after department and analysis-specific group selection | Count; no missing-data replacement |
| Observed attrition proportion | Count of Attrition=Yes divided by included rows | Percent; no annual time window is documented |
| Posterior attrition proportion | Draws for the Bernoulli probability under the stated prior and included data | Percent; parameter uncertainty, not a forecast of individual outcomes |
| Group income comparison | Gaussian model of log(MonthlyIncome) in the two chosen groups | Exponentiated group means are geometric means; their ratio is not an arithmetic mean difference |
| Income regression | Gaussian model of log(MonthlyIncome), conditional on the chosen predictors | Exponentiated slope is a multiplier for the stated predictor change; no currency is assumed |
| Attrition regression | Bernoulli model with a logistic link | Coefficients are conditional log odds, odds ratios are not risk ratios; any displayed probabilities must state the predictor profile |
| Ordinal satisfaction model | Proportional-odds cumulative-logit model of four ordered response categories | Odds of being above a cutoff and category probabilities at an explicit reference profile; no equal spacing assumption |
| Hierarchical income | Normal log-income model with a shared distribution of group deviations | Typical-group baseline, partially pooled group geometric incomes, within/between SDs and share of modeled log-income variance |
| Posterior interval | Empirical 2.5th and 97.5th quantiles of retained draws | 95% equal-tailed credible interval, conditional on model/prior/data |
| Direction probability | Fraction of retained draws above the stated null (0 for a difference/log coefficient, 1 for a ratio) | Model-conditional posterior probability, not a p-value |
| Sampling diagnostics | Chain agreement and effective information after warmup | Warnings limit interpretation; a passing check does not establish model adequacy |

The dataset is a fictional cross-sectional demonstration. Each row is one employee. No join or aggregation changes the observational unit. Employee IDs, constants, and ordinal codes are excluded from continuous predictor choices. Missing, invalid, or insufficient inputs must produce an explicit state rather than a numerical zero.

## Visual decisions

- Use posterior histograms for distribution shape and aligned dots with credible intervals for comparisons. Both are computed from actual retained draws. A density-only display would make exact between-group comparisons harder.
- Use a trace view to reveal movement of the separate chains. Its vertical axis describes the selected parameter; its horizontal axis is retained iteration.
- For ordinal models, show the four reference-profile category probabilities with intervals. Observed counts remain separate data context rather than a predictive check at that profile.
- For hierarchical income, place posterior group medians/intervals beside hollow diamonds marking unpooled observed geometric means, with group sizes. Use a shared income scale; distinguish the typical-group baseline from an employee-weighted company average. Explain few-group prior sensitivity.
- Use tables for precise lookup: parameter, estimate, interval and diagnostics, with human-readable units and consistent numerical precision. The full IBM record table is not part of the primary analysis view.
- Keep comparable estimates on a common axis. Bars start at zero; intervals may use a narrower, explicitly labeled domain. Reference values are 0 for additive coefficients and 1 for multiplicative comparisons.
- Visual metaphor: a lab notebook. Graph-paper grid on page chrome only (never behind charts), ink-blue (#2c4a9e light / #9fb5ff dark) for posterior estimates, highlighter yellow (#ffdd73) for the key reported numbers, red pencil (#a03d12 / #ffb38c) for warnings, cream paper (#f6f3ea) and navy ink text (#1d2340). Dark mode is "blueprint at night" (#11162a) and keeps the same meanings. Chain colors (blue, vermilion, green, violet) are categorical only and also differ by dash pattern. All text pairs meet WCAG AA 4.5:1 in both themes.
- Histograms darken bins whose centre falls inside the 95% credible interval; tails are lighter. Axes use round 1/2/5 × 10ᵏ tick values. Unordered hierarchical groups are sorted by pooled median; ordinal categories keep their natural order.
- Typography: Bricolage Grotesque for headings, Instrument Sans for body, tables and chart labels (tabular numerals), Caveat only for decorative annotations (the schematic prior → posterior sketch and the formula). Fonts are self-hosted latin subsets under the SIL Open Font License (`fonts/`), so there is no runtime font CDN.
- Motion is decorative and never passes through wrong values: the hero highlight and schematic curve draw in, sections fade in on scroll, fixed dataset counts count up, result histograms grow from the baseline, interval lines extend and traces wipe in. Interactive elements lift on hover. Everything is disabled under `prefers-reduced-motion`, and charts do not re-animate on resize.
- Prefer native semantic controls, visible focus, named SVG charts, accessible result text and tables. No essential information depends on hover or color.
- Use shared spacing, type and color tokens. Keep detailed mathematical material expandable so readers can complete the basic analysis without decoding sampler terminology.

## Interaction contract

Scope and model settings determine the entire result. Changing a result-affecting control, including the ordinal outcome or hierarchical grouping, invalidates the previous result. Results, explanatory text, charts, denominators, and exports must always refer to the same request. The worker's progress reports real iterations/sweeps. Cancel terminates the active fit; a cancelled or superseded fit cannot publish results. Warmup is visibly separate from retained sampling for the three MCMC models; exact conjugate draws need none.

Before fitting, show an explicit ready state. During fitting, preserve a responsive interface and expose cancellation. On errors, say what failed and provide a recovery path. Do not present placeholders or previous fits as current observations.

## Verification

Use independent analytic or numerical reference posteriors for numerical verification, real browser interactions for runtime behavior, and rendered inspection in light/dark and desktop/narrow layouts. Inspect labels, axes, interval meaning, consistency of exports and scope, keyboard focus and text reflow. These checks do not substitute for testing comprehension with representative human readers.
