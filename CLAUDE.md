# Survey Studio: notes for AI coding sessions

Static React + TypeScript app (Vite). No server code: storage is either the browser (localStorage) or Supabase.

## Commands
- `npm run dev`, `npm test` (Vitest), `npm run typecheck`, `npm run build`
- Run `npm test && npm run typecheck` before committing.

## Architecture
- `src/lib/types.ts` is the data model. A Survey is plain JSON; respondents always get the *published* snapshot (`SurveyRecord.published`), the builder edits `definition`.
- `src/lib/engine.ts` holds all runtime behaviour (randomization plan, display/skip logic, validation, piping, answer clean-up). Keep it pure and covered by `engine.test.ts`.
- `src/lib/flow.ts` is the survey as a flow. A randomizer has named arms (branches), each a list of block ids run in sequence; it runs where its first block sits, and `survey.blocks` is kept in flow order. Every structural edit (move, add, delete blocks; branches) goes through flow.ts so that stays true (`tidy` repairs it; `normalizeSurvey` migrates old files whose randomizers listed single blocks). The saved value is the arm label (several joined with `|`), so renames go through `renameArm` / `renameRandomizer` / `renameUrlParam`, which carry conditions along.
- Logic, piping, progress and navigation must use `effectiveCtx(plan, ctx, history)`: only answers that still apply on the respondent's path. Raw `ctx.answers` are only for showing what people typed in the inputs. `finalizeAnswers` applies the same rule before storing.
- `src/lib/backend/` has two implementations of the `Backend` interface (`local.ts`, `supabase.ts`). Any new data operation needs both, plus SQL in `supabase/schema.sql` if respondents call it.
- Respondents never touch tables directly in Supabase: only `get_public_survey` and `submit_response` (security definer). Don't add anon policies.
- Collaborator links (`#/shared/<token>`, `survey_shares` table): owners manage them in the Share tab; people with a link only go through `get_shared_survey` / `save_shared_survey` (edit links), signed in or not. `Workspace` takes `id` (owner) or `shareToken`; view links get a no-op `update`, shared sessions have no Share/Results tabs or publishing, and their previews pass `discard` so no test responses are stored.
- Saves carry a base: `saveDraft` / `publish` / `save_shared_survey` take the `updatedAt` the copy was loaded or last saved with and fail with code `conflict` if it moved on; the Workspace queues saves (one after another) and shows a banner to load the latest version or keep its own. `setStatus` returns null instead of a new base when someone saved in between.
- `src/components/QuestionView.tsx` renders every question type for respondents, the preview and the builder canvas.
- `page_break` is an item, not a question (`answerable: false`, no variable, never selected in the builder): `pagesForBlock` splits a block at breaks, and breaks and text blocks keep their place when questions are shuffled. `lib/blocks.ts` summarises blocks (contents, pages) and holds the block-level forced/optional rule (`blockResponses`, `setBlockResponses`, `followBlock` for new questions); it's per-question `required` underneath.
- Respondent appearance (`lib/appearance.ts`): accent, text colour and text size, with WCAG contrast checks. `respondentStyle` sets CSS variables on the page; respondent font sizes are written `calc(Npx * var(--rs, 1))` so the size setting scales them (do the same for new respondent text).
- `pages/flowText.ts` describes a block for the Flow tab and the flowchart image; `pages/flowImage.ts` lays the flowchart out (pure, tested with a fake text measure) and draws it on a canvas for "Download as PNG".
- Builder view state that isn't part of the survey (folded blocks per survey, outline shown or hidden) lives in `src/lib/builderView.ts` (localStorage, outside undo). `pages/builder/Outline.tsx` is the outline (docked at ≥1200px, a `<dialog>` drawer below that); folding and unfolding keep the block you're reading in place (`anchor` in Builder.tsx), and anything that selects a question unfolds its block.
- Video questions: `components/VideoPlayer.tsx` (flat or WebGL magic window; records `VideoAnswer` {sec, end, look, err}), `lib/video.ts` (links, `video.json` folders, AES-GCM parts with the key in `#k=`, shared download cache), `scripts/seal-video.mjs` makes folders. Required means watched to the end; any playback failure sets `err` so respondents are never stuck. Keys never go into data exports (`withoutVideoKeys`).
- Adding a question type: `types.ts` (QuestionType), `questionTypes.ts` (TYPE_INFO, TYPE_GROUPS, createQuestion), `QuestionView.tsx`, `engine.ts` (validateAnswer, answerText, operatorsFor in LogicEditor), `export.ts` (questionColumns), `stats.ts` (summarize), `QuestionEditor.tsx` / `Inspector.tsx`.

## Conventions
- Routes are hash-based (`#/s/<id>/build`); the respondent link is `?s=<id>` so panels can append query parameters. The preview window is `#/s/<id>/preview?from=<blockId>`; the workspace hands it the working copy through localStorage (`src/lib/preview.ts`), and `Respond` takes `previewOptions` (start block, forced branches, skip required).
- State edits go through `useUndoable`'s `update(draft => { ... })` (mutate a clone). Pass `{ coalesce: key }` for typing so one word is one undo step.
- Respondent-facing strings live in `src/lib/i18n.ts` (English and German). Builder UI is English.
- Design: "optical answer sheet". Drop-out-ink green (`--form`) for structure, graphite pencil marks for answers, Atkinson Hyperlegible (self-hosted; no external requests, for GDPR). Respondent pages are always light.
- Text rendering: `RichText` (tiny safe Markdown subset). Never use `dangerouslySetInnerHTML` for user or respondent content.
