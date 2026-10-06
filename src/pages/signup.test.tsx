import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Backend } from '../lib/backend';
import { InviteDialog } from './InviteDialog';
import { Login } from './Login';

const fake = {
  mode: 'supabase',
  needsAuth: true,
  signupMode: async () => 'invite',
  setSignupSettings: async (mode: string) => ({ mode, code: 'abc123' }),
} as unknown as Backend;

beforeAll(() => {
  (globalThis as { window?: unknown }).window = { location: { origin: 'https://ranranli.net', pathname: '/survey-studio/', search: '?invite=abc123', href: '' } };
});

describe('sign-up screens', () => {
  it('an invite link opens the sign-up form', () => {
    const html = renderToStaticMarkup(<Login backend={fake} />);
    expect(html).toContain('Email');
    expect(html).toContain('Password');
  });

  it('the invite dialog shows the link with the code', () => {
    const html = renderToStaticMarkup(<InviteDialog backend={fake} open onClose={() => {}} initial={{ mode: 'invite', code: 'abc123' }} />);
    expect(html).toContain('https://ranranli.net/survey-studio/?invite=abc123');
    expect(html).toContain('People with the invite link');
    expect(html).toContain('Make a new link');
  });

  it('no link is shown when sign-ups are closed', () => {
    const html = renderToStaticMarkup(<InviteDialog backend={fake} open onClose={() => {}} initial={{ mode: 'closed', code: 'abc123' }} />);
    expect(html).not.toContain('?invite=');
  });
});
