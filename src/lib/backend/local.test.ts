import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shareToken } from '../ids';
import { previewHash } from '../preview';
import { blankSurvey } from '../templates';
import { createLocalBackend } from './local';
import { BackendError } from './types';

class MemoryStorage {
  private items = new Map<string, string>();
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, String(v));
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
}

const g = globalThis as { window?: unknown };

beforeEach(() => {
  g.window = { localStorage: new MemoryStorage() };
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  delete g.window;
});

const tick = () => vi.advanceTimersByTime(1000);

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof BackendError ? e.code : 'other';
  }
};

describe('saving builds on the version that was loaded', () => {
  it('a save based on an older version is refused, not written', async () => {
    const backend = createLocalBackend();
    const rec = await backend.createSurvey(blankSurvey('s1', 'First'));
    tick();
    // Window A saves; window B still has the version it opened.
    const a = await backend.saveDraft('s1', { ...rec.definition, title: 'From A' }, rec.updatedAt);
    expect(a).not.toBe(rec.updatedAt);
    tick();
    expect(await codeOf(backend.saveDraft('s1', { ...rec.definition, title: 'From B' }, rec.updatedAt))).toBe('conflict');
    expect((await backend.getSurvey('s1'))?.title).toBe('From A');
    // B can still choose to overwrite.
    await backend.saveDraft('s1', { ...rec.definition, title: 'From B' });
    expect((await backend.getSurvey('s1'))?.title).toBe('From B');
  });

  it('publishing checks the version too', async () => {
    const backend = createLocalBackend();
    const rec = await backend.createSurvey(blankSurvey('s2'));
    tick();
    await backend.saveDraft('s2', { ...rec.definition, title: 'Newer' }, rec.updatedAt);
    tick();
    expect(await codeOf(backend.publish('s2', rec.definition, 'open', rec.updatedAt))).toBe('conflict');
    expect((await backend.getSurvey('s2'))?.published).toBeNull();
  });

  it('a status change always applies, but only moves the base on when nothing else changed', async () => {
    const backend = createLocalBackend();
    const rec = await backend.createSurvey(blankSurvey('s3'));
    tick();
    const at = await backend.setStatus('s3', 'closed', rec.updatedAt);
    expect(at).toBeTruthy();
    tick();
    await backend.saveDraft('s3', { ...rec.definition, title: 'Elsewhere' }, at!);
    tick();
    expect(await backend.setStatus('s3', 'open', at!)).toBeNull();
    expect((await backend.getSurvey('s3'))?.status).toBe('open');
    // The stale base still catches the other save.
    expect(await codeOf(backend.saveDraft('s3', rec.definition, at!))).toBe('conflict');
  });
});

