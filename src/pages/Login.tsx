import { useState } from 'react';
import { Button, Field } from '../components/ui';
import type { Backend } from '../lib/backend';

export function Login({ backend }: { backend: Backend }) {
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
      setError(e instanceof Error ? e.message : String(e));
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
        <p className="hint">Respondents don’t need an account. Only you sign in, to edit surveys and see responses.</p>
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
        <button type="button" className="link-btn" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? 'First time here? Create the owner account' : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}
