import qrcode from 'qrcode-generator';
import { useEffect, useMemo, useState } from 'react';
import { Button, Field, Icon, Toggle, copyText, downloadFile, useConfirm, useToast } from '../components/ui';
import type { Backend, ShareLink, ShareRole } from '../lib/backend';
import { fileSlug } from '../lib/export';
import { publicSurveyUrl, sharedSurveyUrl } from '../lib/router';
import type { Survey, SurveyRecord } from '../lib/types';

const ROLES: { role: ShareRole; label: string; hint: string }[] = [
  { role: 'view', label: 'View only', hint: 'Can look through the survey and preview it, but not change it.' },
  { role: 'edit', label: 'Can edit', hint: 'Can also change questions, blocks and settings. Their changes are saved to this survey.' },
];

export function ShareTab({
  backend,
  record,
  survey,
  hasChanges,
  onPublish,
  onStatus,
}: {
  backend: Backend;
  record: SurveyRecord;
  survey: Survey;
  hasChanges: boolean;
  onPublish: () => void;
  onStatus: (open: boolean) => void;
}) {
  const toast = useToast();
  const link = publicSurveyUrl(record.id);
  const published = !!record.published;
  const qrSvg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }, [link]);

  const copy = async (text: string, what: string) => toast((await copyText(text)) ? `${what} copied` : 'Couldn’t copy. Select the text and copy it yourself.', 'success');
  const embed = `<iframe src="${link}" title="${survey.title.replace(/"/g, '&quot;')}" style="width:100%;min-height:720px;border:0"></iframe>`;
  const prolific = survey.urlParams.some((p) => p.name === 'PROLIFIC_PID')
    ? `${link}&PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}`
    : null;

  return (
    <div className="page-narrow share-page">
      {backend.mode === 'local' && (
        <div className="notice notice-warn">
          <Icon name="info" size={18} />
          <div>
            <p>
              <strong>This copy stores surveys in this browser only.</strong> The link works on this device, which is fine for testing or for
              collecting answers in person on one tablet. To collect responses from anyone, connect the free Supabase database described in the
              project’s README.
            </p>
          </div>
        </div>
      )}

      <section className="panel">
        <header className="panel-head">
          <h2>Status</h2>
        </header>
        {!published ? (
          <div className="publish-callout">
            <p>Respondents can’t open this survey until you publish it. Publishing takes a snapshot; later edits stay private until you publish again.</p>
            <Button variant="primary" icon="share" onClick={onPublish}>
              Publish survey
            </Button>
          </div>
        ) : (
          <>
            <Toggle
              label="Accepting responses"
              hint={record.status === 'open' ? 'Anyone with the link can respond.' : 'The link shows a “closed” message.'}
              checked={record.status === 'open'}
              onChange={onStatus}
            />
            {hasChanges ? (
              <div className="publish-callout">
                <p>You have changes that respondents don’t see yet.</p>
                <Button variant="primary" icon="share" onClick={onPublish}>
                  Publish changes
                </Button>
              </div>
            ) : (
              <p className="hint">Respondents see the latest version.</p>
            )}
          </>
        )}
      </section>

      <section className={`panel ${!published ? 'is-muted' : ''}`}>
        <header className="panel-head">
          <h2>Survey link</h2>
        </header>
        <div className="link-row">
          <input className="input mono" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Survey link" />
          <Button icon="copy" onClick={() => copy(link, 'Link')}>
            Copy
          </Button>
          <a className="btn btn-secondary btn-md" href={link} target="_blank" rel="noopener noreferrer">
            <Icon name="external" />
            <span>Open</span>
          </a>
        </div>
        {prolific && (
          <Field label="Study URL for Prolific" hint="Paste this into Prolific’s study link so participant IDs arrive with each response.">
            <div className="link-row">
              <input className="input mono" readOnly value={prolific} onFocus={(e) => e.target.select()} />
              <Button icon="copy" onClick={() => copy(prolific, 'Prolific link')}>
                Copy
              </Button>
            </div>
          </Field>
        )}
      </section>

      <section className={`panel share-grid ${!published ? 'is-muted' : ''}`}>
        <div>
          <header className="panel-head">
            <h2>QR code</h2>
            <p className="hint">For posters, slides and paper invitations.</p>
          </header>
          <div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <Button icon="download" size="sm" onClick={() => downloadFile(`${fileSlug(survey.title)}-qr.svg`, qrSvg, 'image/svg+xml')}>
            Download SVG
          </Button>
        </div>
        <div>
          <header className="panel-head">
            <h2>Embed in a website</h2>
            <p className="hint">Paste this HTML into a page to show the survey inline.</p>
          </header>
          <code className="code-block">{embed}</code>
          <Button icon="copy" size="sm" onClick={() => copy(embed, 'Embed code')}>
            Copy code
          </Button>
        </div>
      </section>

      {backend.mode === 'supabase' && <CollaboratorLinks backend={backend} surveyId={record.id} />}
    </div>
  );
}

/** Links that open this survey's builder for colleagues: view only, or editing. */
function CollaboratorLinks({ backend, surveyId }: { backend: Backend; surveyId: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    backend
      .listShareLinks(surveyId)
      .then((l) => !cancelled && setLinks(l))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [backend, surveyId]);

  const create = async (role: ShareRole) => {
    setBusy(true);
    try {
      const link = await backend.createShareLink(surveyId, role);
      setLinks((l) => [...(l ?? []), link]);
      toast((await copyText(sharedSurveyUrl(link.token))) ? 'Link created and copied' : 'Link created', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async (link: ShareLink) => {
    const ok = await confirm({
      title: 'Turn this link off?',
      message: 'People who have it can no longer open the survey with it. You can make a new link at any time; it will be a different one.',
      confirmLabel: 'Turn off',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await backend.deleteShareLink(link.token);
      setLinks((l) => (l ?? []).filter((x) => x.token !== link.token));
      toast('Link turned off', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (link: ShareLink) =>
    toast((await copyText(sharedSurveyUrl(link.token))) ? 'Link copied' : 'Couldn’t copy. Select the text and copy it yourself.', 'success');

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Share with collaborators</h2>
        <p className="hint">
          Links that open this survey in the builder, no account needed. Anyone with a link has its access, so share it only with people you trust.
          They can’t see responses, publish, or share the survey further.
        </p>
      </header>
      {error ? (
        <div className="notice notice-warn">
          <Icon name="warning" size={18} />
          <p>{error}</p>
        </div>
      ) : !links ? (
        <p className="hint">Loading links…</p>
      ) : (
        ROLES.map(({ role, label, hint }) => {
          const mine = links.filter((l) => l.role === role);
          return (
            <div key={role} className="collab-row">
              <div className="collab-head">
                <strong>{label}</strong>
                <span className="hint">{hint}</span>
              </div>
              {mine.map((link) => (
                <div key={link.token} className="link-row">
                  <input className="input mono" readOnly value={sharedSurveyUrl(link.token)} onFocus={(e) => e.target.select()} aria-label={`${label} link`} />
                  <Button icon="copy" onClick={() => copy(link)}>
                    Copy
                  </Button>
                  <Button icon="x" variant="ghost" onClick={() => turnOff(link)} disabled={busy}>
                    Turn off
                  </Button>
                </div>
              ))}
              {!mine.length && (
                <Button icon="link" size="sm" onClick={() => create(role)} disabled={busy}>
                  Create {role === 'view' ? 'view-only' : 'edit'} link
                </Button>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
