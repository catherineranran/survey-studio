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
- `src/components/QuestionView.tsx` renders every question type for respondents, the preview and the builder canvas.
- Video questions: `components/VideoPlayer.tsx` (flat or WebGL magic window; records `VideoAnswer` {sec, end, look, err}), `lib/video.ts` (links, `video.json` folders, AES-GCM parts with the key in `#k=`, shared download cache), `scripts/seal-video.mjs` makes folders. Required means watched to the end; any playback failure sets `err` so respondents are never stuck. Keys never go into data exports (`withoutVideoKeys`).
- Adding a question type: `types.ts` (QuestionType), `questionTypes.ts` (TYPE_INFO, TYPE_GROUPS, createQuestion), `QuestionView.tsx`, `engine.ts` (validateAnswer, answerText, operatorsFor in LogicEditor), `export.ts` (questionColumns), `stats.ts` (summarize), `QuestionEditor.tsx` / `Inspector.tsx`.

## Conventions
- Routes are hash-based (`#/s/<id>/build`); the respondent link is `?s=<id>` so panels can append query parameters. The preview window is `#/s/<id>/preview?from=<blockId>`; the workspace hands it the working copy through localStorage (`src/lib/preview.ts`), and `Respond` takes `previewOptions` (start block, forced branches, skip required).
- State edits go through `useUndoable`'s `update(draft => { ... })` (mutate a clone). Pass `{ coalesce: key }` for typing so one word is one undo step.
- Respondent-facing strings live in `src/lib/i18n.ts` (English and German). Builder UI is English.
- Design: "optical answer sheet". Drop-out-ink green (`--form`) for structure, graphite pencil marks for answers, Atkinson Hyperlegible (self-hosted; no external requests, for GDPR). Respondent pages are always light.
- Text rendering: `RichText` (tiny safe Markdown subset). Never use `dangerouslySetInnerHTML` for user or respondent content.
