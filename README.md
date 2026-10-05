# Survey Studio

A survey builder for research data collection: as quick as Google Forms to build with, with the parts of Qualtrics that studies actually need. Logic, randomized conditions, piping, panel IDs, clean exports with a codebook.

It is a static web app. Run it on your laptop, host it free on GitHub Pages, and keep responses either in the browser (zero setup) or in your own free Supabase database (to collect from anyone with a link).

## What it does

**Building**
- 15 question types: multiple choice, checkboxes, dropdown, rank order, rating scale (numbered bubbles or stars), matrix / Likert table, slider, Net Promoter Score, short text, paragraph, number, date, consent, constant sum, and text blocks for instructions or vignettes
- Blocks and pages: all questions of a block on one page, or one per page
- Likert presets in English and German (agreement, frequency, satisfaction, importance, likelihood, quality)
- Option lists you can paste into: paste ten lines, get ten options. Enter adds a row, Backspace on an empty row removes it
- Every option has an export code, every question a variable name, so the data file is analysis-ready
- Undo / redo, autosave, duplicate questions and blocks, drag to reorder
- A survey checker that catches broken logic, duplicate variable names and other problems before you publish

**Logic and randomization**
- Display logic on questions and blocks (all / any conditions, on answers, URL parameters or assigned conditions)
- Skip logic after each block: jump forward or end the survey with a status like `screened_out`, an optional message and an optional redirect
- Consent questions that end the survey when declined (status `declined_consent`)
- Randomizers: show 1 of N blocks (between-subjects conditions) or several in random order, optionally balanced so groups stay even
- Shuffle option order (keeping "Other" and "None of these" last), statement order and question order
- Piping: `{{age}}`, `{{condition}}`, `{{PROLIFIC_PID}}`, `{{response_id}}` in question text, messages and redirect links

**Collecting**
- Publishing takes a snapshot: you can keep editing a live survey, respondents only see changes when you publish again
- URL parameters (Prolific, MTurk/CloudResearch, panel IDs) stored with each response, optionally required
- Redirect after completion, for example to your Prolific completion link
- Open/close, response limit, automatic close date, one response per browser, resume unfinished answers
- Respondent pages in English or German, mobile-friendly, built for keyboard and screen-reader use
- Preview at desktop or phone width; test responses are kept separately and flagged

**Results**
- Per-question summaries: counts and percentages, mean / median / SD, NPS, matrix heat tables, average rank
- Response table and single-response view
- CSV with numeric codes or labels, plus a CSV variant for Excel with German settings (semicolon, decimal comma)
- Codebook (CSV and Markdown), SPSS label syntax, raw JSON, survey definition as JSON
- Time per block for spotting speeders

## Quick start

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173). Pick a template and start building. With no further setup, surveys and responses are stored in your browser ("Browser storage" in the top right).

## Two ways to store data

| | Browser storage (default) | Supabase |
|---|---|---|
| Setup | none | about 10 minutes, free |
| Survey link works | on the same browser and device | for anyone |
| Good for | building, previewing, collecting on one tablet in a lab or at an event | real studies |
| Builder access | anyone who opens the site on that browser | only you, after signing in |

### Collect responses from anyone (Supabase)