describe('collaborator links', () => {
  it('tokens are long, URL-safe and different every time', () => {
    const tokens = new Set(Array.from({ length: 50 }, shareToken));
    expect(tokens.size).toBe(50);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('a shared preview goes through the link', () => {
    expect(previewHash('abc', 'b1', 'n', 'TOKEN')).toBe('#/shared/TOKEN/preview?from=b1&t=n');
    expect(previewHash('abc', 'b1')).toBe('#/s/abc/preview?from=b1');
  });

  it('browser storage can’t share', async () => {
    const backend = createLocalBackend();
    await backend.createSurvey(blankSurvey('s4'));
    expect(await backend.listShareLinks('s4')).toEqual([]);
    expect(await codeOf(backend.createShareLink('s4', 'view'))).toBe('storage');
    expect(await backend.getSharedSurvey('anything')).toBeNull();
  });
});

describe('the bin', () => {
  it('a deleted survey leaves the list, stops working for respondents, and comes back intact', async () => {
    const backend = createLocalBackend();
    const rec = await backend.createSurvey(blankSurvey('b1', 'Study'));
    await backend.publish('b1', rec.definition, 'open');
    await backend.deleteSurvey('b1');
    expect((await backend.listSurveys()).map((s) => s.id)).toEqual([]);
    expect((await backend.listDeletedSurveys()).map((s) => s.id)).toEqual(['b1']);
    expect(await backend.getPublicSurvey('b1')).toBeNull();
    expect(await codeOf(backend.submitResponse('b1', { answers: {}, otherText: {}, embedded: {}, meta: {} as never }))).toBe('not_found');
    expect((await backend.getSurvey('b1'))?.deletedAt).toBeTruthy();

    await backend.restoreSurvey('b1');
    expect((await backend.listSurveys()).map((s) => s.id)).toEqual(['b1']);
    expect(await backend.listDeletedSurveys()).toEqual([]);
    expect((await backend.getPublicSurvey('b1'))?.survey.title).toBe('Study');
  });

  it('deleting for good removes the survey and its responses', async () => {
    const backend = createLocalBackend();
    await backend.createSurvey(blankSurvey('b2'));
    await backend.submitPreview('b2', { answers: {}, otherText: {}, embedded: {}, meta: {} as never });
    await backend.deleteSurvey('b2');
    await backend.purgeSurvey('b2');
    expect(await backend.listDeletedSurveys()).toEqual([]);
    expect(await backend.getSurvey('b2')).toBeNull();
    expect(await backend.listResponses('b2')).toEqual([]);
  });

  it('surveys are deleted for good after 30 days in the bin', async () => {
    const backend = createLocalBackend();
    await backend.createSurvey(blankSurvey('old'));
    await backend.createSurvey(blankSurvey('recent'));
    await backend.deleteSurvey('old');
    vi.advanceTimersByTime(20 * 86_400_000);
    await backend.deleteSurvey('recent');
    vi.advanceTimersByTime(11 * 86_400_000);
    expect((await backend.listDeletedSurveys()).map((s) => s.id)).toEqual(['recent']);
    expect(await backend.getSurvey('old')).toBeNull();
  });
});

describe('Prolific completion codes', () => {
  const response = (status: string) => ({ answers: {}, otherText: {}, embedded: { PROLIFIC_PID: 'p1' }, meta: { status } as never });

  it('are kept apart from the survey and give each stored response the link for its ending', async () => {
    const backend = createLocalBackend();
    const rec = await backend.createSurvey(blankSurvey('pc1', 'Study'));
    await backend.publish('pc1', rec.definition, 'open');
    expect(await backend.getCompletionCodes('pc1')).toEqual({});
    await backend.setCompletionCodes('pc1', { complete: 'C1AB2CD3', declined_consent: 'DATA0OUT' });
    expect(await backend.getCompletionCodes('pc1')).toEqual({ complete: 'C1AB2CD3', declined_consent: 'DATA0OUT' });
    // Not in anything respondents load.
    expect(JSON.stringify(await backend.getPublicSurvey('pc1'))).not.toContain('C1AB2CD3');

    const done = await backend.submitResponse('pc1', response('complete'));
    const declined = await backend.submitResponse('pc1', response('declined_consent'));
    const other = await backend.submitResponse('pc1', response('screened_out'));
    expect(await backend.completionLink('pc1', done)).toBe('https://app.prolific.com/submissions/complete?cc=C1AB2CD3');
    expect(await backend.completionLink('pc1', declined)).toBe('https://app.prolific.com/submissions/complete?cc=DATA0OUT');
    expect(await backend.completionLink('pc1', other)).toBeNull();
    expect(await backend.completionLink('pc1', 'no-such-response')).toBeNull();
    // Test responses from the preview never get one.
    const preview = await backend.submitPreview('pc1', { ...response('complete'), meta: { status: 'complete', preview: true } as never });
    expect(await backend.completionLink('pc1', preview)).toBeNull();
  });

  it('stop working in the bin and go when the survey is deleted for good', async () => {
    const backend = createLocalBackend();
    const rec = await backend.createSurvey(blankSurvey('pc2'));
    await backend.publish('pc2', rec.definition, 'open');
    await backend.setCompletionCodes('pc2', { complete: 'C1AB2CD3' });
    const id = await backend.submitResponse('pc2', response('complete'));
    await backend.deleteSurvey('pc2');
    expect(await backend.completionLink('pc2', id)).toBeNull();
    await backend.purgeSurvey('pc2');
    expect(await backend.getCompletionCodes('pc2')).toEqual({});
    expect(await codeOf(backend.setCompletionCodes('pc2', { complete: 'X' }))).toBe('not_found');
  });
});
