import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { QuestionView } from '../components/QuestionView';
import { RichText } from '../components/RichText';
import { Button, Icon, Spinner } from '../components/ui';
import { BackendError, getBackend } from '../lib/backend';
import {
  effectiveCtx,
  finalizeAnswers,
  firstStep,
  indexSurvey,
  makePlan,
  nextStep,
  pageAt,
  pipe,
  pipeUrl,
  randomSeed,
  remainingPages,
  validateAnswer,
  visibleQuestions,
  type AssignmentCounts,
  type Ctx,
  type Plan,
  type Position,
} from '../lib/engine';
import { t } from '../lib/i18n';
import { TYPE_INFO } from '../lib/questionTypes';
import type { AnswerValue, Lang, ResponseData, Survey } from '../lib/types';

type Phase =
  | { kind: 'loading' }
  | { kind: 'blocked'; reason: 'notFound' | 'closed' | 'already' | 'missingParam'; message?: string }
  | { kind: 'welcome' }
  | { kind: 'page' }
  | { kind: 'done'; message: string; redirect?: string };

interface Runtime {
  survey: Survey;
  plan: Plan;
  version: string | null;
  answers: Record<string, AnswerValue>;
  otherText: Record<string, string>;
  embedded: Record<string, string>;
  history: Position[];
  startedAt: string;
  pageTimes: Record<string, number>;
}

interface SavedProgress extends Runtime {
  v: 1;
  started: boolean;
}

const progressKey = (id: string) => `survey-studio.progress.${id}`;
const doneKey = (id: string) => `survey-studio.done.${id}`;

