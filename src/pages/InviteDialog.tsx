import { useEffect, useState } from 'react';
import { Button, Dialog, Icon, copyText, useToast } from '../components/ui';
import type { Backend, SignupMode, SignupSettings } from '../lib/backend';
import { inviteUrl } from '../lib/router';

const MODES: { mode: SignupMode; label: string; hint: string }[] = [
  { mode: 'invite', label: 'People with the invite link', hint: 'Anyone you send the link to can create an account. Make a new link at any time to stop the old one working.' },
  { mode: 'open', label: 'Anyone who opens Survey Studio', hint: 'No link needed. Strangers can sign up too, and all accounts share your Supabase project’s free storage.' },
  { mode: 'closed', label: 'Nobody', hint: 'Existing accounts keep working. New ones can only be added in the Supabase dashboard.' },
];

const DONE: Record<SignupMode, string> = {
  invite: 'Sign-ups are open to people with the invite link',
  open: 'Anyone can now create an account',
  closed: 'Sign-ups are closed',
};

export function InviteDialog({ backend, open, onClose, initial }: { backend: Backend; open: boolean; onClose: () => void; initial: SignupSettings }) {
  const toast = useToast();
  const [settings, setSettings] = useState<SignupSettings>(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSettings(initial), [initial]);

  const apply = async (mode: SignupMode, newCode = false) => {
    setBusy(true);
    try {
      const next = await backend.setSignupSettings(mode, newCode);
      setSettings(next);
      toast(newCode ? 'New invite link made. The old one no longer works.' : DONE[next.mode], 'success');
    } catch (e) {
      toast(`Couldn’t change sign-ups: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const link = settings.code ? inviteUrl(settings.code) : '';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Invite people"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <p className="hint invite-intro">
        People who sign up get their own account with their own surveys and responses. They can’t see yours, and you can’t see theirs.
      </p>
      <fieldset className="template-pick" disabled={busy}>
        <legend className="field-label">Who can create an account</legend>
        {MODES.map((m) => (
          <label key={m.mode} className={`template-option ${settings.mode === m.mode ? 'is-on' : ''}`}>
            <input type="radio" name="signup-mode" checked={settings.mode === m.mode} onChange={() => void apply(m.mode)} />
            <span className="mark mark-round" aria-hidden="true" />
            <span>
              <span className="template-name">{m.label}</span>
              <span className="template-desc">{m.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {settings.mode === 'invite' && link && (
        <div className="field">
          <span className="field-label">Invite link</span>
          <div className="link-row">
            <input id="invite-link" className="input mono" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invite link" />
            <Button icon="copy" onClick={async () => toast((await copyText(link)) ? 'Invite link copied' : 'Couldn’t copy. Select the link and copy it yourself.', 'success')}>
              Copy
            </Button>
          </div>
          <button type="button" className="link-btn" disabled={busy} onClick={() => void apply('invite', true)}>
            <Icon name="undo" size={15} /> Make a new link
          </button>
        </div>
      )}
      {settings.mode !== 'closed' && (
        <p className="hint">
          Forgotten passwords can’t be reset by email yet, so ask people to keep theirs in a password manager.
        </p>
      )}
    </Dialog>
  );
}
