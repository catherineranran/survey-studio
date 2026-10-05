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

1. Create a free account at [supabase.com](https://supabase.com) and a new project. For data from people in the EU, choose an EU region such as **Frankfurt (eu-central-1)**. Keep the other default settings.
2. In the project, open **SQL Editor**, create a new query, paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and select **Run**.
3. Open **Authentication → Users → Add user → Create new user**. Enter your email and a password, tick **Auto Confirm User**, and create it. This first account becomes the owner.
4. Open **Authentication → Sign In / Providers** and turn off **Allow new users to sign up**. (The database also refuses accounts that aren't listed as owners; this switch is a second lock.)
5. Open **Project Settings → API Keys** (or the **Connect** button) and copy the **Project URL** and the **anon / publishable** key. Never use the *secret* or *service_role* key.
6. Put those two values into [`public/config.js`](public/config.js), or, for GitHub Pages, add them as repository variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` under **Settings → Secrets and variables → Actions → Variables**.
7. Open Survey Studio and sign in with the account from step 3.

To add a co-owner later, run `insert into public.owners (email) values ('their@email.org');` in the SQL Editor, then add them under Authentication → Users.

The anon key is meant to be public. Respondents can't read any table: they can only load a *published* survey and submit a response while it's open, through two database functions. Each owner only ever sees their own surveys and responses (row-level security). Surveys created in browser storage stay there; to move one, download it as JSON on the dashboard and import it after connecting Supabase.

On Supabase's free plan, projects that see no activity for a week are paused. Restore them from the Supabase dashboard; no data is lost.

## Put it online with GitHub Pages

1. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Push to `main`. The workflow in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs the tests, builds and publishes the site to `https://<your-user>.github.io/<repo>/`.

If your personal GitHub Pages site has its own domain, the project appears under it automatically. This copy runs at [ranranli.net/survey-studio](https://ranranli.net/survey-studio/).

GitHub Pages needs a **public** repository on the free plan. If you want to keep the repository private, either upgrade to GitHub Pro, or deploy the same build to Netlify, Vercel or Cloudflare Pages (all free for private repositories): build command `npm run build`, output folder `dist`, and the two `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` environment variables.

## Using it

**Survey links.** Respondents get `https://…/survey-studio/?s=<survey id>`. Add URL parameters you declared in the Flow tab, e.g. `&PROLIFIC_PID=…`. The Share tab gives you the ready-made Prolific study URL, a QR code and an embed snippet.

**Logic order.** Display logic and skip rules can only look at questions that come earlier. Skip rules only jump forward, so a survey can't loop. If a respondent goes back and changes an answer, answers on pages that no longer apply are discarded on submit.

**Randomizers** live in the Flow tab. Tick the condition blocks, choose how many each person sees, and name the field (e.g. `condition`). The value saved is the block title, so give condition blocks clear names. "Keep groups balanced" assigns the condition with the fewest completed responses so far.

**Statuses.** Every response records how it ended: `complete`, `declined_consent`, or the status you gave a skip rule (`screened_out`, `failed_attention`, …). Filter by it in Results, or use the `status` column in the export.

**Exports.** Choose numeric codes for R, SPSS, Stata or Python. Checkbox questions become one 0/1 column per option (`devices_1`, `devices_2`, …; a negative code like -99 becomes `devices_m99`), matrix questions one column per statement (`att_1`, …), rank questions one position column per item. A checkbox question that was shown but left empty exports as 0s; empty cells mean the question wasn't shown or wasn't answered. `submitted_at` is the server's time. The codebook documents every column.

**Answers that no longer apply.** Logic, piping and navigation only use answers that still apply on the respondent's path. If someone types an age, then changes an earlier answer so the age question disappears, that age neither triggers skip rules nor gets stored. Someone who declines consent leaves only that decision in the data.

## Known limitations

Worth knowing before you run a real study:

- **Redirect links are visible.** Completion and screen-out links (for example a Prolific completion code) are part of the published survey, so a technically minded participant can find them without finishing. Check responses against your data before approving submissions.
- **No bot protection or rate limiting.** Anyone with the link can submit, as often as they like, and could forge values. Screen your data (attention checks, durations, duplicate participant IDs).
- **Balanced assignment counts submitted responses.** When many people start at the same moment, groups can drift apart until those responses arrive. For a large burst of simultaneous participants, plain random assignment may balance as well.
- **Randomized blocks.** Assignments are recorded by block name, so don't rename condition blocks during data collection. Skip rules can't jump into a randomized block, and blocks inside a randomizer shouldn't have display logic of their own (the survey checker warns about both).
- **Editing a live survey.** Deleting options or changing a question's type after responses arrive can make earlier answers export as empty. Download your data before big edits. People who resume a survey after you publish changes start again, with a new random assignment.
- **Shuffled blocks.** In a block with shuffled questions, keep follow-up questions in the next block (the checker warns when a shuffled block contains its own follow-ups).

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
