# Survey Studio

A survey builder for research data collection: as quick as Google Forms to build with, with the parts of Qualtrics that studies actually need. Logic, randomized conditions, piping, panel IDs, clean exports with a codebook.

It is a static web app. Run it on your laptop, host it free on GitHub Pages, and keep responses either in the browser (zero setup) or in your own free Supabase database (to collect from anyone with a link).

## What it does

**Building**
- 15 question types: multiple choice, checkboxes, dropdown, rank order, rating scale (numbered bubbles or stars), matrix / Likert table, slider, Net Promoter Score, short text, paragraph, number, date, consent, constant sum, and text blocks for instructions or vignettes
- Images and videos in any text: a video file (.mp4, .webm), or a YouTube, Vimeo or Google Drive link
- Video questions: an ordinary video, or a magic window into 140°, 180° or 360° footage that respondents look around in (drag, arrow keys, or moving the phone). They can be required to watch to the end, and the data records seconds played, whether it reached the end, and where people looked each second
- Blocks and pages: all questions of a block on one page, or one per page
- Likert presets in English and German (agreement, frequency, satisfaction, importance, likelihood, quality)
- Option lists you can paste into: paste ten lines, get ten options. Enter adds a row, Backspace on an empty row removes it
- Every option has an export code, every question a variable name, so the data file is analysis-ready
- Undo / redo, autosave, duplicate questions and blocks, drag to reorder
- An outline at the left of the builder: blocks in survey order (randomizer branches side by side) and their questions, marking where you are; click to jump. Fold any block to a one-line summary, or fold them all, to move around long surveys (remembered per survey in your browser)
- A survey checker that catches broken logic, duplicate variable names and other problems before you publish

**Logic and randomization**
- Display logic on questions and blocks (all / any conditions, on answers, URL parameters or assigned conditions)
- Skip logic after each block: jump forward or end the survey with a status like `screened_out`, an optional message and an optional redirect
- Consent questions that end the survey when declined (status `declined_consent`)
- A flowchart of the survey (Flow tab), like Qualtrics' survey flow: drag blocks into sequence, or onto each other to randomize between them
- Randomizers with named branches: each respondent gets one branch (or several, in random order), optionally balanced so groups stay even. A branch can hold several blocks in a row, or none (a control group), and everyone continues with the same steps afterwards
- Shuffle option order (keeping "Other" and "None of these" last), statement order and question order
- Piping: `{{age}}`, `{{condition}}`, `{{PROLIFIC_PID}}`, `{{response_id}}` in question text, messages and redirect links

**Collecting**
- Publishing takes a snapshot: you can keep editing a live survey, respondents only see changes when you publish again
- URL parameters (Prolific, MTurk/CloudResearch, panel IDs) stored with each response, optionally required
- Redirect after completion, for example to your Prolific completion link
- Open/close, response limit, automatic close date, one response per browser, resume unfinished answers
- Respondent pages in English or German, mobile-friendly, built for keyboard and screen-reader use
- Preview in its own window, at desktop or phone width: start at any block, choose which branch you get, and skip required questions. Test responses are kept separately and flagged

**Results**
- Per-question summaries: counts and percentages, mean / median / SD, NPS, matrix heat tables, average rank
- How many respondents got each branch of a randomizer, and every summary filtered to one branch
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
2. In the project, open **SQL Editor**, create a new query, paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and select **Run**. Run it again after updating Survey Studio; it only adds what's missing.
3. Open **Authentication → Users → Add user → Create new user**. Enter your email and a password, tick **Auto Confirm User**, and create it. This first account becomes the admin.
4. Open **Project Settings → API Keys** (or the **Connect** button) and copy the **Project URL** and the **anon / publishable** key. Never use the *secret* or *service_role* key.
5. Put those two values into [`public/config.js`](public/config.js), or, for GitHub Pages, add them as repository variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` under **Settings → Secrets and variables → Actions → Variables**.
6. Open Survey Studio and sign in with the account from step 3.

### Letting other people sign up

Each account gets its own surveys and responses; nobody can see anyone else's. As an admin, choose **Invite people** on the dashboard and pick who can create an account:

- **People with the invite link** – share the link; make a new one at any time to stop the old one working.
- **Anyone who opens Survey Studio** – no link needed.
- **Nobody** – new accounts only through the Supabase dashboard.

For sign-ups to work, two Supabase settings under **Authentication → Sign In / Providers** need changing once: turn **on** "Allow new users to sign up", and turn **off** "Confirm email". Supabase's built-in email service only delivers to members of your own Supabase organisation (and 2 emails an hour), so confirmation emails wouldn't reach other people. The invite link is what keeps strangers out; the database checks it on every new account. To turn on email confirmation and password-reset emails later, connect your own email service under **Authentication → Emails → SMTP Settings**.

To make someone else an admin, run `insert into public.owners (email) values ('their@email.org');` in the SQL Editor.

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

**Flow and randomizers.** The Flow tab shows the survey as a flowchart. Drag a block between two steps to put it there, or onto another block to randomize between the two: they become two branches of a randomizer, and each respondent gets one. Drag more blocks into a branch (they run in sequence) or into "New branch". Each branch has a name, which is what's saved in the randomizer's field (e.g. `condition` = `Vignette`), so later questions can depend on it: give a question display logic "condition is not Vignette" to skip it for that group, and use "Use this logic on other questions" to copy that to many questions at once. "Keep group sizes even" gives each new respondent the branch with the fewest submitted responses so far. The *Three-condition video experiment* template is a ready-made example.

**Preview.** Preview opens in its own window, so you can keep it next to the builder. Pick where to start (or use "Preview from this block" in a block's menu) and which branch to get. Starting at a block shows it as if the respondent had just arrived, without earlier answers. "Skip required questions" lets you click through; answers you do give are still checked. When you edit the survey, the preview offers to restart with the changes.

**Video questions (magic window).** Add a *Video* question (under Research) and paste the video's link. *Shown as: Magic window* lets respondents look around in wrap-around footage: set how far the picture reaches around them (140°, 180° for VR180, 360°) and how much is visible at once. *Look-around area* keeps people to the central part of a picture, so conditions can match: a 180° video limited to 140° turns exactly as far as a 140° one. With *Required* on, Next appears once the video has ended. If a video can't play on someone's device, they can continue and the reason is saved (`<name>_error`), so nobody gets stuck. Exports get `<name>_sec` (seconds played), `<name>_end` (watched to the end) and, for magic windows, `<name>_look`: one `[yaw, pitch]` per second of the video, in degrees from straight ahead (yaw > 0 right, pitch > 0 up). Mention the viewing data in your consent text.

**Where to put videos.** Any https link to an .mp4 or .webm file works; for a magic window the file must come from your own site or one that allows it (CORS). To keep stimuli private on a public website, encrypt them into a *video folder*:

```bash
node scripts/seal-video.mjs clip.mp4 out/clip --view wrap --span 180 --fov 90 --title "Captured, bystander"
```

Upload the folder and use `https://…/clip/video.json#k=<key>` (the key is printed) as the video link. Participants' browsers open it without a password; someone browsing the website only finds sealed files. The key is part of the survey, so data exports and the survey definition in Results leave it out; the survey backup on the dashboard keeps it. Encrypted videos load completely before they play (they start loading when the participant begins the survey), so keep them reasonably small: about 2048 × 2048 px and H.264 suits most phones.

