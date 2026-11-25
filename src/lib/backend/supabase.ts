// Supabase (hosted Postgres) storage. Respondents never touch the tables directly:
// they call two database functions that only expose published surveys and only
// accept responses while a survey is open. See supabase/schema.sql.

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { shareToken } from '../ids';
import { normalizeSurvey } from '../templates';
import type { PublicSurvey, ResponseData, Survey, SurveyRecord, SurveyResponse, SurveyStatus, SurveySummary } from '../types';
import type { CompletionCodes } from '../prolific';
import { cancelled, videoLinks } from '../videoUpload';
import {
  BackendError,
  CONFLICT_MESSAGE,
  binCutoff,
  type AuthUser,
  type Backend,
  type ShareLink,
  type ShareRole,
  type SignupMode,
  type SignupSettings,
  type VideoStore,
} from './types';

/** The public bucket uploaded videos go into, one folder per owner (supabase/schema.sql makes it). */
export const VIDEO_BUCKET = 'survey-videos';
/**
 * Uploaded files never change (a new upload is a new folder), so browsers and Supabase's CDN
 * may keep them, but not much longer than a week: without Smart CDN (free plan) the CDN only
 * lets go of a deleted video's files when that time is up.
 */
const VIDEO_CACHE_SECONDS = 7 * 86400;
/** An upload counts as stalled when nothing goes out for this long. */
const UPLOAD_STALL_MS = 60000;
const VIDEOS_NEED_SETUP =
  'Video uploads need the latest database update: in Supabase, open SQL Editor and run supabase/schema.sql again (see “Videos uploaded from the builder” in the README).';

/** What a Storage API failure means for someone uploading or managing videos. Code 'network': trying again may help. */
export function storageError(status: number, body: string): BackendError {
  let msg = body;
  try {
    const j = JSON.parse(body) as { message?: string; error?: string };
    msg = j.message || j.error || body;
  } catch {
    /* plain text */
  }
  if (status === 0) return new BackendError('The connection to Supabase broke off. Check the internet connection and try again.', 'network');
  if (/bucket not found|row-level security|mime type/i.test(msg)) return new BackendError(VIDEOS_NEED_SETUP, 'setup');
  if (status === 413 || /maximum allowed size|too large/i.test(msg))
    return new BackendError('Supabase refused part of the video as too large. In Supabase, open Storage and set the survey-videos bucket’s file size limit to at least 10 MB.', 'storage');
  if (status === 402 || /quota/i.test(msg))
    return new BackendError('Your Supabase project’s storage is full (the free plan includes 1 GB). Delete videos you no longer use under Uploaded videos, or upgrade the plan.', 'storage');
  if (status === 401 || /jwt|expired|invalid.*token/i.test(msg)) return new BackendError('Your sign-in has expired. Sign in again, then try once more.', 'auth');
  if (status === 429 || status >= 500) return new BackendError(`Supabase Storage didn’t take the upload just now (${status}). Try again in a moment.`, 'network');
  return new BackendError(msg || `Supabase Storage refused this (${status}).`, 'unknown');
}

const storageFail = (e: { message?: string; status?: number; statusCode?: string | number }) =>
  /failed to fetch|networkerror|load failed/i.test(e.message ?? '')
    ? storageError(0, '')
    : storageError(Number(e.status ?? e.statusCode) || 400, JSON.stringify({ message: e.message ?? '' }));

/**
 * One file to Supabase Storage. XMLHttpRequest rather than fetch, because it reports
 * upload progress and can be cancelled; a connection that stops moving is given up.
 */
