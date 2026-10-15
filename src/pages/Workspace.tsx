import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, Empty, ErrorBoundary, Icon, IconButton, Spinner, useToast } from '../components/ui';
import { BIN_DAYS, BackendError, type ShareRole } from '../lib/backend';
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
// Collaborators see the survey itself, never responses or sharing.
const SHARED_TABS = new Set<string>(['build', 'flow', 'settings']);

type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';
/** The owner, or someone who opened a collaborator link. */
type Access = 'owner' | ShareRole;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The survey editor. Owners open it as #/s/<id>; collaborator links as #/shared/<token>,
 * where "view" links can look and preview but not change anything, and "edit" links save
 * through the link. Every save says which stored version it builds on, so two people (or
 * two windows) can't silently overwrite each other: the second one is asked which to keep.
 */
export function Workspace({ id: idProp, shareToken, tab }: { id?: string; shareToken?: string; tab: string }) {
  const backend = useBackend();
  const toast = useToast();
  const [record, setRecord] = useState<SurveyRecord | null | undefined>(undefined);
  const [access, setAccess] = useState<Access>('owner');
  const [loadError, setLoadError] = useState<string | null>(null);
  const draft = useUndoable<Survey | null>(null);
  const survey = draft.value;
  const draftUpdate = draft.update;
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [conflict, setConflict] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  // JSON of what's stored, so undoing back to it doesn't count as a change (and other edits always save).
  const savedJson = useRef<string | null>(null);
  // The stored version (updatedAt) this copy builds on; saves fail with a conflict if it moved on.
  const baseAt = useRef<string | undefined>(undefined);
  const conflictRef = useRef(false);
  // Saves run one after another, so each one builds on the version the previous one stored.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastNudge = useRef(0);
  const id = record?.id ?? idProp ?? '';
  const viewOnly = access === 'view';

  const load = useCallback(async (): Promise<{ rec: SurveyRecord; access: Access } | null> => {
    if (shareToken) {
      const shared = await backend.getSharedSurvey(shareToken);
      return shared ? { rec: shared.record, access: shared.role } : null;
    }
    const rec = await backend.getSurvey(idProp ?? '');
    return rec ? { rec, access: 'owner' } : null;
  }, [backend, idProp, shareToken]);

  const adopt = useCallback(
    (rec: SurveyRecord) => {
      baseAt.current = rec.updatedAt;
      savedJson.current = JSON.stringify(rec.definition);
      draft.reset(rec.definition);
      setRecord(rec);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setRecord(undefined);
    load()
      .then((res) => {
        if (cancelled) return;
        if (!res) return setRecord(null);
        setAccess(res.access);
        adopt(res.rec);
      })
      .catch((e) => !cancelled && setLoadError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [load, adopt]);

  // View-only links: nothing changes; say why instead of silently ignoring the edit.
  const update: Updater<Survey> = useCallback(
    (mutate, opts) => {
      if (viewOnly) {
        if (Date.now() - lastNudge.current > 4000) {
          lastNudge.current = Date.now();
          toast('This link is view only, so nothing can be changed. Ask the owner for an edit link.', 'info');
        }
        return;
      }
      draftUpdate((s) => void (s && mutate(s)), opts);
    },
    [draftUpdate, viewOnly, toast],
  );

  const markConflict = useCallback(() => {
    conflictRef.current = true;
    setConflict(true);
    setSaveState('unsaved');
  }, []);

  const store = useCallback(
    (def: Survey, base: string | undefined) => (shareToken ? backend.saveSharedSurvey(shareToken, def, base) : backend.saveDraft(id, def, base)),
    [backend, id, shareToken],
  );

  // Autosave the working copy shortly after each change.
  useEffect(() => {
    if (!survey || viewOnly) return;
    const json = JSON.stringify(survey);
    if (json === savedJson.current) {
      if (!conflictRef.current) setSaveState('saved');
      return;
    }
    if (conflict) return;
    setSaveState('unsaved');
    const timer = setTimeout(() => {
      const run = async () => {
        if (conflictRef.current || json === savedJson.current) return;
        setSaveState('saving');
        try {
          baseAt.current = await store(survey, baseAt.current);
          savedJson.current = json;
          setSaveState('saved');
        } catch (e) {
          if (e instanceof BackendError && e.code === 'conflict') return markConflict();
          setSaveState('error');
          toast(`Couldn’t save: ${errorText(e)}`, 'error');
        }
      };
      queue.current = queue.current.then(run, run);
    }, 700);
    return () => clearTimeout(timer);
  }, [survey, viewOnly, conflict, store, markConflict, toast]);

  // Someone else saved first: take their version, or save this one over it.
  const resolve = async (keep: 'theirs' | 'mine') => {
    setResolving(true);
    try {
      await queue.current;
      if (keep === 'theirs') {
        const res = await load();
        if (!res) return setRecord(null);
        adopt(res.rec);
        setSaveState('saved');
      } else if (survey) {
        baseAt.current = await store(survey, undefined);
        savedJson.current = JSON.stringify(survey);
        setSaveState('saved');
      }
      conflictRef.current = false;
      setConflict(false);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setResolving(false);
    }
  };

  // An open preview window picks up the working copy from here and offers to restart with it.
  useEffect(() => {
    if (!survey || !id) return;
    const timer = setTimeout(() => writePreviewDraft(id, survey), 400);
    return () => clearTimeout(timer);
  }, [survey, id]);

  const openPreview = useCallback(
    (fromBlockId?: string) => {
      if (!survey || !id) return;
      writePreviewDraft(id, survey);
      const { origin, pathname } = window.location;
      // The nonce makes an already open preview window restart, even at the same block.
      const url = `${origin}${pathname}${previewHash(id, fromBlockId, Date.now().toString(36), shareToken)}`;
      const w = window.open(url, previewWindowName(id));
      if (w) w.focus();
      else toast('Your browser blocked the preview window. Allow pop-ups for this site and try again.', 'error');
    },
    [id, survey, shareToken, toast],
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
      await queue.current;
      const status = record.status === 'draft' ? 'open' : record.status;
      const rec = await backend.publish(id, survey, status, baseAt.current);
      baseAt.current = rec.updatedAt;
      savedJson.current = JSON.stringify(survey);
      setRecord(rec);
      setSaveState('saved');
      setIssues(null);
      toast(record.published ? 'Changes published' : 'Survey published. It’s accepting responses.', 'success');
    } catch (e) {
      if (e instanceof BackendError && e.code === 'conflict') {
        setIssues(null);
        markConflict();
      } else toast(`Couldn’t publish: ${errorText(e)}`, 'error');
    } finally {
      setPublishing(false);
    }
  }, [backend, id, record, survey, toast, markConflict]);

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
      const at = await backend.setStatus(id, status, baseAt.current);
      // null: someone saved in between; keep the older base so the next save notices.
      if (at) baseAt.current = at;
      setRecord({ ...record, status });
      toast(open ? 'Accepting responses again' : 'Survey closed. The link now shows a “closed” message.', 'success');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  if (loadError)
    return (
      <div className="page-narrow">
        <Empty title="This survey couldn’t be opened" action={shareToken ? undefined : <Button onClick={() => navigate('/')}>Back to surveys</Button>}>
          <p>{loadError}</p>
        </Empty>
      </div>
    );
  if (record === undefined || (record && !survey)) return <Spinner label="Opening survey" />;
  if (record === null || !survey)
    return (
      <div className="page-narrow">
        {shareToken ? (
          <Empty title="This link doesn’t work">
            <p>The owner may have turned it off, or the survey was deleted. Ask them for a new link.</p>
          </Empty>
        ) : (
          <Empty title="Survey not found" action={<Button onClick={() => navigate('/')}>Back to surveys</Button>}>
            <p>It may have been deleted, or it belongs to another account.</p>
          </Empty>
        )}
      </div>
    );

  if (record.deletedAt && !shareToken)
    return (
      <div className="page-narrow">
        <Empty
          title="This survey is in the bin"
          action={
            <div className="page-actions">
              <Button
                variant="primary"
                icon="undo"
                onClick={async () => {
                  try {
                    await backend.restoreSurvey(id);
                    const res = await load();
                    if (res) adopt(res.rec);
                    toast('Survey restored', 'success');
                  } catch (e) {
                    toast(errorText(e), 'error');
                  }
                }}
              >
                Restore it
              </Button>
              <Button onClick={() => navigate('/')}>Back to surveys</Button>
            </div>
          }
        >
          <p>Its links don’t work while it’s there. Restore it to open it again; surveys in the bin are deleted for good after {BIN_DAYS} days.</p>
        </Empty>
      </div>
    );

  const tabs = shareToken ? TABS.filter((t) => SHARED_TABS.has(t.id)) : TABS;
  const active = tabs.some((t) => t.id === tab) ? tab : 'build';
  const tabHref = (t: string) => (shareToken ? `#/shared/${encodeURIComponent(shareToken)}/${t}` : `#/s/${id}/${t}`);
  const errors = issues?.filter((i) => i.level === 'error') ?? [];

  return (
    <div className="workspace">
      <div className="ws-head">
        <div className="ws-title-row">
          {!shareToken && <IconButton icon="back" label="All surveys" onClick={() => navigate('/')} />}
          <input
            className="ws-title"
            value={survey.title}
            aria-label="Survey title"
            readOnly={viewOnly}
            onChange={(e) => update((s) => void (s.title = e.target.value), { coalesce: 'title' })}
          />
          <span className={`status-pill status-${record.status}`}>{record.status === 'draft' ? 'Draft' : record.status === 'open' ? 'Open' : 'Closed'}</span>
          {shareToken && <span className="mode-pill">{viewOnly ? 'View only' : 'Can edit'}</span>}
        </div>
        <div className="ws-actions">
          {!viewOnly && (
            <>
              <span className={`save-state save-${saveState}`} aria-live="polite">
                {conflict ? 'Not saved' : saveState === 'saved' ? 'All changes saved' : saveState === 'saving' ? 'Saving' : saveState === 'unsaved' ? 'Unsaved changes' : 'Not saved'}
              </span>
              <IconButton icon="undo" label="Undo" onClick={draft.undo} disabled={!draft.canUndo} />
              <IconButton icon="redo" label="Redo" onClick={draft.redo} disabled={!draft.canRedo} />
            </>
          )}
          <Button icon="eye" iconAfter="external" onClick={() => openPreview()} title="Opens in a new window">
            Preview
          </Button>
          {!shareToken && (
            <Button variant="primary" icon="share" onClick={publish} disabled={publishing || conflict || (!hasChanges && !!record.published)}>
              {record.published ? (hasChanges ? 'Publish changes' : 'Published') : 'Publish'}
            </Button>
          )}
        </div>
      </div>
      <nav className="tabs" aria-label="Survey sections">
        {tabs.map((t) => (
          <a key={t.id} href={tabHref(t.id)} className={`tab ${active === t.id ? 'is-active' : ''}`} aria-current={active === t.id ? 'page' : undefined}>
            {t.label}
          </a>
        ))}
      </nav>

      {conflict && (
        <div className="ws-alert" role="alert">
          <Icon name="warning" size={18} />
          <p>
            <strong>Your latest changes aren’t saved.</strong> This survey was changed somewhere else after you opened it (in another window, or by
            someone with a link). Load the latest version, or save yours over it.
          </p>
          <div className="ws-alert-actions">
            <Button size="sm" onClick={() => void resolve('theirs')} disabled={resolving}>
              Load the latest version
            </Button>
            <Button size="sm" variant="danger" onClick={() => void resolve('mine')} disabled={resolving}>
              Keep mine
            </Button>
          </div>
        </div>
      )}
      {shareToken && !conflict && (
        <div className="ws-note">
          <Icon name="info" size={16} />
          <span>
            {viewOnly
              ? 'Shared with you to view: look around and preview it. Changes aren’t possible.'
              : 'Shared with you to edit: your changes are saved to this survey. Only the owner can publish it or see responses.'}
          </span>
        </div>
      )}

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
