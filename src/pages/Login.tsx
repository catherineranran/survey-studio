import { useState } from 'react';
import { Button, Field } from '../components/ui';
import type { Backend } from '../lib/backend';

function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match. Check both and try again.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email address first, using the link Supabase sent you.';
  if (/signups not allowed|sign-ups are closed|database error saving new user/i.test(message))
    return 'New accounts can’t be created here. The owner adds accounts in the Supabase dashboard.';
  return message;
}

export function Login({ backend, allowSignup }: { backend: Backend; allowSignup: boolean }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      if (mode === 'in') await backend.signIn(email.trim(), password);
      else {
        const { needsConfirmation } = await backend.signUp(email.trim(), password);
        if (needsConfirmation) setNote('Check your inbox and open the confirmation link, then sign in here.');
      }
    } catch (e) {
      setError(friendly(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

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
        <h1>{mode === 'in' ? 'Sign in to build and analyse surveys' : 'Create the owner account'}</h1>
        <p className="hint">Only the survey owner signs in here. If you were invited to take part in a survey, open the link you received; you don’t need an account.</p>
        <Field label="Email">
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" hint={mode === 'up' ? 'At least 8 characters.' : undefined}>
          <input
            className="input"
            type="password"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            value={password}
            minLength={mode === 'up' ? 8 : undefined}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
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
        <Button variant="primary" type="submit" disabled={busy || !email || !password}>
          {busy ? 'One moment' : mode === 'in' ? 'Sign in' : 'Create account'}
        </Button>
        {allowSignup && (
          <button type="button" className="link-btn" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
            {mode === 'in' ? 'First time here? Create the owner account' : 'Already have an account? Sign in'}
          </button>
        )}
      </form>
    </div>
  );
}
