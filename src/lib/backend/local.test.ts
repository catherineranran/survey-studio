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
