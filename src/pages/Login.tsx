import { useEffect, useState } from 'react';
import { Button, Field } from '../components/ui';
import type { Backend, SignupMode } from '../lib/backend';

function friendly(message: string, mode: SignupMode): string {
  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match. Check both and try again.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email address first, using the link in the email you received.';
  if (/already registered|already been registered|user already exists/i.test(message)) return 'There’s already an account with this email. Sign in instead.';
  if (/password should be at least|weak password/i.test(message)) return 'Choose a longer password: at least 8 characters.';
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Wait a minute, then try again.';
  if (/is invalid|invalid email|unable to validate email/i.test(message)) return 'Check the email address: it doesn’t look valid.';
  if (/signups not allowed|sign-ups are closed|invite link|database error saving new user/i.test(message))
    return mode === 'invite'
      ? 'This invite link or code isn’t valid any more. Ask the person who invited you for a new one.'
      : 'New accounts can’t be created right now.';
  return message;
}

/** The invite code from a link like …/survey-studio/?invite=abc123 */
function inviteFromUrl(): string {
  return new URLSearchParams(window.location.search).get('invite')?.trim() ?? '';
}

function dropInviteFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('invite')) return;
  url.searchParams.delete('invite');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

export function Login({ backend }: { backend: Backend }) {
  const linkCode = inviteFromUrl();
  const [signupMode, setSignupMode] = useState<SignupMode | null>(null);
  const [mode, setMode] = useState<'in' | 'up'>(linkCode ? 'up' : 'in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState(linkCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void backend.signupMode().then(setSignupMode);
  }, [backend]);

  const canSignUp = signupMode === 'invite' || signupMode === 'open';
  const signingUp = mode === 'up' && canSignUp;
  const linkClosed = linkCode !== '' && signupMode === 'closed';

  const submit = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      if (!signingUp) {
        await backend.signIn(email.trim(), password);
      } else {
        const { needsConfirmation } = await backend.signUp(email.trim(), password, signupMode === 'invite' ? code.trim() : undefined);
        if (needsConfirmation) setNote('Check your inbox and open the confirmation link, then sign in here.');
      }
      dropInviteFromUrl();
    } catch (e) {
      setError(friendly(e instanceof Error ? e.message : String(e), signupMode ?? 'closed'));
    } finally {
      setBusy(false);
    }
  };

  const tooShort = signingUp && password.length > 0 && password.length < 8;

  return (
    <div className="login">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="brand brand-lg">
          <span className="brand-mark" aria-hidden="true" />
          <span>Survey Studio</span>
        </div>
        <h1>{signingUp ? 'Create your account' : 'Sign in to build and analyse surveys'}</h1>
        <p className="hint">
          {signingUp
            ? 'Your account gets its own surveys and responses; nobody else can see them.'
            : 'If you were invited to take part in a survey, open the link you received. You don’t need an account for that.'}
        </p>
        {linkClosed && (
          <p className="notice" role="status">
            This invite link isn’t active right now. Ask the person who sent it for a new one, or sign in if you already have an account.
          </p>
        )}
        <Field label="Email" htmlFor="login-email">
          <input id="login-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field
          label="Password"
          htmlFor="login-password"
          error={tooShort ? 'Use at least 8 characters.' : null}
          hint={signingUp ? 'At least 8 characters. Keep it in a password manager: forgotten passwords can’t be reset yet.' : undefined}
        >
          <input
            id="login-password"
            className="input"
            type="password"
            autoComplete={signingUp ? 'new-password' : 'current-password'}
            value={password}
            minLength={signingUp ? 8 : undefined}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {signingUp && signupMode === 'invite' && !linkCode && (
          <Field label="Invite code" htmlFor="login-code" hint="It’s the part after “invite=” in the link you were sent.">
            <input id="login-code" className="input mono" value={code} autoComplete="off" spellCheck={false} onChange={(e) => setCode(e.target.value)} required />
          </Field>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {note && (
          <p className="notice" role="status">
            {note}
          </p>
        )}
        <Button variant="primary" type="submit" disabled={busy || !email || !password || tooShort || (signingUp && signupMode === 'invite' && !code.trim())}>
          {busy ? 'One moment' : signingUp ? 'Create account' : 'Sign in'}
        </Button>
        {canSignUp && (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setMode(signingUp ? 'in' : 'up');
              setError(null);
            }}
          >
            {signingUp ? 'Already have an account? Sign in' : signupMode === 'invite' ? 'Have an invite? Create an account' : 'New here? Create an account'}
          </button>
        )}
      </form>
    </div>
  );
}
