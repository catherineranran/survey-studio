import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, Empty, Icon, IconButton, Spinner, useToast } from '../components/ui';
import { useBackend } from '../lib/backend/context';
import { lintSurvey, type Issue } from '../lib/lint';
import { navigate } from '../lib/router';
import type { Survey, SurveyRecord } from '../lib/types';
import { useUndoable, type Updater } from '../lib/useUndoable';
import { Builder } from './builder/Builder';
import { Flow } from './Flow';
import { Respond } from './Respond';
import { Results } from './Results';
import { SettingsTab } from './SettingsTab';
import { ShareTab } from './ShareTab';

const TABS = [
  { id: 'build', label: 'Build' },
  { id: 'flow', label: 'Flow' },
  { id: 'settings', label: 'Settings' },
  { id: 'share', label: 'Share' },
  { id: 'results', label: 'Results' },
] as const;

type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

export function Workspace({ id, tab }: { id: string; tab: string }) {
  const backend = useBackend();
  const toast = useToast();
  const [record, setRecord] = useState<SurveyRecord | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const draft = useUndoable<Survey | null>(null);
  const survey = draft.value;
  const draftUpdate = draft.update;
  const update: Updater<Survey> = useCallback((mutate, opts) => draftUpdate((s) => void (s && mutate(s)), opts), [draftUpdate]);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const loadedRef = useRef<Survey | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRecord(undefined);
    backend
      .getSurvey(id)
      .then((rec) => {
        if (cancelled) return;
        setRecord(rec);
        if (rec) {
          loadedRef.current = rec.definition;
          draft.reset(rec.definition);
        }
      })
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, id]);

  // Autosave the working copy shortly after each change.
  useEffect(() => {
    if (!survey || survey === loadedRef.current) return;
    setSaveState('unsaved');
    const timer = setTimeout(async () => {
      setSaveState('saving');
      try {
        await backend.saveDraft(id, survey);
        setSaveState('saved');
      } catch (e) {
        setSaveState('error');
        toast(`Couldn’t save: ${e instanceof Error ? e.message : e}`, 'error');
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [survey, backend, id, toast]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saveState !== 'saved') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);

  // Undo / redo shortcuts, except while typing in a field (the browser handles those).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) draft.redo();
      else draft.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft]);

  const hasChanges = useMemo(() => {
    if (!record || !survey) return false;
    if (!record.published) return true;
    return JSON.stringify(record.published) !== JSON.stringify(survey);
  }, [record, survey]);

  const doPublish = useCallback(async () => {
    if (!record || !survey) return;
    setPublishing(true);
    try {
      const status = record.status === 'draft' ? 'open' : record.status;
      const rec = await backend.publish(id, survey, status);
      loadedRef.current = survey;
      setRecord(rec);
      setSaveState('saved');
      setIssues(null);
      toast(record.published ? 'Changes published' : 'Survey published. It’s accepting responses.', 'success');
    } catch (e) {
      toast(`Couldn’t publish: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      setPublishing(false);
    }
  }, [backend, id, record, survey, toast]);

  const publish = () => {
    if (!survey) return;
    const found = lintSurvey(survey);
    if (found.length) setIssues(found);
    else void doPublish();
  };

  const setStatus = async (open: boolean) => {
    if (!record) return;
    const status = open ? 'open' : 'closed';
    try {
      await backend.setStatus(id, status);
      setRecord({ ...record, status });
      toast(open ? 'Accepting responses again' : 'Survey closed. The link now shows a “closed” message.', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  if (loadError)
    return (
      <div className="page-narrow">
        <Empty title="This survey couldn’t be opened" action={<Button onClick={() => navigate('/')}>Back to surveys</Button>}>
          <p>{loadError}</p>
        </Empty>
      </div>
    );
  if (record === undefined || (record && !survey)) return <Spinner label="Opening survey" />;
  if (record === null || !survey)
    return (
      <div className="page-narrow">
        <Empty title="Survey not found" action={<Button onClick={() => navigate('/')}>Back to surveys</Button>}>
          <p>It may have been deleted, or it belongs to another account.</p>
        </Empty>
      </div>
    );

  const active = TABS.some((t) => t.id === tab) ? tab : 'build';
  const errors = issues?.filter((i) => i.level === 'error') ?? [];

  return (
    <div className="workspace">
      <div className="ws-head">
        <div className="ws-title-row">
          <IconButton icon="back" label="All surveys" onClick={() => navigate('/')} />
          <input
            className="ws-title"
            value={survey.title}
            aria-label="Survey title"
            onChange={(e) => update((s) => void (s.title = e.target.value), { coalesce: 'title' })}
          />
          <span className={`status-pill status-${record.status}`}>{record.status === 'draft' ? 'Draft' : record.status === 'open' ? 'Open' : 'Closed'}</span>
        </div>
        <div className="ws-actions">
          <span className={`save-state save-${saveState}`} aria-live="polite">
            {saveState === 'saved' ? 'All changes saved' : saveState === 'saving' ? 'Saving' : saveState === 'unsaved' ? 'Unsaved changes' : 'Not saved'}
          </span>
          <IconButton icon="undo" label="Undo" onClick={draft.undo} disabled={!draft.canUndo} />
          <IconButton icon="redo" label="Redo" onClick={draft.redo} disabled={!draft.canRedo} />
          <Button icon="eye" onClick={() => setPreviewOpen(true)}>
            Preview
          </Button>
          <Button variant="primary" icon="share" onClick={publish} disabled={publishing || (!hasChanges && !!record.published)}>
            {record.published ? (hasChanges ? 'Publish changes' : 'Published') : 'Publish'}
          </Button>
        </div>
      </div>
      <nav className="tabs" aria-label="Survey sections">
        {TABS.map((t) => (
          <a key={t.id} href={`#/s/${id}/${t.id}`} className={`tab ${active === t.id ? 'is-active' : ''}`} aria-current={active === t.id ? 'page' : undefined}>
            {t.label}
          </a>
        ))}
      </nav>

      <div className="ws-body">
        {active === 'build' && <Builder survey={survey} update={update} />}
        {active === 'flow' && <Flow survey={survey} update={update} surveyId={id} />}
        {active === 'settings' && <SettingsTab survey={survey} update={update} />}
        {active === 'share' && <ShareTab backend={backend} record={record} survey={survey} hasChanges={hasChanges} onPublish={publish} onStatus={setStatus} />}
        {active === 'results' && <Results backend={backend} surveyId={id} survey={record.published ?? survey} />}
      </div>

      {previewOpen && <PreviewOverlay survey={survey} surveyId={id} onClose={() => setPreviewOpen(false)} />}

      <Dialog
        open={!!issues}
        onClose={() => setIssues(null)}
        title={errors.length ? 'Fix these before publishing' : 'Check these before publishing'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setIssues(null)}>
              {errors.length ? 'Back to editing' : 'Keep editing'}
            </Button>
            {!errors.length && (
              <Button variant="primary" onClick={doPublish} disabled={publishing}>
                Publish anyway
              </Button>
            )}
          </>
        }
      >
        <ul className="issues">
          {issues?.map((i, k) => (
            <li key={k} className={`issue issue-${i.level}`}>
              <Icon name={i.level === 'error' ? 'warning' : 'info'} size={16} />
              <span>{i.message}</span>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}

function PreviewOverlay({ survey, surveyId, onClose }: { survey: Survey; surveyId: string; onClose: () => void }) {
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  const [run, setRun] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);
  return (
    <div className="preview-overlay" role="dialog" aria-modal="true" aria-label="Preview">
      <div className="preview-bar">
        <div className="preview-label">
          <strong>Preview</strong>
          <span className="hint">Logic and randomization run for real. Submitted answers are kept as test responses.</span>
        </div>
        <div className="segmented" role="group" aria-label="Screen size">
          <button type="button" className={device === 'desktop' ? 'is-on' : ''} aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}>
            <Icon name="desktop" size={16} /> Desktop
          </button>
          <button type="button" className={device === 'phone' ? 'is-on' : ''} aria-pressed={device === 'phone'} onClick={() => setDevice('phone')}>
            <Icon name="phone" size={16} /> Phone
          </button>
        </div>
        <Button icon="undo" onClick={() => setRun((n) => n + 1)}>
          Restart
        </Button>
        <Button variant="primary" onClick={onClose}>
          Close preview
        </Button>
      </div>
      <div className="preview-scroll">
        <div className={`preview-frame preview-${device}`}>
          <Respond key={run} surveyId={surveyId} previewSurvey={survey} />
        </div>
      </div>
    </div>
  );
}
