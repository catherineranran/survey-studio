# Survey Studio: notes for AI coding sessions

Static React + TypeScript app (Vite). No server code: storage is either the browser (localStorage) or Supabase.

## Commands
- `npm run dev`, `npm test` (Vitest), `npm run typecheck`, `npm run build`
- Run `npm test && npm run typecheck` before committing.

## Architecture
- `src/lib/types.ts` is the data model. A Survey is plain JSON; respondents always get the *published* snapshot (`SurveyRecord.published`), the builder edits `definition`.
- `src/lib/engine.ts` holds all runtime behaviour (randomization plan, display/skip logic, validation, piping, answer clean-up). Keep it pure and covered by `engine.test.ts`.
- Logic, piping, progress and navigation must use `effectiveCtx(plan, ctx, history)`: only answers that still apply on the respondent's path. Raw `ctx.answers` are only for showing what people typed in the inputs. `finalizeAnswers` applies the same rule before storing.
- `src/lib/backend/` has two implementations of the `Backend` interface (`local.ts`, `supabase.ts`). Any new data operation needs both, plus SQL in `supabase/schema.sql` if respondents call it.
- Respondents never touch tables directly in Supabase: only `get_public_survey` and `submit_response` (security definer). Don't add anon policies.
- `src/components/QuestionView.tsx` renders every question type for respondents, the preview and the builder canvas.
- Adding a question type: `types.ts` (QuestionType), `questionTypes.ts` (TYPE_INFO, TYPE_GROUPS, createQuestion), `QuestionView.tsx`, `engine.ts` (validateAnswer, answerText, operatorsFor in LogicEditor), `export.ts` (questionColumns), `stats.ts` (summarize), `QuestionEditor.tsx` / `Inspector.tsx`.

## Conventions
- Routes are hash-based (`#/s/<id>/build`); the respondent link is `?s=<id>` so panels can append query parameters.
- State edits go through `useUndoable`'s `update(draft => { ... })` (mutate a clone). Pass `{ coalesce: key }` for typing so one word is one undo step.
- Respondent-facing strings live in `src/lib/i18n.ts` (English and German). Builder UI is English.
- Design: "optical answer sheet". Drop-out-ink green (`--form`) for structure, graphite pencil marks for answers, Atkinson Hyperlegible (self-hosted; no external requests, for GDPR). Respondent pages are always light.
- Text rendering: `RichText` (tiny safe Markdown subset). Never use `dangerouslySetInnerHTML` for user or respondent content.