const storage = {
  get(k: string) {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* storage unavailable: progress just isn't saved */
    }
  },
  remove(k: string) {
    try {
      window.localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

/** Query parameters from both the real query string and the part after the hash. */
function urlParams(): URLSearchParams {
  const out = new URLSearchParams(window.location.search);
  const h = window.location.hash;
  const i = h.indexOf('?');
  if (i >= 0) new URLSearchParams(h.slice(i + 1)).forEach((v, k) => out.set(k, v));
  return out;
}

function browserLang(): Lang {
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export interface RespondProps {
  surveyId: string;
  /** Builder preview: run this draft instead of the published version, and flag the response as a test. */
  previewSurvey?: Survey;
}

export function Respond({ surveyId, previewSurvey }: RespondProps) {
  const preview = !!previewSurvey;
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [rt, setRt] = useState<Runtime | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showSummary, setShowSummary] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  const enteredAt = useRef(Date.now());
  const topRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const lang: Lang = rt?.survey.settings.language ?? previewSurvey?.settings.language ?? browserLang();

  /* ---------------------------------------------------------------- start */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const backend = await getBackend();
        let survey: Survey;
        let version: string | null = null;
        if (previewSurvey) {
          survey = previewSurvey;
        } else {
          const pub = await backend.getPublicSurvey(surveyId);
          if (cancelled) return;
          if (!pub) return setPhase({ kind: 'blocked', reason: 'notFound' });
          survey = pub.survey;
          version = pub.publishedAt;
          const s = survey.settings;
          const closed =
            pub.status !== 'open' ||
            (s.closeAt && new Date(s.closeAt).getTime() < Date.now()) ||
            (s.responseLimit && pub.responseCount >= s.responseLimit);
          if (closed) return setPhase({ kind: 'blocked', reason: 'closed', message: s.closedMessage || undefined });
          if (s.oneResponsePerBrowser && storage.get(doneKey(surveyId))) return setPhase({ kind: 'blocked', reason: 'already' });

          if (s.saveProgress) {
            const raw = storage.get(progressKey(surveyId));
            if (raw) {
              try {
                const saved = JSON.parse(raw) as SavedProgress;
                // On a shared device, never continue someone else's answers: every declared
                // URL parameter on this link must match the saved one.
                const linkParams = urlParams();
                const sameParticipant = survey.urlParams.every((p) => {
                  const v = linkParams.get(p.name);
                  return v === null || v === saved.embedded?.[p.name];
                });
                if (!sameParticipant) storage.remove(progressKey(surveyId));
                else if (saved.v === 1 && saved.version === version && saved.history?.length) {
                  setRt({ ...saved, survey });
                  setResumed(true);
                  setPhase(saved.started ? { kind: 'page' } : { kind: 'welcome' });
                  return;
                }
              } catch {
                /* corrupted progress: start fresh */
              }
            }
          }
        }

        // URL parameters (e.g. ?PROLIFIC_PID=...) become part of the response.
        const params = urlParams();
        const embedded: Record<string, string> = {};
        const missing: string[] = [];
        for (const p of survey.urlParams) {
          const v = params.get(p.name) ?? [...params.entries()].find(([k]) => k.toLowerCase() === p.name.toLowerCase())?.[1];
          if (v) embedded[p.name] = v;
          else if (p.required) missing.push(p.name);
        }
        if (missing.length && !preview) return setPhase({ kind: 'blocked', reason: 'missingParam' });

        // Balanced randomizers need the current group sizes.
        const counts: AssignmentCounts = {};
        if (!preview) {
          for (const r of survey.randomizers.filter((x) => x.balance)) {
            counts[r.variable] = await backend.assignmentCounts(surveyId, r.variable).catch(() => ({}));
          }
        }
        if (cancelled) return;
        const plan = makePlan(survey, randomSeed(), counts);
        Object.assign(embedded, plan.assignments);
        const ctx: Ctx = { index: indexSurvey(survey), answers: {}, otherText: {}, embedded };
        const first = firstStep(plan, ctx);
        setRt({
          survey,
          plan,
          version,
          answers: {},
          otherText: {},
          embedded,
          history: first.kind === 'page' ? [first.pos] : [],
          startedAt: new Date().toISOString(),
          pageTimes: {},
        });
        setPhase(survey.settings.welcomeEnabled ? { kind: 'welcome' } : { kind: 'page' });
        enteredAt.current = Date.now();
      } catch (e) {
        if (!cancelled) setPhase({ kind: 'blocked', reason: 'notFound', message: e instanceof Error ? e.message : undefined });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyId]);

  const index = useMemo(() => (rt ? indexSurvey(rt.survey) : null), [rt?.survey]);
  // Raw answers keep what people typed (shown in the inputs); `ectx` holds only answers that
  // still apply on the current path, and is what logic, piping and navigation use.
  const ctx: Ctx | null = useMemo(
    () => (rt && index ? { index, answers: rt.answers, otherText: rt.otherText, embedded: rt.embedded, lang: rt.survey.settings.language } : null),
    [rt, index],
  );
  const ectx: Ctx | null = useMemo(() => (rt && ctx ? effectiveCtx(rt.plan, ctx, rt.history) : null), [rt, ctx]);

  /* ---------------------------------------------------- save progress */
  useEffect(() => {
    if (!rt || preview || !rt.survey.settings.saveProgress) return;
    if (phase.kind !== 'page' && phase.kind !== 'welcome') return;
    const saved: SavedProgress = { ...rt, v: 1, started: phase.kind === 'page' };
    storage.set(progressKey(surveyId), JSON.stringify(saved));
  }, [rt, phase.kind, preview, surveyId]);

  const pos = rt?.history[rt.history.length - 1];
  const page = rt && ectx && pos ? pageAt(rt.plan, ectx, pos) : null;
  const questions = page && ectx ? visibleQuestions(page, ectx) : [];

  const focusTop = useCallback(() => {
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0 });
      topRef.current?.closest('.preview-scroll')?.scrollTo({ top: 0 });
      topRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const recordTime = useCallback(() => {
    if (!rt || !page) return rt?.pageTimes ?? {};
    const spent = (Date.now() - enteredAt.current) / 1000;
    enteredAt.current = Date.now();
    return { ...rt.pageTimes, [page.key]: Math.round(((rt.pageTimes[page.key] ?? 0) + spent) * 10) / 10 };
  }, [rt, page]);

  const setAnswer = (qid: string, v: AnswerValue | undefined) => {
    setRt((cur) => {
      if (!cur) return cur;
      const answers = { ...cur.answers };
      if (v === undefined) delete answers[qid];
      else answers[qid] = v;
      return { ...cur, answers };
    });
    if (errors[qid]) setErrors(({ [qid]: _drop, ...rest }) => rest);
  };
  const setOther = (qid: string, text: string) => {
    setRt((cur) => (cur ? { ...cur, otherText: { ...cur.otherText, [qid]: text } } : cur));
    if (errors[qid]) setErrors(({ [qid]: _drop, ...rest }) => rest);
  };

  /* --------------------------------------------------------- submit */
  const submit = async (status: string, message: string | undefined, redirect: string | undefined, pageTimes: Record<string, number>) => {
    if (!rt || !ctx) return;
    setSubmitting(true);
    setSubmitError(null);
    const { answers, otherText } = finalizeAnswers(rt.plan, ctx, rt.history, status);
    const path = rt.history.map((p) => pageAt(rt.plan, ctx, p)?.key).filter((k): k is string => !!k);
    const submittedAt = new Date().toISOString();
    const data: ResponseData = {
      answers,
      otherText,
      embedded: rt.embedded,
      meta: {
        status,
        startedAt: rt.startedAt,
        submittedAt,
        durationSec: Math.max(0, Math.round((Date.parse(submittedAt) - Date.parse(rt.startedAt)) / 1000)),
        pageTimes,
        path,
        blockOrder: rt.plan.blockOrder,
        seed: rt.plan.seed,
        language: rt.survey.settings.language,
        userAgent: navigator.userAgent,
        preview,
        surveyVersion: rt.version,
      },
    };
    try {
      const backend = await getBackend();
      const id = preview ? await backend.submitPreview(surveyId, data) : await backend.submitResponse(surveyId, data);
      if (!preview) {
        storage.remove(progressKey(surveyId));
        if (rt.survey.settings.oneResponsePerBrowser) storage.set(doneKey(surveyId), new Date().toISOString());
      }
      const extra = { response_id: id };
      const s = rt.survey.settings;
      const finalCtx = effectiveCtx(rt.plan, ctx, rt.history);
      const endMessage = pipe(message || s.endMessage || t(lang, 'defaultEndMessage'), finalCtx, extra);
      const target = redirect ?? (status === 'complete' ? s.redirectUrl : '');
      const url = target?.trim() ? pipeUrl(target.trim(), finalCtx, extra) : undefined;
      setPhase({ kind: 'done', message: endMessage, redirect: url });
      focusTop();
      if (url && !preview && /^https?:\/\//i.test(url)) setTimeout(() => window.location.assign(url), 1500);
    } catch (e) {
      if (e instanceof BackendError && (e.code === 'closed' || e.code === 'limit')) {
        setPhase({ kind: 'blocked', reason: 'closed', message: rt.survey.settings.closedMessage || undefined });
      } else {
        setSubmitError(t(lang, 'submitError'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  /* ------------------------------------------------------ navigation */
  const next = () => {
    if (!rt || !ctx || !ectx || !pos || submitting) return;
    const declined = questions.some(
      (q) => q.type === 'consent' && q.endOnDecline !== false && q.choices && q.choices.length > 1 && rt.answers[q.id] === q.choices[1].id,
    );
    const errs: Record<string, string> = {};
    for (const q of declined ? [] : questions) {
      const e = validateAnswer(q, rt.answers[q.id], rt.otherText[q.id], lang);
      if (e) errs[q.id] = e;
    }
    if (Object.keys(errs).length) {
      setErrors(errs);
      setShowSummary(true);
      const firstId = questions.find((q) => errs[q.id])!.id;
      requestAnimationFrame(() => {
        const el = formRef.current?.querySelector<HTMLElement>(`[data-qid="${firstId}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el?.querySelector<HTMLElement>('input, select, textarea, button')?.focus({ preventScroll: true });
      });
      return;
    }
    setErrors({});
    setShowSummary(false);
    const pageTimes = recordTime();
    const step = nextStep(rt.plan, ectx, pos);
    if (step.kind === 'page') {
      setRt({ ...rt, pageTimes, history: [...rt.history, step.pos] });
      focusTop();
    } else {
      setRt({ ...rt, pageTimes });
      void submit(step.status, step.message, step.redirect, pageTimes);
    }
  };

  const back = () => {
    if (!rt || rt.history.length < 2) return;
    const pageTimes = recordTime();
    setErrors({});
    setShowSummary(false);
    setRt({ ...rt, pageTimes, history: rt.history.slice(0, -1) });
    focusTop();
  };

  const startOver = () => {
    storage.remove(progressKey(surveyId));
    window.location.reload();
  };

  /* ---------------------------------------------------------- render */
  const accent = rt?.survey.settings.accent ?? previewSurvey?.settings.accent;
  const style = accent ? ({ '--accent': accent } as CSSProperties) : undefined;

  if (phase.kind === 'loading') {
    return (
      <div className="respond" style={style}>
        <main className="respond-main">
          <Spinner label={t(lang, 'loading')} />
        </main>
      </div>
    );
  }

  if (phase.kind === 'blocked') {
    const text =
      phase.reason === 'closed'
        ? phase.message || t(lang, 'closed')
        : phase.reason === 'already'
          ? t(lang, 'already')
          : phase.reason === 'missingParam'
            ? t(lang, 'missingParam')
            : t(lang, 'notFound');
    return (
      <div className="respond" style={style} lang={lang}>
        <main className="respond-main">
          <section className="respond-card respond-message">
            <RichText text={text} />
          </section>
        </main>
      </div>
    );
  }

  if (!rt || !ctx || !ectx) return null;
  const s = rt.survey.settings;
  const peek = pos ? nextStep(rt.plan, ectx, pos) : null;
  const isLast = !peek || peek.kind === 'end';

  // Progress: pages done vs. pages still ahead on the current path.
  const done = Math.max(0, rt.history.length - 1);
  const ahead = pos ? remainingPages(rt.plan, ectx, pos) : 0;
  const total = phase.kind === 'done' ? done + 1 : done + 1 + ahead;
  const completed = phase.kind === 'done' ? total : done;

  // Question numbers continue across pages.
  let numberOffset = 0;
  if (s.numberQuestions) {
    for (const hp of rt.history.slice(0, -1)) {
      const p = pageAt(rt.plan, ectx, hp);
      if (p) numberOffset += visibleQuestions(p, ectx).filter((q) => TYPE_INFO[q.type].answerable).length;
    }
  }
  let localNumber = 0;

  return (
    <div className="respond" style={style} lang={lang}>
      <header className="respond-head">
        <p className="respond-title">{rt.survey.title}</p>
        {s.showProgress && phase.kind !== 'welcome' && <Progress done={completed} total={total} lang={lang} />}
      </header>
      <main className="respond-main">
        <div ref={topRef} tabIndex={-1} className="focus-anchor" aria-label={rt.survey.title} />
        {resumed && phase.kind !== 'done' && (
          <div className="resume-note">
            <span>{t(lang, 'resumeNote')}</span>
            <button type="button" className="link-btn" onClick={startOver}>
              {t(lang, 'startOver')}
            </button>
          </div>
        )}

        {phase.kind === 'welcome' && (
          <section className="respond-card welcome">
            <h1>{s.welcomeTitle || rt.survey.title}</h1>
            <RichText text={pipe(s.welcomeText, ectx)} />
            <div className="respond-nav">
              <span />
              <Button
                variant="primary"
                onClick={() => {
                  enteredAt.current = Date.now();
                  setPhase({ kind: 'page' });
                  focusTop();
                }}
              >
                {t(lang, 'start')}
              </Button>
            </div>
          </section>
        )}

        {phase.kind === 'page' && page && (
          <form
            ref={formRef}
            className="respond-page"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              next();
            }}
          >
            {showSummary && Object.keys(errors).length > 0 && (
              <div className="error-summary" role="alert">
                <Icon name="warning" size={18} />
                <span>{t(lang, 'pageHasErrors')}</span>
              </div>
            )}
            {questions.map((q) => {
              const answerable = TYPE_INFO[q.type].answerable;
              if (answerable) localNumber++;
              return (
                <QuestionView
                  key={q.id}
                  q={q}
                  number={s.numberQuestions && answerable ? numberOffset + localNumber : undefined}
                  value={rt.answers[q.id]}
                  other={rt.otherText[q.id]}
                  onChange={(v) => setAnswer(q.id, v)}
                  onOther={(text) => setOther(q.id, text)}
                  error={errors[q.id]}
                  lang={lang}
                  choiceOrder={rt.plan.choiceOrder[q.id]}
                  rowOrder={rt.plan.rowOrder[q.id]}
                  pipe={(text) => pipe(text, ectx)}
                />
              );
            })}
            <div className="respond-nav">
              {s.allowBack && rt.history.length > 1 ? (
                <Button variant="secondary" icon="back" onClick={back} disabled={submitting}>
                  {t(lang, 'back')}
                </Button>
              ) : (
                <span />
              )}
              <Button variant="primary" type="submit" disabled={submitting}>
                {submitting ? t(lang, 'submitting') : isLast ? t(lang, 'submit') : t(lang, 'next')}
              </Button>
            </div>
            {submitError && (
              <p className="submit-error" role="alert">
                {submitError}
              </p>
            )}
          </form>
        )}

        {phase.kind === 'done' && (
          <section className="respond-card done">
            <span className="done-mark" aria-hidden="true">
              <Icon name="check" size={30} />
            </span>
            <h1>{s.endTitle || t(lang, 'defaultEndTitle')}</h1>
            <RichText text={phase.message} />
            {phase.redirect && (
              <p className="redirect-note">
                {preview ? (
                  <>
                    Preview: respondents would now be sent to <code>{phase.redirect}</code>
                  </>
                ) : (
                  <>
                    {t(lang, 'redirecting')}.{' '}
                    <a href={phase.redirect}>{t(lang, 'continue')}</a>
                  </>
                )}
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function Progress({ done, total, lang }: { done: number; total: number; lang: Lang }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const label = `${t(lang, 'progress')}: ${pct}%`;
  // Up to 24 pages: one timing mark per page, like the edge of an answer sheet.
  if (total <= 24) {
    return (
      <div className="progress-marks" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={i < done ? 'is-done' : i === done ? 'is-current' : ''} />
        ))}
      </div>
    );
  }
  return (
    <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
