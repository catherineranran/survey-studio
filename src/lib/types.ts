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
  | 'text_block'
  | 'video';

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

/** How a video question shows its video. */
export interface VideoSettings {
  /**
   * A video file on the web (.mp4, .webm, .mov), or the link to a Survey Studio video
   * folder (…/video.json), with `#k=<key>` when its files are encrypted.
   */
  src: string;
  /** 'flat': an ordinary video. 'wrap': a magic window into a picture that wraps around the viewer. */
  view: 'flat' | 'wrap';
  /** wrap: how far the picture reaches around the viewer, in degrees (140, 180, 360 …). */
  span: number;
  /** wrap: how much of it is visible at once, across, in degrees. */
  fov: number;
  /** wrap: on phones and tablets, moving the device looks around too. */
  tilt?: boolean;
}

/** What a video question records for each respondent. */
export interface VideoAnswer {
  /** Seconds of the video played, replays included. */
  sec: number;
  /** Reached the end at least once. */
  end: boolean;
  /**
   * wrap view: where the respondent looked during each second of the video, as
   * [yaw, pitch] in degrees from straight ahead (yaw > 0 right, pitch > 0 up);
   * null for seconds they didn't watch.
   */
  look?: ([number, number] | null)[];
  /** Why the video couldn't be played. Respondents can continue anyway. */
  err?: string;
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
  /** Video questions. `required` means: watched to the end. */
  video?: VideoSettings;
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

/** One branch of a randomizer: a label for the data and the blocks shown, in order. */
export interface RandomizerArm {
  id: string;
  /** Recorded in the data when a respondent gets this branch, e.g. "AI-generated video". */
  label: string;
  /** Blocks shown one after another. Empty is allowed (a "nothing shown" control). */
  blockIds: string[];
}

export interface Randomizer {
  id: string;
  /** Name of the field that stores which branch(es) a respondent got, e.g. "condition". */
  variable: string;
  arms: RandomizerArm[];
  /** How many branches each respondent gets. 1 = classic between-subjects assignment. */
  present: number;
  /** Give the least-used branch to the next respondent, keeping groups even. */
  balance: boolean;
  /** Older survey files listed single blocks here; normalizeSurvey turns them into arms. */
  blockIds?: string[];
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
  | Record<string, number>
  | VideoAnswer;

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
