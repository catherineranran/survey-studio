// Core data model for Survey Studio.
//
// A Survey is a plain JSON document: it can be exported, imported, diffed and
// committed to git. Respondents always see a *published* snapshot of it, so
// editing a live survey never changes what people are answering mid-study.

export type QuestionType =
  | 'single_choice'
  | 'multi_choice'
  | 'dropdown'
  | 'rating_scale'
  | 'matrix'
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'date'
  | 'slider'
  | 'nps'
  | 'rank'
  | 'constant_sum'
  | 'consent'
  | 'text_block';

export type Lang = 'en' | 'de';

export interface Choice {
  id: string;
  label: string;
  /** Numeric value used in exports (SPSS / R / Stata friendly). */
  code: number;
  /** Shows a text box next to the option ("Other, please specify"). */
  other?: boolean;
  /** Checkbox questions only: selecting it clears every other option ("None of these"). */
  exclusive?: boolean;
}

export type TextFormat = 'any' | 'email' | 'number' | 'url' | 'regex';

export interface Validation {
  format?: TextFormat;
  pattern?: string;
  message?: string;
  minLength?: number | null;
  maxLength?: number | null;
  min?: number | null;
  max?: number | null;
  integer?: boolean;
  minSelected?: number | null;
  maxSelected?: number | null;
  /** Constant sum target (default 100). */
  total?: number | null;
}

export interface Scale {
  min: number;
  max: number;
  step?: number;
  minLabel?: string;
  midLabel?: string;
  maxLabel?: string;
  /** Rating scale: optional label for every point, in order from min to max. */
  pointLabels?: string[];
  /** Rating scale: numbered bubbles or stars. */
  style?: 'numbers' | 'stars';
}

export type Operator =
  | 'answered'
  | 'not_answered'
  | 'is'
  | 'is_not'
  | 'includes'
  | 'excludes'
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'equals_text'
  | 'contains'
  | 'not_contains';

export interface Condition {
  id: string;
  /** A question id, or `param:NAME` for URL parameters and randomizer assignments. */
  source: string;
  /** Matrix questions: which row (statement) the condition looks at. */
  rowId?: string;
  operator: Operator;
  value?: string | number;
}

export interface Logic {
  match: 'all' | 'any';
  conditions: Condition[];
}

export interface Question {
  id: string;
  type: QuestionType;
  /** Column name in exports. Letters, digits and underscores; must be unique. */
  variable: string;
  title: string;
  description?: string;
  required: boolean;
  choices?: Choice[];
  /** Matrix statements. */
  rows?: Choice[];
  /** Matrix scale points. */
  columns?: Choice[];
  scale?: Scale;
  layout?: 'vertical' | 'horizontal';
  randomizeChoices?: boolean;
  randomizeRows?: boolean;
  validation?: Validation;
  placeholder?: string;
  displayLogic?: Logic | null;
  /** Consent: end the survey when the second option ("I do not agree") is chosen. */
  endOnDecline?: boolean;
  declineMessage?: string;
}

export interface Branch {
  id: string;
  logic: Logic;
  /** A block id, or 'end' to finish the survey. */
  target: string;
  /** Recorded as the response status when the survey ends here (e.g. "screened_out"). */
  endTag?: string;
  /** Optional message shown instead of the default end message. */
  endMessage?: string;
  /** Optional redirect for this ending (e.g. a Prolific screen-out link). Supports {{piping}}. */
  endRedirect?: string;
}

export interface Block {
  id: string;
  title: string;
  /** 'single': all questions on one page. 'each': one question per page. */
  pageMode: 'single' | 'each';
  /** Shuffle question order for each respondent. Text blocks stay in place. */
  randomizeQuestions?: boolean;
  displayLogic?: Logic | null;
  /** Skip logic, evaluated in order after the block is completed. */
  branches: Branch[];
  questions: Question[];
}

export interface Randomizer {
  id: string;
  /** Name of the field that stores which block(s) a respondent saw, e.g. "condition". */
  variable: string;
  blockIds: string[];
  /** How many of the blocks each respondent sees. 1 = classic between-subjects assignment. */
  present: number;
  /** Give the least-used option to the next respondent, keeping groups even. */
  balance: boolean;
}

export interface UrlParam {
  id: string;
  /** Query-string key, e.g. PROLIFIC_PID. Also the field name in exports, logic and piping. */
  name: string;
  /** Respondents without this parameter can't start the survey. */
  required: boolean;
}

export interface SurveySettings {
  language: Lang;
  showProgress: boolean;
  allowBack: boolean;
  numberQuestions: boolean;
  welcomeEnabled: boolean;
  welcomeTitle: string;
  welcomeText: string;
  endTitle: string;
  endMessage: string;
  /** Sends respondents here after they finish. Supports {{piping}}. */
  redirectUrl: string;
  oneResponsePerBrowser: boolean;
  saveProgress: boolean;
  responseLimit: number | null;
  /** ISO timestamp; the survey stops accepting responses after it. */
  closeAt: string | null;
  closedMessage: string;
  accent: string;
}

export interface Survey {
  schema: 1;
  id: string;
  title: string;
  blocks: Block[];
  randomizers: Randomizer[];
  urlParams: UrlParam[];
  settings: SurveySettings;
}

export type SurveyStatus = 'draft' | 'open' | 'closed';

/** What the owner works on: a working copy plus the snapshot respondents see. */
export interface SurveyRecord {
  id: string;
  title: string;
  status: SurveyStatus;
  definition: Survey;
  published: Survey | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SurveySummary {
  id: string;
  title: string;
  status: SurveyStatus;
  updatedAt: string;
  publishedAt: string | null;
  responseCount: number;
}

/** What a respondent's browser is allowed to load. */
export interface PublicSurvey {
  id: string;
  status: SurveyStatus;
  survey: Survey;
  publishedAt: string | null;
  responseCount: number;
}

export type AnswerValue =
  | string
  | number
  | boolean
  | string[]
  | Record<string, string>
  | Record<string, number>;

export interface ResponseMeta {
  /** 'complete', or the end tag of the branch that ended the survey (e.g. 'screened_out'). */
  status: string;
  startedAt: string;
  submittedAt: string;
  durationSec: number;
  /** Seconds spent on each page, keyed by page key. */
  pageTimes: Record<string, number>;
  /** Page keys on the final path, in order (pages left via Back are not included). */
  path?: string[];
  blockOrder: string[];
  seed: number;
  language: Lang;
  userAgent: string;
  preview: boolean;
  surveyVersion: string | null;
}

export interface ResponseData {
  /** Keyed by question id. */
  answers: Record<string, AnswerValue>;
  /** "Other, please specify" text, keyed by question id. */
  otherText: Record<string, string>;
  /** URL parameters and randomizer assignments. */
  embedded: Record<string, string>;
  meta: ResponseMeta;
}

export interface SurveyResponse extends ResponseData {
  id: string;
  surveyId: string;
  createdAt: string;
}
