import type {
  PublicSurvey,
  ResponseData,
  Survey,
  SurveyRecord,
  SurveyResponse,
  SurveyStatus,
  SurveySummary,
} from '../types';

export interface AuthUser {
  id: string;
  email: string | null;
}

/** Who may create their own account: nobody, people with the invite link, or anyone. */
export type SignupMode = 'closed' | 'invite' | 'open';

export interface SignupSettings {
  mode: SignupMode;
  code: string | null;
}

/** What a collaborator link lets people do in the builder. */
export type ShareRole = 'view' | 'edit';

/** A link that opens a survey's builder for someone else, without an account. */
export interface ShareLink {
  token: string;
  role: ShareRole;
  createdAt: string;
}

/** A survey opened through a collaborator link. `record.published` is always null. */
export interface SharedSurvey {
  role: ShareRole;
  record: SurveyRecord;
}

/**
 * Everything the app needs from storage. Two implementations:
 * - local: the browser's own storage, no setup, for building and testing on one device
 * - supabase: a Postgres database, for collecting responses from anyone with the link
 */
export interface Backend {
  mode: 'local' | 'supabase';
  /** Whether the builder needs a signed-in user. */
  needsAuth: boolean;

  currentUser(): Promise<AuthUser | null>;
  onAuthChange(cb: (user: AuthUser | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, inviteCode?: string): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
  /** Public: whether the sign-in page offers "Create an account". */
  signupMode(): Promise<SignupMode>;
  /** Admins only; null for everyone else. */
  getSignupSettings(): Promise<SignupSettings | null>;
  /** Admins only. `newCode` replaces the invite code, so earlier links stop working. */
  setSignupSettings(mode: SignupMode, newCode: boolean): Promise<SignupSettings>;

  listSurveys(): Promise<SurveySummary[]>;
  getSurvey(id: string): Promise<SurveyRecord | null>;
  createSurvey(def: Survey): Promise<SurveyRecord>;
  /**
   * Saves the working copy and returns its new `updatedAt`. Respondents don't see it until
   * it's published. `base` is the `updatedAt` this copy was loaded or last saved with: if
   * someone saved in between (another window, a collaborator), nothing is written and it
   * fails with code 'conflict'. Without `base` it overwrites whatever is stored.
   */
  saveDraft(id: string, def: Survey, base?: string): Promise<string>;
  /** Same `base` rule as saveDraft. */
  publish(id: string, def: Survey, status: SurveyStatus, base?: string): Promise<SurveyRecord>;
  /**
   * Always changes the status. Returns the new `updatedAt`, or null when someone had saved
   * since `base` (so the caller keeps its older `base` and a later save still notices).
   */
  setStatus(id: string, status: SurveyStatus, base?: string): Promise<string | null>;
  deleteSurvey(id: string): Promise<void>;

  /** Owners: the collaborator links of a survey. */
  listShareLinks(surveyId: string): Promise<ShareLink[]>;
  createShareLink(surveyId: string, role: ShareRole): Promise<ShareLink>;
  /** The link stops working at once. */
  deleteShareLink(token: string): Promise<void>;
  /** Anyone with a collaborator link, signed in or not. Null for a link that doesn't (or no longer) work. */
  getSharedSurvey(token: string): Promise<SharedSurvey | null>;
  /** Edit links only. Same `base` rule as saveDraft. */
  saveSharedSurvey(token: string, def: Survey, base?: string): Promise<string>;

  /** Respondent side: the published snapshot only. */
  getPublicSurvey(id: string): Promise<PublicSurvey | null>;
  submitResponse(surveyId: string, data: ResponseData): Promise<string>;
  /** Test responses from the builder's preview, flagged as preview. */
  submitPreview(surveyId: string, data: ResponseData): Promise<string>;
  /** Completed responses per randomizer value, for balanced assignment. */
  assignmentCounts(surveyId: string, variable: string): Promise<Record<string, number>>;

  listResponses(surveyId: string): Promise<SurveyResponse[]>;
  deleteResponses(surveyId: string, ids: string[]): Promise<void>;
}

export const CONFLICT_MESSAGE = 'Someone else saved this survey in the meantime.';
export const SHARING_NEEDS_DATABASE = 'Sharing with collaborators needs the Supabase database.';

export class BackendError extends Error {
  /** 'conflict': someone else saved first. 'setup': the database needs the latest schema.sql. */
  code: 'closed' | 'limit' | 'not_found' | 'network' | 'auth' | 'storage' | 'conflict' | 'setup' | 'unknown';
  constructor(message: string, code: BackendError['code'] = 'unknown') {
    super(message);
    this.code = code;
  }
}
