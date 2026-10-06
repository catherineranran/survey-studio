// Supabase (hosted Postgres) storage. Respondents never touch the tables directly:
// they call two database functions that only expose published surveys and only
// accept responses while a survey is open. See supabase/schema.sql.

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { normalizeSurvey } from '../templates';
import type { PublicSurvey, ResponseData, Survey, SurveyRecord, SurveyResponse, SurveyStatus, SurveySummary } from '../types';
import { BackendError, type AuthUser, type Backend, type SignupMode, type SignupSettings } from './types';

interface SurveyRow {
  id: string;
  title: string;
  status: SurveyStatus;
  definition: unknown;
  published: unknown | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ResponseRow {
  id: string;
  survey_id: string;
  data: ResponseData;
  is_preview: boolean;
  created_at: string;
}

const toUser = (u: User | null | undefined): AuthUser | null => (u ? { id: u.id, email: u.email ?? null } : null);

function fail(error: { message?: string; code?: string } | null, fallback = 'Something went wrong talking to the database.'): never {
  const msg = error?.message ?? fallback;
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

export function createSupabaseBackend(url: string, anonKey: string): Backend {
  const sb: SupabaseClient = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

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
      const { data, error } = await sb.from('surveys').select('id,title,status,updated_at,published_at').order('updated_at', { ascending: false });
      if (error) fail(error);
      const counts = new Map<string, number>();
      const { data: c } = await sb.rpc('my_response_counts');
      for (const row of (c ?? []) as { survey_id: string; n: number }[]) counts.set(row.survey_id, Number(row.n));
      return (data ?? []).map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        updatedAt: r.updated_at,
        publishedAt: r.published_at,
        responseCount: counts.get(r.id) ?? 0,
      }));
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
    async saveDraft(id, def) {
      const { data, error } = await sb.from('surveys').update({ title: def.title, definition: def }).eq('id', id).select('updated_at').single();
      if (error) fail(error);
      return (data as { updated_at: string }).updated_at;
    },
    async publish(id, def, status) {
      const { data, error } = await sb
        .from('surveys')
        .update({ title: def.title, definition: def, published: def, published_at: new Date().toISOString(), status })
        .eq('id', id)
        .select('*')
        .single();
      if (error) fail(error);
      return toRecord(data as SurveyRow);
    },
    async setStatus(id, status) {
      const { error } = await sb.from('surveys').update({ status }).eq('id', id);
      if (error) fail(error);
    },
    async deleteSurvey(id) {
      const { error } = await sb.from('surveys').delete().eq('id', id);
      if (error) fail(error);
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
  };
}
