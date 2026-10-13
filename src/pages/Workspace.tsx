import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, Empty, ErrorBoundary, Icon, IconButton, Spinner, useToast } from '../components/ui';
import { useBackend } from '../lib/backend/context';
import { lintSurvey, type Issue } from '../lib/lint';
import { previewHash, previewWindowName, writePreviewDraft } from '../lib/preview';
import { navigate } from '../lib/router';
import type { Survey, SurveyRecord } from '../lib/types';
import { useUndoable, type Updater } from '../lib/useUndoable';
import { Builder } from './builder/Builder';
import { Flow } from './Flow';
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
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  // JSON of what's stored, so undoing back to it doesn't count as a change (and other edits always save).
  const savedJson = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRecord(undefined);
    backend
      .getSurvey(id)
      .then((rec) => {
        if (cancelled) return;
        setRecord(rec);
        if (rec) {
          savedJson.current = JSON.stringify(rec.definition);
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
    if (!survey) return;
    const json = JSON.stringify(survey);
    if (json === savedJson.current) {
      setSaveState('saved');
      return;
    }
    setSaveState('unsaved');
    const timer = setTimeout(async () => {
      setSaveState('saving');
      try {
        await backend.saveDraft(id, survey);
        savedJson.current = json;
        setSaveState('saved');
      } catch (e) {
        setSaveState('error');
        toast(`Couldn’t save: ${e instanceof Error ? e.message : e}`, 'error');
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [survey, backend, id, toast]);

  // An open preview window picks up the working copy from here and offers to restart with it.
  useEffect(() => {
    if (!survey) return;
    const timer = setTimeout(() => writePreviewDraft(id, survey), 400);
    return () => clearTimeout(timer);
  }, [survey, id]);

  const openPreview = useCallback(
    (fromBlockId?: string) => {
      if (!survey) return;
      writePreviewDraft(id, survey);
      const { origin, pathname } = window.location;
      // The nonce makes an already open preview window restart, even at the same block.
      const url = `${origin}${pathname}${previewHash(id, fromBlockId, Date.now().toString(36))}`;
      const w = window.open(url, previewWindowName(id));
      if (w) w.focus();
      else toast('Your browser blocked the preview window. Allow pop-ups for this site and try again.', 'error');
    },
    [id, survey, toast],
  );

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
      savedJson.current = JSON.stringify(survey);
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
          <Button icon="eye" iconAfter="external" onClick={() => openPreview()} title="Opens in a new window">
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
        <ErrorBoundary key={active}>
        {active === 'build' && <Builder survey={survey} surveyId={id} update={update} onPreview={openPreview} />}
        {active === 'flow' && <Flow survey={survey} update={update} surveyId={id} onPreview={openPreview} />}
        {active === 'settings' && <SettingsTab survey={survey} update={update} />}
        {active === 'share' && <ShareTab backend={backend} record={record} survey={survey} hasChanges={hasChanges} onPublish={publish} onStatus={setStatus} />}
        {active === 'results' && <Results backend={backend} surveyId={id} survey={record.published ?? survey} />}
        </ErrorBoundary>
      </div>

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
