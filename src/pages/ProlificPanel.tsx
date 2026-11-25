import { useEffect, useMemo, useState } from 'react';
import { Button, Field, Icon } from '../components/ui';
import type { Backend } from '../lib/backend';
import { uid } from '../lib/ids';
import {
  PROLIFIC_PARAMS,
  parseCompletionCode,
  prolificStudyUrl,
  surveyEndings,
  usesProlific,
  visibleCompletionCodes,
  type CompletionCodes,
} from '../lib/prolific';
import type { Updater } from '../lib/useUndoable';
import type { Survey, SurveyRecord } from '../lib/types';

const sameCodes = (a: CompletionCodes, b: CompletionCodes) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => (a[k] ?? '') === (b[k] ?? ''));
};

/**
 * Recruiting on Prolific: the study link to paste into Prolific, and a completion code for
 * each way the survey can end. The codes are kept apart from the survey (owners only) and
 * apply straight away; respondents from Prolific are sent back with theirs once their
 * response is stored.
 */
export function ProlificPanel({
  backend,
  record,
  survey,
  update,
  link,
  copy,
  onPublish,
}: {
  backend: Backend;
  record: SurveyRecord;
  survey: Survey;
  update: Updater<Survey>;
  link: string;
  copy: (text: string, what: string) => void;
  onPublish: () => void;
}) {
  const on = usesProlific(survey);
  const live = !!record.published && usesProlific(record.published);
  // Endings of the working copy, and of the published survey: respondents get that one, so its
  // endings need codes too until the changes are published.
  const endings = useMemo(() => {
    const out = surveyEndings(survey);
    for (const e of record.published ? surveyEndings(record.published) : [])
      if (!out.some((x) => x.key === e.key))
        out.push({ ...e, detail: `${e.detail} Only in the published survey: respondents can still end this way until you publish your changes.` });
    return out;
  }, [survey, record.published]);
  const visible = useMemo(() => visibleCompletionCodes(survey), [survey]);
  const [saved, setSaved] = useState<CompletionCodes | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    backend.getCompletionCodes(record.id).then(
      (codes) => {
        if (cancelled) return;
        setSaved(codes);
        setDraft(codes);
      },
      (e) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [backend, record.id, on]);

  // What would be stored: codes as Prolific gives them (a pasted completion link becomes its code).
  const parsed = Object.entries(draft).map(([k, v]) => [k, parseCompletionCode(v)] as const);
  const wrong = new Set(parsed.filter(([, c]) => c === null).map(([k]) => k));
  const codes: CompletionCodes = Object.fromEntries(parsed.filter((e): e is readonly [string, string] => !!e[1]));
  const dirty = !!saved && !sameCodes(codes, saved);
  // Codes kept for endings the survey no longer has (a renamed end tag, say).
  const orphans = Object.keys(draft).filter((k) => !endings.some((e) => e.key === k));

  const save = async (next: CompletionCodes) => {
    setSaving(true);
    setError(null);
    try {
      await backend.setCompletionCodes(record.id, next);
      setSaved(next);
      setDraft(next);
      setJustSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const setUp = () =>
    update((d) => {
      for (const name of PROLIFIC_PARAMS) if (!d.urlParams.some((p) => p.name === name)) d.urlParams.push({ id: uid('p'), name, required: false });
    });

  // Codes written into the survey move here: kept, and taken out of the survey.
  const moveVisible = async () => {
    const next = { ...(saved ?? {}) };
    for (const v of visible) if (!next[v.ending] && parseCompletionCode(v.code)) next[v.ending] = parseCompletionCode(v.code)!;
    await save(next);
    update((d) => visibleCompletionCodes(d).forEach((v) => v.remove(d)));
  };

  const field = (key: string, label: string, detail: string) => (
    <Field
      key={key}
      label={label}
      htmlFor={`cc-${key}`}
      error={wrong.has(key) ? 'Paste the code (letters and digits) or the whole completion link from Prolific.' : null}
      hint={detail}
    >
      <input
        id={`cc-${key}`}
        className="input mono prolific-code"
        value={draft[key] ?? ''}
        placeholder="e.g. C1A2B3C4"
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setJustSaved(false);
          setDraft((d) => ({ ...d, [key]: e.target.value }));
        }}
      />
    </Field>
  );

  return (
    <section className="panel prolific">
      <header className="panel-head">
        <h2>Prolific</h2>
        <p className="hint">
          Participants’ Prolific IDs are stored with their responses, and when they finish they go straight back to Prolific with your completion code, which
          can approve and pay them automatically.
        </p>
      </header>

      {!on ? (
        <div className="prolific-start">
          <p>Records PROLIFIC_PID, STUDY_ID and SESSION_ID with each response, then sends people back to Prolific at the end.</p>
          <Button icon="plus" onClick={setUp}>
            Set up for Prolific
          </Button>
        </div>
      ) : (
        <ol className="prolific-steps">
          <li>
            <h3>Study link</h3>
            <p className="hint">
              In Prolific, under <em>Data collection</em>, paste this as the study’s URL and choose <em>I’ll use URL parameters</em>.
            </p>
            <div className="link-row">
              <input className="input mono" readOnly value={prolificStudyUrl(link)} onFocus={(e) => e.target.select()} aria-label="Study URL for Prolific" />
              <Button icon="copy" onClick={() => copy(prolificStudyUrl(link), 'Prolific link')}>
                Copy
              </Button>
            </div>
            {!live && (
              <div className="publish-callout">
                <p>Publish your changes: respondents’ Prolific IDs are only recorded, and people only sent back, once the published survey includes them.</p>
                <Button variant="primary" icon="share" onClick={onPublish}>
                  {record.published ? 'Publish changes' : 'Publish survey'}
                </Button>
              </div>
            )}
          </li>

          <li>
            <h3>Completion codes</h3>
            <p className="hint">
              In Prolific, under <em>Completion paths</em>, copy each path’s code (or its whole link) into the ending it belongs to. To pay people who finish
              automatically, give their code the action that approves the submission; to check their data first, hold it for review. An ending without a code
              shows your end message and doesn’t send people back.
            </p>
            {visible.length > 0 && (
              <div className="notice notice-warn">
                <Icon name="warning" size={18} />
                <div>
                  <p>
                    {visible.map((v) => v.where).join(' and ')} {visible.length > 1 ? 'contain' : 'contains'} a Prolific completion code that anyone can read in the
                    survey.
                  </p>
                  <Button size="sm" disabled={saving || !saved} onClick={() => void moveVisible()}>
                    Move {visible.length > 1 ? 'them' : 'it'} here
                  </Button>
                </div>
              </div>
            )}
            {!saved && !error ? (
              <p className="hint">Loading the codes …</p>
            ) : saved ? (
              <div className="prolific-codes">
                {endings.map((e) => field(e.key, e.label, e.detail))}
                {orphans.map((k) => field(k, `Ending “${k}”`, 'The survey no longer ends this way. Clear the code if you don’t need it.'))}
              </div>
            ) : null}
            {error && <p className="field-error">{error}</p>}
            {saved && (
              <div className="prolific-save">
                <Button variant="primary" disabled={!dirty || saving || wrong.size > 0} onClick={() => void save(codes)}>
                  {saving ? 'Saving…' : 'Save codes'}
                </Button>
                <span className="hint">
                  {dirty ? 'Not saved yet.' : justSaved ? 'Saved. They apply straight away; no need to publish.' : 'Codes apply straight away; no need to publish.'}
                </span>
              </div>
            )}
            <p className="hint prolific-safety">
              <Icon name="lock" size={14} /> The codes aren’t part of the survey, so participants can’t find them in it: each person’s browser gets the code for
              their ending only after their response is saved. People who open the survey without a Prolific ID aren’t sent to Prolific.
            </p>
          </li>

          <li>
            <h3>Check it</h3>
            <p className="hint">
              Preview the survey to the end: the last page shows the Prolific link each ending would use. Then try Prolific’s own study preview before you launch.
            </p>
          </li>
        </ol>
      )}
    </section>
  );
}
