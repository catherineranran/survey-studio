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
  /** Saves the working copy. Respondents don't see it until it's published. */
  saveDraft(id: string, def: Survey): Promise<string>;
  publish(id: string, def: Survey, status: SurveyStatus): Promise<SurveyRecord>;
  setStatus(id: string, status: SurveyStatus): Promise<void>;
  deleteSurvey(id: string): Promise<void>;

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

export class BackendError extends Error {
  code: 'closed' | 'limit' | 'not_found' | 'network' | 'auth' | 'storage' | 'unknown';
  constructor(message: string, code: BackendError['code'] = 'unknown') {
    super(message);
    this.code = code;
  }
}
