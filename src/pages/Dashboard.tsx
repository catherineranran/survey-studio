import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Empty, Field, Icon, Menu, Spinner, downloadFile, relativeTime, useConfirm, useToast } from '../components/ui';
import { BIN_DAYS } from '../lib/backend';
import { useBackend } from '../lib/backend/context';
import { forgetSurveyView } from '../lib/builderView';
import { fileSlug } from '../lib/export';
import { uuid } from '../lib/ids';
import { navigate } from '../lib/router';
import { TEMPLATES, normalizeSurvey } from '../lib/templates';
import type { SurveySummary } from '../lib/types';
import type { SignupSettings } from '../lib/backend';
import { InviteDialog } from './InviteDialog';

export function Dashboard() {
  const backend = useBackend();
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<SurveySummary[] | null>(null);
  const [bin, setBin] = useState<SurveySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [signup, setSignup] = useState<SignupSettings | null>(null);
  const [inviting, setInviting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Only admins get sign-up settings back; for everyone else the button stays hidden.
  useEffect(() => {
    if (backend.mode === 'supabase') void backend.getSignupSettings().then(setSignup);
  }, [backend]);

  const load = () => {
    setError(null);
    backend
      .listSurveys()
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    backend
      .listDeletedSurveys()
      .then(setBin)
      .catch(() => setBin([]));
  };
  useEffect(load, [backend]);

  const create = async (templateId: string, title: string) => {
    const id = uuid();
    const def = (TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0]).build(id);
    if (title.trim()) def.title = title.trim();
    try {
      await backend.createSurvey(def);
      navigate(`/s/${id}/build`);
    } catch (e) {
      toast(`Couldn’t create the survey: ${e instanceof Error ? e.message : e}`, 'error');
    }
  };

  const duplicate = async (s: SurveySummary) => {
    const rec = await backend.getSurvey(s.id);
    if (!rec) return;
    const id = uuid();
    await backend.createSurvey({ ...structuredClone(rec.definition), id, title: `${rec.title} (copy)` });
    toast('Survey duplicated. Responses aren’t copied.', 'success');
    load();
  };

  const exportDef = async (s: SurveySummary) => {
    const rec = await backend.getSurvey(s.id);
    if (rec) downloadFile(`${fileSlug(rec.title)}.survey.json`, JSON.stringify(rec.definition, null, 2), 'application/json');
  };

  const remove = async (s: SurveySummary) => {
    const ok = await confirm({
      title: `Move “${s.title}” to the bin?`,
      message: `Its links stop working while it’s in the bin. You can restore it, with its responses, for ${BIN_DAYS} days; after that it’s deleted for good.`,
      confirmLabel: 'Move to bin',
      danger: true,
    });
    if (!ok) return;
    try {
      await backend.deleteSurvey(s.id);
      toast(`“${s.title}” is in the bin. Restore it there if you need it again.`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
    load();
  };

  const restore = async (s: SurveySummary) => {
    try {
      await backend.restoreSurvey(s.id);
      toast(`“${s.title}” is back`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
    load();
  };

  const purge = async (s: SurveySummary) => {
    const ok = await confirm({
      title: `Delete “${s.title}” for good?`,
      message: s.responseCount
        ? `The survey and its ${s.responseCount} response${s.responseCount === 1 ? '' : 's'} are deleted at once and can’t be brought back. Export the data first if you need it.`
        : 'The survey is deleted at once and can’t be brought back.',
      confirmLabel: 'Delete for good',
      danger: true,
    });
    if (!ok) return;
    try {
      await backend.purgeSurvey(s.id);
      forgetSurveyView(s.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
    load();
  };

  const importFile = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text());
      const source = raw && typeof raw === 'object' && 'survey' in raw ? raw.survey : raw;
      if (!source || !Array.isArray(source.blocks)) throw new Error('This file isn’t a Survey Studio survey.');
      const id = uuid();
      const def = normalizeSurvey(source, id);
      await backend.createSurvey(def);
      toast(`Imported “${def.title}”`, 'success');
      navigate(`/s/${id}/build`);
    } catch (e) {
      toast(`Import failed: ${e instanceof Error ? e.message : e}`, 'error');
    }
  };

  return (
    <div className="page dashboard">
      <div className="page-head">
        <h1>Surveys</h1>
        <div className="page-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
          {signup && (
            <Button icon="share" onClick={() => setInviting(true)}>
              Invite people
            </Button>
          )}
          <Button icon="upload" onClick={() => fileRef.current?.click()}>
            Import
          </Button>
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            New survey
          </Button>
        </div>
      </div>

      {backend.mode === 'local' && (
        <div className="notice">
          <Icon name="info" size={18} />
          <p>
            Surveys and responses are stored in this browser. That’s enough for building, previewing and collecting answers on this device. To
            collect responses from anyone with a link, connect a free Supabase database (see the README).
          </p>
        </div>
      )}

      {error ? (
        <Empty title="Surveys couldn’t be loaded" action={<Button onClick={load}>Try again</Button>}>
          <p>{error}</p>
        </Empty>
      ) : list === null ? (
        <Spinner label="Loading surveys" />
      ) : list.length === 0 ? (
        <div className="first-run">
          <h2>Start with a template</h2>
          <p className="hint">Each one shows a different set of features. You can change everything afterwards.</p>
          <div className="template-grid">
            {TEMPLATES.map((t) => (
              <button key={t.id} type="button" className="template-card" onClick={() => create(t.id, '')}>
                <span className="template-name">{t.name}</span>
                <span className="template-desc">{t.description}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <table className="survey-table">
          <thead>
            <tr>
              <th scope="col">Survey</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">
                Responses
              </th>
              <th scope="col">Edited</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td>
                  <a className="survey-link" href={`#/s/${s.id}/build`}>
                    {s.title}
                  </a>
                  <span className="hint survey-sub">{s.publishedAt ? `Published ${relativeTime(s.publishedAt)}` : 'Not published yet'}</span>
                </td>
                <td>
                  <span className={`status-pill status-${s.status}`}>{s.status === 'draft' ? 'Draft' : s.status === 'open' ? 'Open' : 'Closed'}</span>
                </td>
                <td className="num">
                  <a href={`#/s/${s.id}/results`}>{s.responseCount}</a>
                </td>
                <td className="nowrap">{relativeTime(s.updatedAt)}</td>
                <td className="row-actions">
                  <Menu
                    label={`Actions for ${s.title}`}
                    items={[
                      { label: 'Edit', icon: 'sliders', onSelect: () => navigate(`/s/${s.id}/build`) },
                      { label: 'Results', icon: 'chart', onSelect: () => navigate(`/s/${s.id}/results`) },
                      { label: 'Share', icon: 'link', onSelect: () => navigate(`/s/${s.id}/share`) },
                      { label: 'Duplicate', icon: 'copy', onSelect: () => void duplicate(s) },
                      { label: 'Download as JSON', icon: 'download', onSelect: () => void exportDef(s) },
                      { label: 'Move to bin', icon: 'trash', danger: true, onSelect: () => void remove(s) },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {bin.length > 0 && (
        <details className="bin">
          <summary>
            <Icon name="trash" size={16} />
            <span>
              Bin <span className="bin-count">{bin.length}</span>
            </span>
            <span className="hint">Deleted surveys stay here for {BIN_DAYS} days.</span>
          </summary>
          <ul className="bin-list">
            {bin.map((s) => (
              <li key={s.id}>
                <div className="bin-text">
                  <strong>{s.title}</strong>
                  <span className="hint">
                    Deleted {s.deletedAt ? relativeTime(s.deletedAt) : ''}
                    {s.responseCount ? ` · ${s.responseCount} response${s.responseCount === 1 ? '' : 's'}` : ''}
                    {s.deletedAt ? ` · deleted for good on ${purgeDate(s.deletedAt)}` : ''}
                  </span>
                </div>
                <Button size="sm" icon="undo" onClick={() => void restore(s)}>
                  Restore
                </Button>
                <Button size="sm" variant="ghost" icon="trash" onClick={() => void purge(s)}>
                  Delete for good
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <NewSurveyDialog open={creating} onClose={() => setCreating(false)} onCreate={create} />
      {signup && <InviteDialog backend={backend} open={inviting} onClose={() => setInviting(false)} initial={signup} />}
    </div>
  );
}

/** When a survey that went into the bin at `deletedAt` is deleted for good, e.g. "14 Nov". */
function purgeDate(deletedAt: string): string {
  return new Date(Date.parse(deletedAt) + BIN_DAYS * 86_400_000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function NewSurveyDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (template: string, title: string) => void }) {
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState('blank');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New survey"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onCreate(template, title)}>
            Create survey
          </Button>
        </>
      }
    >
      <Field label="Title" hint="Respondents see it at the top of each page. You can change it later.">
        <input className="input" value={title} placeholder="Untitled survey" autoFocus onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onCreate(template, title)} />
      </Field>
      <fieldset className="template-pick">
        <legend className="field-label">Start from</legend>
        {TEMPLATES.map((t) => (
          <label key={t.id} className={`template-option ${template === t.id ? 'is-on' : ''}`}>
            <input type="radio" name="template" checked={template === t.id} onChange={() => setTemplate(t.id)} />
            <span className="mark mark-round" aria-hidden="true" />
            <span>
              <span className="template-name">{t.name}</span>
              <span className="template-desc">{t.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </Dialog>
  );
}