1. Create a free account at [supabase.com](https://supabase.com) and a new project. For data from people in the EU, choose an EU region such as **Frankfurt (eu-central-1)**.
2. In the project, open **SQL Editor**, create a new query, paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and select **Run**.
3. Open **Authentication → URL Configuration** and set **Site URL** to where your Survey Studio runs, e.g. `https://catherineranran.github.io/survey-studio/` (or `http://localhost:5173` while testing).
4. Open **Project Settings → API** (or **Connect**) and copy the **Project URL** and the **anon / publishable key**.
5. Give Survey Studio those two values, in one of two ways:
   - **GitHub Pages:** in the GitHub repository go to **Settings → Secrets and variables → Actions → Variables** and add `SUPABASE_URL` and `SUPABASE_ANON_KEY`. The next deployment picks them up.
   - **Anywhere else / locally:** paste them into [`public/config.js`](public/config.js).
6. Open Survey Studio, choose **Create the owner account**, confirm the email Supabase sends you, and sign in.
7. Recommended: in Supabase under **Authentication → Sign In / Providers**, turn off **Allow new users to sign up** once your account exists, so nobody else can create an account on your instance.

The anon key is meant to be public. Respondents can't read any table: they can only load a *published* survey and submit a response while it's open, through two database functions. Each owner only ever sees their own surveys and responses (row-level security). Surveys created in browser storage stay there; to move one, download it as JSON on the dashboard and import it after connecting Supabase.

On Supabase's free plan, projects that see no activity for a week are paused. Restore them from the Supabase dashboard; no data is lost.

## Put it online with GitHub Pages

1. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Push to `main`. The workflow in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs the tests, builds and publishes the site to `https://<your-user>.github.io/<repo>/`.

GitHub Pages needs a **public** repository on the free plan. If you want to keep the repository private, either upgrade to GitHub Pro, or deploy the same build to Netlify, Vercel or Cloudflare Pages (all free for private repositories): build command `npm run build`, output folder `dist`, and the two `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` environment variables.

## Using it

**Survey links.** Respondents get `https://…/survey-studio/?s=<survey id>`. Add URL parameters you declared in the Flow tab, e.g. `&PROLIFIC_PID=…`. The Share tab gives you the ready-made Prolific study URL, a QR code and an embed snippet.

**Logic order.** Display logic and skip rules can only look at questions that come earlier. Skip rules only jump forward, so a survey can't loop. If a respondent goes back and changes an answer, answers on pages that no longer apply are discarded on submit.

**Randomizers** live in the Flow tab. Tick the condition blocks, choose how many each person sees, and name the field (e.g. `condition`). The value saved is the block title, so give condition blocks clear names. "Keep groups balanced" assigns the condition with the fewest completed responses so far.

**Statuses.** Every response records how it ended: `complete`, `declined_consent`, or the status you gave a skip rule (`screened_out`, `failed_attention`, …). Filter by it in Results, or use the `status` column in the export.

**Exports.** Choose numeric codes for R, SPSS, Stata or Python. Checkbox questions become one 0/1 column per option (`devices_1`, `devices_2`, …), matrix questions one column per statement (`att_1`, …), rank questions one position column per item. Empty cells mean the question wasn't shown. The codebook documents every column.

## Privacy and data protection

- No tracking, analytics or third-party requests. Fonts are bundled with the app.
- Responses contain what respondents enter, URL parameters you declare, timing, and the browser's user-agent string. The app doesn't store IP addresses with responses (Supabase, like any host, keeps short-lived request logs).
- With Supabase you are the controller of the data and Supabase is your processor. Choose an EU region and see Supabase's data processing agreement if you need one for your ethics application.
- Describe in your consent text what you collect and why.

## Development

```bash
npm run dev        # local development server
npm test           # unit tests (logic engine, exports, statistics)
npm run typecheck  # TypeScript
npm run build      # production build in dist/
```

```
src/
  lib/            survey model and logic, no UI
    types.ts        the Survey / Question / Response data model
    engine.ts       randomization, display & skip logic, validation, piping, clean-up
    export.ts       CSV, codebook, SPSS syntax
    stats.ts        result summaries
    lint.ts         the pre-publish survey checker
    templates.ts    starter surveys
    backend/        browser storage and Supabase implementations
  components/     QuestionView (how respondents see a question), UI kit
  pages/          Dashboard, Workspace (Build / Flow / Settings / Share / Results), Respond
supabase/schema.sql   database tables, security rules and functions
public/config.js      runtime Supabase settings
```

A survey is plain JSON (see `src/lib/types.ts`), so you can download, version and re-import survey definitions.

## Ideas for later

File uploads, quotas, multi-language surveys (the same survey in two languages), email invitations and reminders, response editing, and a survey-flow canvas.
