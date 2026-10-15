import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forgetSurveyView, readFolded, readOutlineShown, writeFolded, writeOutlineShown } from './builderView';

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
  has(k: string) {
    return this.items.has(k);
  }
}

let store: MemoryStorage;
const g = globalThis as { window?: unknown };

beforeEach(() => {
  store = new MemoryStorage();
  g.window = { localStorage: store };
});

afterEach(() => {
  delete g.window;
});

describe('folded blocks', () => {
  it('are remembered per survey; a survey never opened here has nothing remembered (so it starts folded)', () => {
    writeFolded('s1', ['b1', 'b3']);
    expect(readFolded('s1')).toEqual(['b1', 'b3']);
    expect(readFolded('s2')).toBeNull();
  });

  it('remember “everything unfolded” too, and are forgotten when the survey is deleted for good', () => {
    writeFolded('s1', ['b1']);
    writeFolded('s1', []);
    expect(readFolded('s1')).toEqual([]);
    forgetSurveyView('s1');
    expect(store.has('survey-studio.folded.s1')).toBe(false);
    expect(readFolded('s1')).toBeNull();
  });

  it('ignore whatever else is stored there', () => {
    store.setItem('survey-studio.folded.s1', 'not json');
    expect(readFolded('s1')).toBeNull();
    store.setItem('survey-studio.folded.s1', '{"b1":true}');
    expect(readFolded('s1')).toBeNull();
    store.setItem('survey-studio.folded.s1', '["b1", 3, null]');
    expect(readFolded('s1')).toEqual(['b1']);
  });

  it('still work when the browser blocks storage', () => {
    g.window = {
      get localStorage(): Storage {
        throw new Error('SecurityError');
      },
    };
    expect(readFolded('s1')).toBeNull();
    expect(() => writeFolded('s1', ['b1'])).not.toThrow();
    expect(() => forgetSurveyView('s1')).not.toThrow();
    expect(readOutlineShown()).toBe(true);
    expect(() => writeOutlineShown(false)).not.toThrow();
  });
});

describe('the outline', () => {
  it('is shown unless you hid it', () => {
    expect(readOutlineShown()).toBe(true);
    writeOutlineShown(false);
    expect(readOutlineShown()).toBe(false);
    writeOutlineShown(true);
    expect(readOutlineShown()).toBe(true);
    expect(store.has('survey-studio.outline')).toBe(false);
  });
});
