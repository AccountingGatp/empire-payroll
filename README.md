# Empire Payroll &rarr; QBO Journal

A small web app that turns the weekly **Payentry Labor Distribution Report (PDF)** into a **QuickBooks Online journal entry**, following the Empire US Payroll SOP.

* **Runs entirely in the browser.** The PDF and Excel files are read locally. Nothing is uploaded, and the site's Content-Security-Policy blocks requests to other sites.
* **No build step.** It is static HTML + JavaScript. Deploy it as-is.
* **Rules are data.** Accounts, class names, special cases and assumptions live in `config.json` (administrators can also edit them in the browser on `admin.html`).

## What you do each week

1. Log in to Payentry (the verification code comes from the authenticator app) and download the *Labor Distribution Report &ndash; PDF*.
2. Open the app and **drop all the files in at once**: the PDF, the current Employee List and the QuickBooks class list. The app works out which file is which. (A finished journal is not needed; if one is dropped it is ignored.)
3. Read the colored banner. Green means ready, amber means ready with something to look at, red means it cannot be used yet.
4. Download the Excel journal or the QuickBooks import CSV.
5. If employees are not on the Employee List, copy the email to Jonathan. Copy the reply to Louise when the payroll is recorded.

Payments made outside Payentry (Jared, Yassine, Deel) go in the optional box below the drop area.

If a serious check fails (debits &ne; credits, totals do not tie to the report, unknown class, unknown pay code) the downloads stay off.

**The SOP is in the app.** The *Payroll SOP* link (top right and footer) opens `sop.html`, the full Empire US Payroll SOP, version 23 Oct 2026, with the same step numbers as the Word file. Every check in the results shows the SOP step it comes from (also in the Excel *Checks* sheet). When the SOP changes, update `sop.html`, `SOP_VERSION` and the step map in `src/sop.js`, and `config.json` if a rule changed.

**Administrators:** the small link at the bottom of the page opens the rules (accounts, class names, special cases). Changes there are saved in that browser only; to change the rules for everyone, edit `config.json` and redeploy.

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

## Rules and assumptions (`config.json`)

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
admin.html        rules editor for administrators
src/engine.js     parsing, rules, journal, checks (pure functions)
src/detect.js     recognises which dropped file is which
src/sop.js        SOP version and the SOP step behind each check
sop.html          the Payroll SOP, readable in the app
src/pdflines.js   rebuilds text lines from pdf.js output
src/app.js        browser UI
src/config.js, src/admin.js   rules loading and the admin page
vendor/           pdf.js and SheetJS (pinned, no CDN)
tests/            node --test
```