**Images and videos.** In a question or text block, use the ▶ button below the text, or type `![description](https://…)`. Video files play in the browser's own player. YouTube videos play from youtube-nocookie.com and Vimeo with "do not track", but they still load from those sites; for strict data protection, put the video file on your own web space.

**Statuses.** Every response records how it ended: `complete`, `declined_consent`, or the status you gave a skip rule (`screened_out`, `failed_attention`, …). Filter by it in Results, or use the `status` column in the export.

**Exports.** Choose numeric codes for R, SPSS, Stata or Python. Checkbox questions become one 0/1 column per option (`devices_1`, `devices_2`, …; a negative code like -99 becomes `devices_m99`), matrix questions one column per statement (`att_1`, …), rank questions one position column per item. A checkbox question that was shown but left empty exports as 0s; empty cells mean the question wasn't shown or wasn't answered. `submitted_at` is the server's time. The codebook documents every column.

**Answers that no longer apply.** Logic, piping and navigation only use answers that still apply on the respondent's path. If someone types an age, then changes an earlier answer so the age question disappears, that age neither triggers skip rules nor gets stored. Someone who declines consent leaves only that decision in the data.

## Known limitations

Worth knowing before you run a real study:

- **Redirect links are visible.** Completion and screen-out links (for example a Prolific completion code) are part of the published survey, so a technically minded participant can find them without finishing. Check responses against your data before approving submissions.
- **No bot protection or rate limiting.** Anyone with the link can submit, as often as they like, and could forge values. Screen your data (attention checks, durations, duplicate participant IDs).
- **Balanced assignment counts submitted responses.** When many people start at the same moment, groups can drift apart until those responses arrive. For a large burst of simultaneous participants, plain random assignment may balance as well.
- **Randomizer branches.** Assignments are recorded by branch name, so don't rename branches during data collection (conditions in your logic follow a rename, but responses already collected keep the old name). A skip rule that jumps to a block inside a randomizer goes to the branch the respondent got. Blocks inside a randomizer shouldn't have display logic of their own (the survey checker warns).
- **Editing a live survey.** Deleting options or changing a question's type after responses arrive can make earlier answers export as empty. Download your data before big edits. People who resume a survey after you publish changes start again, with a new random assignment.
- **Shuffled blocks.** In a block with shuffled questions, keep follow-up questions in the next block (the checker warns when a shuffled block contains its own follow-ups).

## Privacy and data protection

- No tracking, analytics or third-party requests. Fonts are bundled with the app. The exception is what you add yourself: an image or video from another site, or a YouTube, Vimeo or Google Drive video, loads from there when respondents see it.
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
    flow.ts         the survey as a flow: sequence, randomizers, branches (all structural edits)
    export.ts       CSV, codebook, SPSS syntax
    stats.ts        result summaries
    lint.ts         the pre-publish survey checker
    templates.ts    starter surveys
    backend/        browser storage and Supabase implementations
  components/     QuestionView (how respondents see a question), UI kit
  pages/          Dashboard, Workspace (Build / Flow / Settings / Share / Results), Respond, PreviewWindow
supabase/schema.sql   database tables, security rules and functions
public/config.js      runtime Supabase settings
```

A survey is plain JSON (see `src/lib/types.ts`), so you can download, version and re-import survey definitions.

## Ideas for later

File uploads, quotas, multi-language surveys (the same survey in two languages), email invitations and reminders, response editing, and a minimum viewing time before respondents can continue (for videos).
