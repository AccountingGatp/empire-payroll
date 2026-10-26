# Empire Payroll &rarr; QBO Journal

A small web app that turns the weekly **Payentry Labor Distribution Report (PDF)** into a **QuickBooks Online journal entry**, following the Empire US Payroll SOP.

* **Runs entirely in the browser.** The PDF and Excel files are read locally. Nothing is uploaded, and the site's Content-Security-Policy blocks requests to other sites.
* **No build step.** It is static HTML + JavaScript. Deploy it as-is.
* **Rules are data.** Accounts, class names, special cases and assumptions live in `config.json` (editable in the app on the *Rules* tab).

## What you do each week

1. Log in to Payentry (the verification code comes from the authenticator app) and download the *Labor Distribution Report &ndash; PDF*.
2. Open the app, load the PDF, the current **Employee List** (`Employee name`, `Class`) and the **QBO class list**.
3. Optional: enter Jared / Yassine payments and any Deel lines (section 2).
4. Press **Build journal entry**, read the checks, then download the `.xlsx` or the QBO import `.csv`.
5. If employees are not on the Employee List, copy the email draft to Jonathan. Reply to Louise when done (draft included).

If any red check fails (debits &ne; credits, totals do not tie to the report, unknown class, unknown pay code) the downloads stay off.

## Run locally

```bash
npm ci
npm run vendor     # copies pdf.js and SheetJS into /vendor (already committed)
npm start          # http://localhost:5173
npm test
```

Needs Node 20+. `npm start` only serves the folder; there is no server code. If `npm ci` is slow, use `npm ci --omit=optional` (the optional packages are only native canvas helpers for pdf.js that this app does not need).

The vendored SheetJS is the npm build `xlsx@0.18.5`. It only reads the Excel files you load yourself in your own browser; update it from SheetJS's own site if you want a newer release.

## Deploy

**GitHub:** create a private repository and push this folder.

```bash
git init && git add . && git commit -m "Empire payroll journal"
git branch -M main
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

**Vercel:** *Add New &rarr; Project &rarr; import the repo.* Framework preset **Other**, no build command, output directory `.` (root). `vercel.json` adds the security headers.

Payroll tools should not be public. In Vercel go to *Settings &rarr; Deployment Protection* and enable **Vercel Authentication** (or Password Protection on paid plans) so only your team can open the URL. The app is also marked `noindex`.

## Rules and assumptions (change them in `config.json`)

| Topic | Default |
|---|---|
| Journal date | Check date of the report (`journal_date_mode`: `check_date` or `period_end`) |
| Deductions | Credit to 60100 (matches the finished 10/05 journal) |
| Employer tax | Follows the pay: contract labor &rarr; 50005, city manager &rarr; 67610.1, Admin &rarr; 67610 (SOP step 15) |
| Salary + regular on one page | Employer tax split by share of gross; rounding remainder on the last line (SOP step 16) |
| Employee not on the list | Classed by Payentry department (STAFF&rarr;Admin, Illinois&rarr;Chicago, SIA&rarr;SIA, ...), marked `[class unconfirmed]`, email draft to Jonathan. Set `unknown_class_mode` to `fallback` to use `fallback_class` instead |
| Credit lines | One *Net pay* and one *EE tax + employer taxes* line per employee, in the employee's class |
| Griffin Conaty regular pay | Contract labor 50005 (his class is Administrative for now) |
| Jared Wiseman | $500 NYC city manager, then $200 Charleston city manager (weeks from 21 Sep), remainder NYC contract labor; under $500 all contract labor; no payroll tax |
| Outside-Payentry credits | 21040 (`outside_payentry.credit_account`) &mdash; confirm with Jonathan |

Employee keys are `Last First` (for example `Garcia Steven`). Add people to `city_managers`, `class_overrides` or `officers` as the roster changes. Use `name_aliases` if a name differs between the report and the Employee List.

## Not covered yet

* Downloading the report from Payentry (needs the verification code from Palak's phone, so it stays manual).
* Posting to QBO through its API (the app produces a file to review and import).
* Deel payroll summaries: enter them as manual lines until the summary format is known.
* The monthly City Manager List: the *City manager* tab and sheet give the weekly numbers to add to it.

## Tests

`npm test` runs unit tests with made-up employees. To run a full check on real data, put the files in `tests/private/` (ignored by Git):

```
tests/private/report.pdf       tests/private/employee_list.xlsx
tests/private/class_list.xlsx  tests/private/reference_je.xls   (optional)
```

Never commit payroll files. `.gitignore` already excludes PDFs and spreadsheets.

## Layout

```
index.html  style.css  config.json  vercel.json
src/engine.js     parsing, rules, journal, checks (pure functions)
src/pdflines.js   rebuilds text lines from pdf.js output
src/app.js        browser UI
vendor/           pdf.js and SheetJS (pinned, no CDN)
tests/            node --test
```