function sendFile(url: string, body: Uint8Array, headers: Record<string, string>, onProgress?: (sent: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const xhr = new XMLHttpRequest();
    let stalled = false;
    let lastSign = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastSign > UPLOAD_STALL_MS) {
        stalled = true;
        xhr.abort();
      }
    }, 5000);
    const stop = () => xhr.abort();
    const finish = () => {
      clearInterval(watchdog);
      signal?.removeEventListener('abort', stop);
    };
    xhr.open('POST', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      lastSign = Date.now();
      onProgress?.(e.loaded);
    };
    xhr.onprogress = () => (lastSign = Date.now());
    xhr.onload = () => {
      finish();
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      // A part sent again after its answer got lost is already there (same name, same content).
      if (/already exists|duplicate/i.test(xhr.responseText)) return resolve();
      reject(storageError(xhr.status, xhr.responseText));
    };
    xhr.onerror = () => {
      finish();
      reject(storageError(0, ''));
    };
    xhr.onabort = () => {
      finish();
      reject(stalled ? new BackendError('The upload stalled: nothing went through for a minute. Check the internet connection and try again.', 'network') : cancelled());
    };
    signal?.addEventListener('abort', stop, { once: true });
    xhr.send(body as BufferSource);
  });
}

interface SurveyRow {
  id: string;
  title: string;
  status: SurveyStatus;
  definition: unknown;
  published: unknown | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

interface ResponseRow {
  id: string;
  survey_id: string;
  data: ResponseData;
  is_preview: boolean;
  created_at: string;
}

interface ShareRow {
  token: string;
  role: ShareRole;
  created_at: string;
}

const toUser = (u: User | null | undefined): AuthUser | null => (u ? { id: u.id, email: u.email ?? null } : null);

function fail(error: { message?: string; code?: string } | null, fallback = 'Something went wrong talking to the database.'): never {
  const msg = error?.message ?? fallback;
  if (/^conflict$/i.test(msg)) throw new BackendError(CONFLICT_MESSAGE, 'conflict');
  if (/^not_allowed$/i.test(msg)) throw new BackendError('This link doesn’t allow editing (any more).', 'auth');
  // Tables or functions added in a later version of schema.sql.
  if (/schema cache|does not exist/i.test(msg) || /^PGRST20[0-9]$/.test(error?.code ?? ''))
    throw new BackendError('This needs the latest database update: in Supabase, open SQL Editor and run supabase/schema.sql again.', 'setup');
  if (/closed/i.test(msg)) throw new BackendError(msg, 'closed');
  if (/limit/i.test(msg)) throw new BackendError(msg, 'limit');
  if (/not_found|not found/i.test(msg)) throw new BackendError(msg, 'not_found');
  if (/jwt|auth|permission|row-level security/i.test(msg)) throw new BackendError(msg, 'auth');
  if (/fetch|network|failed to/i.test(msg)) throw new BackendError('Can’t reach the database. Check your connection.', 'network');
  throw new BackendError(msg, 'unknown');
}

function toRecord(r: SurveyRow): SurveyRecord {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    definition: normalizeSurvey(r.definition, r.id),
    published: r.published ? normalizeSurvey(r.published, r.id) : null,
    publishedAt: r.published_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

function toResponse(r: ResponseRow): SurveyResponse {
  const d = r.data ?? ({} as ResponseData);
  return {
    id: r.id,
    surveyId: r.survey_id,
    createdAt: r.created_at,
    answers: d.answers ?? {},
    otherText: d.otherText ?? {},
    embedded: d.embedded ?? {},
    // The database column is the source of truth for whether this was a test response.
    meta: { ...d.meta, preview: r.is_preview },
  };
}

type SummaryRow = Pick<SurveyRow, 'id' | 'title' | 'status' | 'updated_at' | 'published_at' | 'deleted_at'>;

export function createSupabaseBackend(url: string, anonKey: string): Backend {
  const sb: SupabaseClient = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const base = url.replace(/\/+$/, '');
  let videos: VideoStore | null = null;

  const session = async () => {
    const { data } = await sb.auth.getSession();
    const s = data.session;
    if (!s) throw new BackendError('Sign in again to upload or manage videos.', 'auth');
    return { uid: s.user.id, token: s.access_token };
  };
  const listFolder = async (prefix: string) => {
    const { data, error } = await sb.storage.from(VIDEO_BUCKET).list(prefix, { limit: 1000 });
    if (error) throw storageFail(error as { message?: string; status?: number });
    return data ?? [];
  };

  const summaries = async (rows: SummaryRow[]): Promise<SurveySummary[]> => {
    const counts = new Map<string, number>();
    const { data: c } = await sb.rpc('my_response_counts');
    for (const row of (c ?? []) as { survey_id: string; n: number }[]) counts.set(row.survey_id, Number(row.n));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      updatedAt: r.updated_at,
      publishedAt: r.published_at,
      responseCount: counts.get(r.id) ?? 0,
      deletedAt: r.deleted_at ?? null,
    }));
  };

  return {
    mode: 'supabase',
    needsAuth: true,

    async currentUser() {
      const { data } = await sb.auth.getSession();
      return toUser(data.session?.user);
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => cb(toUser(session?.user)));
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new BackendError(error.message, 'auth');
    },
    async signUp(email, password, inviteCode) {
      const redirect = window.location.origin + window.location.pathname;
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        // The database checks the code and drops it from the account.
        options: { emailRedirectTo: redirect, data: inviteCode ? { invite_code: inviteCode } : {} },
      });
      if (error) throw new BackendError(error.message, 'auth');
      return { needsConfirmation: !data.session };
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async signupMode(): Promise<SignupMode> {
      const { data, error } = await sb.rpc('signup_mode');
      if (error) return 'closed';
      return data === 'invite' || data === 'open' ? data : 'closed';
    },
    async getSignupSettings(): Promise<SignupSettings | null> {
      const { data, error } = await sb.rpc('get_signup_settings');
      if (error || !data) return null;
      const d = data as { mode: SignupMode; code: string | null };
      return { mode: d.mode, code: d.code };
    },
    async setSignupSettings(mode, newCode) {
      const { data, error } = await sb.rpc('set_signup_settings', { p_mode: mode, p_new_code: newCode });
      if (error) fail(error);
      const d = data as { mode: SignupMode; code: string | null };
      return { mode: d.mode, code: d.code };
    },

    async listSurveys(): Promise<SurveySummary[]> {
      const columns = 'id,title,status,updated_at,published_at';
      let { data, error } = await sb.from('surveys').select(columns).is('deleted_at', null).order('updated_at', { ascending: false });
      // A database from before the bin has no deleted_at column yet.
      if (error && /deleted_at/.test(error.message)) ({ data, error } = await sb.from('surveys').select(columns).order('updated_at', { ascending: false }));
      if (error) fail(error);
      return summaries((data ?? []) as SummaryRow[]);
    },
    async listDeletedSurveys(): Promise<SurveySummary[]> {
      // Deleted for good once they've been in the bin long enough.
      await sb.from('surveys').delete().lt('deleted_at', binCutoff());
      const { data, error } = await sb
        .from('surveys')
        .select('id,title,status,updated_at,published_at,deleted_at')
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false });
      if (error) {
        if (/deleted_at/.test(error.message)) return [];
        fail(error);
      }
      return summaries((data ?? []) as SummaryRow[]);
    },
    async restoreSurvey(id) {
      const { error } = await sb.from('surveys').update({ deleted_at: null }).eq('id', id);
      if (error) fail(error);
    },
    async purgeSurvey(id) {
      const { error } = await sb.from('surveys').delete().eq('id', id);
      if (error) fail(error);
    },
    async getSurvey(id) {
      const { data, error } = await sb.from('surveys').select('*').eq('id', id).maybeSingle();
      if (error) fail(error);
      return data ? toRecord(data as SurveyRow) : null;
    },
    async createSurvey(def: Survey) {
      const { data, error } = await sb.from('surveys').insert({ id: def.id, title: def.title, definition: def, status: 'draft' }).select('*').single();
      if (error) fail(error);
      return toRecord(data as SurveyRow);
    },
    async saveDraft(id, def, base) {
      let query = sb.from('surveys').update({ title: def.title, definition: def }).eq('id', id);
      if (base) query = query.eq('updated_at', base);
      const { data, error } = await query.select('updated_at').maybeSingle();
      if (error) fail(error);
      if (!data) throw base ? new BackendError(CONFLICT_MESSAGE, 'conflict') : new BackendError('This survey no longer exists.', 'not_found');
      return (data as { updated_at: string }).updated_at;
    },
    async publish(id, def, status, base) {
      let query = sb
        .from('surveys')
        .update({ title: def.title, definition: def, published: def, published_at: new Date().toISOString(), status })
        .eq('id', id);
      if (base) query = query.eq('updated_at', base);
      const { data, error } = await query.select('*').maybeSingle();
      if (error) fail(error);
      if (!data) throw base ? new BackendError(CONFLICT_MESSAGE, 'conflict') : new BackendError('This survey no longer exists.', 'not_found');
      return toRecord(data as SurveyRow);
    },
    async setStatus(id, status, base) {
      if (base) {
        const { data, error } = await sb.from('surveys').update({ status }).eq('id', id).eq('updated_at', base).select('updated_at').maybeSingle();
        if (error) fail(error);
        if (data) return (data as { updated_at: string }).updated_at;
      }
      const { data, error } = await sb.from('surveys').update({ status }).eq('id', id).select('updated_at').single();
      if (error) fail(error);
      return base ? null : (data as { updated_at: string }).updated_at;
    },
    async deleteSurvey(id) {
      const { error } = await sb.from('surveys').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) fail(error);
    },

    async listShareLinks(surveyId): Promise<ShareLink[]> {
      const { data, error } = await sb.from('survey_shares').select('token,role,created_at').eq('survey_id', surveyId).order('created_at');
      if (error) fail(error);
      return ((data ?? []) as ShareRow[]).map((r) => ({ token: r.token, role: r.role, createdAt: r.created_at }));
    },
    async createShareLink(surveyId, role) {
      const { data, error } = await sb.from('survey_shares').insert({ token: shareToken(), survey_id: surveyId, role }).select('token,role,created_at').single();
      if (error) fail(error);
      const r = data as ShareRow;
      return { token: r.token, role: r.role, createdAt: r.created_at };
    },
    async deleteShareLink(token) {
      const { error } = await sb.from('survey_shares').delete().eq('token', token);
      if (error) fail(error);
    },
    async getSharedSurvey(token) {
      const { data, error } = await sb.rpc('get_shared_survey', { p_token: token });
      if (error) fail(error);
      if (!data) return null;
      const d = data as Omit<SurveyRow, 'published'> & { role: ShareRole };
      return {
        role: d.role === 'edit' ? 'edit' : 'view',
        record: {
          id: d.id,
          title: d.title,
          status: d.status,
          definition: normalizeSurvey(d.definition, d.id),
          published: null,
          publishedAt: d.published_at,
          createdAt: d.created_at,
          updatedAt: d.updated_at,
        },
      };
    },
    async saveSharedSurvey(token, def, base) {
      const { data, error } = await sb.rpc('save_shared_survey', { p_token: token, p_definition: def, p_base: base ?? null });
      if (error) fail(error);
      return String(data);
    },

    async getPublicSurvey(id): Promise<PublicSurvey | null> {
      const { data, error } = await sb.rpc('get_public_survey', { p_id: id });
      if (error) {
        if (/invalid input syntax for type uuid/i.test(error.message)) return null;
        fail(error);
      }
      if (!data) return null;
      const d = data as { id: string; status: SurveyStatus; published: unknown; published_at: string | null; response_count: number };
      return { id: d.id, status: d.status, survey: normalizeSurvey(d.published, d.id), publishedAt: d.published_at, responseCount: Number(d.response_count) };
    },
    async submitResponse(surveyId, payload) {
      const { data, error } = await sb.rpc('submit_response', { p_survey: surveyId, p_data: payload });
      if (error) fail(error, 'Your answers couldn’t be saved.');
      return String(data);
    },
    async submitPreview(surveyId, payload) {
      const { data, error } = await sb.from('responses').insert({ survey_id: surveyId, data: payload, is_preview: true }).select('id').single();
      if (error) fail(error);
      return (data as { id: string }).id;
    },
    async assignmentCounts(surveyId, variable) {
      const { data, error } = await sb.rpc('assignment_counts', { p_survey: surveyId, p_field: variable });
      if (error) return {};
      const out: Record<string, number> = {};
      for (const row of (data ?? []) as { value: string | null; n: number }[]) if (row.value) out[row.value] = Number(row.n);
      return out;
    },

    async listResponses(surveyId) {
      // PostgREST returns at most 1,000 rows per request, so page through.
      const out: SurveyResponse[] = [];
      const page = 1000;
      for (let from = 0; ; from += page) {
        const { data, error } = await sb
          .from('responses')
          .select('id,survey_id,data,is_preview,created_at')
          .eq('survey_id', surveyId)
          .order('created_at', { ascending: true })
          .range(from, from + page - 1);
        if (error) fail(error);
        const rows = (data ?? []) as ResponseRow[];
        out.push(...rows.map(toResponse));
        if (rows.length < page) break;
      }
      return out;
    },
    async deleteResponses(surveyId, ids) {
      for (let i = 0; i < ids.length; i += 100) {
        const { error } = await sb.from('responses').delete().eq('survey_id', surveyId).in('id', ids.slice(i, i + 100));
        if (error) fail(error);
      }
    },

    // Prolific completion codes: a table of their own that only the owner can read
    // (schema.sql); respondents get their link from completion_link() after submitting.
    async getCompletionCodes(surveyId) {
      const { data, error } = await sb.from('survey_completion').select('codes').eq('survey_id', surveyId).maybeSingle();
      if (error) fail(error);
      const codes = (data as { codes?: unknown } | null)?.codes;
      return codes && typeof codes === 'object' && !Array.isArray(codes) ? (codes as CompletionCodes) : {};
    },
    async setCompletionCodes(surveyId, codes) {
      const { error } = await sb.from('survey_completion').upsert({ survey_id: surveyId, codes, updated_at: new Date().toISOString() });
      if (error) fail(error);
    },
    async completionLink(_surveyId, responseId) {
      const { data, error } = await sb.rpc('completion_link', { p_response: responseId });
      if (error) fail(error);
      return typeof data === 'string' && data.startsWith('https://') ? data : null;
    },

    // Uploaded videos: <owner id>/<upload id>/ in the public survey-videos bucket. Only the
    // owner may add, list or delete there; anyone can download through the public links,
    // but the files are encrypted and the key is only in the surveys' video links.
    videoStore() {
      videos ??= {
        where: 'online',
        async put(uploadId, name, data, type, opts) {
          const { uid, token } = await session();
          await sendFile(
            `${base}/storage/v1/object/${VIDEO_BUCKET}/${uid}/${uploadId}/${name}`,
            data,
            { authorization: `Bearer ${token}`, apikey: anonKey, 'x-upsert': 'false', 'cache-control': `max-age=${VIDEO_CACHE_SECONDS}`, 'content-type': type },
            opts?.onProgress,
            opts?.signal,
          );
        },
        async url(uploadId, name) {
          const { uid } = await session();
          return sb.storage.from(VIDEO_BUCKET).getPublicUrl(`${uid}/${uploadId}/${name}`).data.publicUrl;
        },
        async list() {
          const { uid } = await session();
          return (await listFolder(uid)).filter((f) => f.id === null).map((f) => f.name);
        },
        async remove(uploadId) {
          const { uid } = await session();
          const files = (await listFolder(`${uid}/${uploadId}`)).filter((f) => f.id !== null).map((f) => `${uid}/${uploadId}/${f.name}`);
          if (!files.length) return;
          const { error } = await sb.storage.from(VIDEO_BUCKET).remove(files);
          if (error) throw storageFail(error as { message?: string; status?: number });
        },
        async uses() {
          let { data, error } = await sb.from('surveys').select('id,title,definition,published,deleted_at');
          // A database from before the bin has no deleted_at column yet.
          if (error && /deleted_at/.test(error.message)) ({ data, error } = await sb.from('surveys').select('id,title,definition,published'));
          if (error) fail(error);
          return ((data ?? []) as SurveyRow[]).map((r) => ({
            surveyId: r.id,
            title: r.title,
            binned: !!r.deleted_at,
            links: [...videoLinks(r.definition), ...videoLinks(r.published)],
          }));
        },
      };
      return videos;
    },
  };
}
