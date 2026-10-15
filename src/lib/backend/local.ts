// Browser-only storage. Surveys and responses live in this browser's localStorage,
// so a survey link only works on this device. Good for building, testing and
// in-person data collection on one tablet; use Supabase to collect from anyone.

import { uuid } from '../ids';
import { normalizeSurvey } from '../templates';
import type { PublicSurvey, ResponseData, Survey, SurveyRecord, SurveyResponse, SurveyStatus, SurveySummary } from '../types';
import { BackendError, CONFLICT_MESSAGE, SHARING_NEEDS_DATABASE, binCutoff, type Backend } from './types';

const SURVEYS_KEY = 'survey-studio.surveys.v1';
const responsesKey = (id: string) => `survey-studio.responses.v1.${id}`;

// Some embedded browsers block storage; fall back to memory so the app still works.
const memory = new Map<string, string>();
const store = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      if (e instanceof DOMException && /quota/i.test(e.name + e.message)) {
        throw new BackendError('This browser’s storage is full. Export and delete old responses, or connect Supabase.', 'storage');
      }
      memory.set(key, value);
    }
  },
  remove(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      memory.delete(key);
    }
  },
};

function readJSON<T>(key: string, fallback: T): T {
  const raw = store.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const now = () => new Date().toISOString();
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function createLocalBackend(): Backend {
  const all = (): SurveyRecord[] => readJSON<SurveyRecord[]>(SURVEYS_KEY, []);
  const saveAll = (list: SurveyRecord[]) => store.set(SURVEYS_KEY, JSON.stringify(list));
  const responses = (id: string): SurveyResponse[] => readJSON<SurveyResponse[]>(responsesKey(id), []);
  const update = (id: string, fn: (r: SurveyRecord) => void): SurveyRecord => {
    const list = all();
    const rec = list.find((r) => r.id === id);
    if (!rec) throw new BackendError('This survey no longer exists.', 'not_found');
    fn(rec);
    rec.updatedAt = now();
    saveAll(list);
    return clone(rec);
  };
  const summary = (r: SurveyRecord): SurveySummary => ({
    id: r.id,
    title: r.title,
    status: r.status,
    updatedAt: r.updatedAt,
    publishedAt: r.publishedAt,
    responseCount: responses(r.id).filter((x) => !x.meta?.preview).length,
    deletedAt: r.deletedAt ?? null,
  });
  const purge = (id: string) => {
    saveAll(all().filter((r) => r.id !== id));
    store.remove(responsesKey(id));
  };
  // Another window of this browser may have saved since this copy was loaded.
  const checkBase = (id: string, base?: string) => {
    const rec = all().find((r) => r.id === id);
    if (rec && base && rec.updatedAt !== base) throw new BackendError(CONFLICT_MESSAGE, 'conflict');
  };
  const insertResponse = (surveyId: string, data: ResponseData): string => {
    const id = uuid();
    const list = responses(surveyId);
    list.push({ ...clone(data), id, surveyId, createdAt: now() });
    store.set(responsesKey(surveyId), JSON.stringify(list));
    return id;
  };

  return {
    mode: 'local',
    needsAuth: false,
    async currentUser() {
      return { id: 'local', email: null };
    },
    onAuthChange() {
      return () => {};
    },
    async signIn() {},
    async signUp() {
      return { needsConfirmation: false };
    },
    async signOut() {},
    async signupMode() {
      return 'closed';
    },
    async getSignupSettings() {
      return null;
    },
    async setSignupSettings() {
      throw new BackendError('Sign-ups need the Supabase database.', 'storage');
    },

    async listSurveys(): Promise<SurveySummary[]> {
      return all()
        .filter((r) => !r.deletedAt)
        .map(summary)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    },
    async listDeletedSurveys(): Promise<SurveySummary[]> {
      const cutoff = binCutoff();
      for (const r of all()) if (r.deletedAt && r.deletedAt < cutoff) purge(r.id);
      return all()
        .filter((r) => r.deletedAt)
        .map(summary)
        .sort((a, b) => ((a.deletedAt ?? '') < (b.deletedAt ?? '') ? 1 : -1));
    },
    async restoreSurvey(id) {
      update(id, (r) => {
        r.deletedAt = null;
      });
    },
    async purgeSurvey(id) {
      purge(id);
    },
    async getSurvey(id) {
      const rec = all().find((r) => r.id === id);
      if (!rec) return null;
      return { ...clone(rec), definition: normalizeSurvey(rec.definition, rec.id), published: rec.published ? normalizeSurvey(rec.published, rec.id) : null };
    },
    async createSurvey(def: Survey) {
      const list = all();
      const rec: SurveyRecord = {
        id: def.id,
        title: def.title,
        status: 'draft',
        definition: clone(def),
        published: null,
        publishedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      list.push(rec);
      saveAll(list);
      return clone(rec);
    },
    async saveDraft(id, def, base) {
      checkBase(id, base);
      return update(id, (r) => {
        r.definition = clone(def);
        r.title = def.title;
      }).updatedAt;
    },
    async publish(id, def, status, base) {
      checkBase(id, base);
      return update(id, (r) => {
        r.definition = clone(def);
        r.published = clone(def);
        r.publishedAt = now();
        r.title = def.title;
        r.status = status;
      });
    },
    async setStatus(id, status: SurveyStatus, base) {
      const current = !base || all().find((r) => r.id === id)?.updatedAt === base;
      const at = update(id, (r) => {
        r.status = status;
      }).updatedAt;
      return current ? at : null;
    },
    async deleteSurvey(id) {
      update(id, (r) => {
        r.deletedAt = now();
      });
    },

    // Collaborator links need a database other people can reach.
    async listShareLinks() {
      return [];
    },
    async createShareLink() {
      throw new BackendError(SHARING_NEEDS_DATABASE, 'storage');
    },
    async deleteShareLink() {},
    async getSharedSurvey() {
      return null;
    },
    async saveSharedSurvey() {
      throw new BackendError(SHARING_NEEDS_DATABASE, 'storage');
    },

    async getPublicSurvey(id): Promise<PublicSurvey | null> {
      const rec = all().find((r) => r.id === id);
      if (!rec || !rec.published || rec.deletedAt) return null;
      return {
        id: rec.id,
        status: rec.status,
        survey: normalizeSurvey(rec.published, rec.id),
        publishedAt: rec.publishedAt,
        responseCount: responses(id).filter((x) => !x.meta?.preview).length,
      };
    },
    async submitResponse(surveyId, data) {
      const rec = all().find((r) => r.id === surveyId);
      if (!rec || !rec.published || rec.deletedAt) throw new BackendError('Survey not found', 'not_found');
      if (rec.status !== 'open') throw new BackendError('Survey is closed', 'closed');
      const s = rec.published.settings;
      if (s.closeAt && new Date(s.closeAt).getTime() < Date.now()) throw new BackendError('Survey is closed', 'closed');
      if (s.responseLimit && responses(surveyId).filter((x) => !x.meta?.preview).length >= s.responseLimit)
        throw new BackendError('Response limit reached', 'limit');
      return insertResponse(surveyId, { ...data, meta: { ...data.meta, preview: false } });
    },
    async submitPreview(surveyId, data) {
      return insertResponse(surveyId, { ...data, meta: { ...data.meta, preview: true } });
    },
    async assignmentCounts(surveyId, variable) {
      const out: Record<string, number> = {};
      for (const r of responses(surveyId)) {
        if (r.meta?.preview) continue;
        const v = r.embedded?.[variable];
        if (v) out[v] = (out[v] ?? 0) + 1;
      }
      return out;
    },

    async listResponses(surveyId) {
      return responses(surveyId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    },
    async deleteResponses(surveyId, ids) {
      const drop = new Set(ids);
      store.set(responsesKey(surveyId), JSON.stringify(responses(surveyId).filter((r) => !drop.has(r.id))));
    },
  };
}
