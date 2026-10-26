# IBM HR Analytics Employee Attrition & Performance

This is **fictional demonstration data created by IBM data scientists**, not a sample of actual IBM employees. One row represents one fictional employee. The Attrition flag has no documented observation window, so its proportion must not be described as an annual turnover rate.

- Original dataset: [Kaggle, uploaded by pavansubhasht](https://www.kaggle.com/datasets/pavansubhasht/ibm-hr-analytics-attrition-dataset)
- Download: `https://www.kaggle.com/api/v1/datasets/download/pavansubhasht/ibm-hr-analytics-attrition-dataset`
- Retrieved: 26 October 2026; Kaggle dataset version 1, last updated 31 March 2017.
- Original archive member: `WA_Fn-UseC_-HR-Employee-Attrition.csv`
- Bundled file: `ibm-hr-attrition.csv`, original bytes preserved.
- SHA-256: `a5c31e38bd7fafc9bc333884eb181b06b41b8e5e488e8f7ccb27199fb3be7659`
- 1,470 rows, 35 columns, 1,470 distinct EmployeeNumber values, 237 Attrition=Yes records, no missing cells.
- Departments: Research & Development 961, Sales 446, Human Resources 63.
- `ibm-hr-attrition.json` contains the same records with numeric strings parsed as numbers, for local browser loading. No values were imputed or fabricated.

Kaggle lists the license as **Database: Open Database, Contents: Database Contents**: [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/) and [Database Contents License 1.0](https://opendatacommons.org/licenses/dbcl/1-0/). These terms apply to the bundled data and its JSON representation; the site's code license does not replace them. Original source and attribution are retained here and in the interface.

MonthlyIncome is recorded in unspecified dataset currency units; the app must not label it USD. Satisfaction, education, job level, and similar integer codes are ordinal categories, not automatically continuous measurements. EmployeeCount, Over18, and StandardHours are constants and EmployeeNumber is an identifier, so they are not offered as explanatory variables.

This cross-sectional demonstration supports exploratory associations under the stated models. It does not identify intervention effects or provide a validated operational attrition prediction system.
