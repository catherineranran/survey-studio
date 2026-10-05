import { nextVariable, uid } from './ids';
import type { Choice, Lang, Question, QuestionType, Survey } from './types';

export interface TypeInfo {
  type: QuestionType;
  label: string;
  hint: string;
  group: 'Choice' | 'Scales' | 'Text and numbers' | 'Research';
  /** Uses the `choices` list. */
  choices: boolean;
  /** Produces data (text blocks don't). */
  answerable: boolean;
}

export const TYPE_INFO: Record<QuestionType, TypeInfo> = {
  single_choice: { type: 'single_choice', label: 'Multiple choice', hint: 'Pick one option', group: 'Choice', choices: true, answerable: true },
  multi_choice: { type: 'multi_choice', label: 'Checkboxes', hint: 'Pick any number of options', group: 'Choice', choices: true, answerable: true },
  dropdown: { type: 'dropdown', label: 'Dropdown', hint: 'Pick one from a long list', group: 'Choice', choices: true, answerable: true },
  rank: { type: 'rank', label: 'Rank order', hint: 'Put options in order', group: 'Choice', choices: true, answerable: true },
  rating_scale: { type: 'rating_scale', label: 'Rating scale', hint: 'Likert item or stars', group: 'Scales', choices: false, answerable: true },
  matrix: { type: 'matrix', label: 'Matrix', hint: 'Several statements, one scale', group: 'Scales', choices: false, answerable: true },
  slider: { type: 'slider', label: 'Slider', hint: 'Continuous value on a range', group: 'Scales', choices: false, answerable: true },
  nps: { type: 'nps', label: 'Net Promoter Score', hint: '0 to 10 likelihood', group: 'Scales', choices: false, answerable: true },
  short_text: { type: 'short_text', label: 'Short text', hint: 'One line, with optional format check', group: 'Text and numbers', choices: false, answerable: true },
  long_text: { type: 'long_text', label: 'Paragraph', hint: 'Open-ended answer', group: 'Text and numbers', choices: false, answerable: true },
  number: { type: 'number', label: 'Number', hint: 'Age, counts, amounts', group: 'Text and numbers', choices: false, answerable: true },
  date: { type: 'date', label: 'Date', hint: 'Calendar date', group: 'Text and numbers', choices: false, answerable: true },
  consent: { type: 'consent', label: 'Consent', hint: 'Agree to take part, or end the survey', group: 'Research', choices: true, answerable: true },
  constant_sum: { type: 'constant_sum', label: 'Constant sum', hint: 'Split a total (e.g. 100) across options', group: 'Research', choices: true, answerable: true },
  text_block: { type: 'text_block', label: 'Text', hint: 'Instructions, vignettes, headings', group: 'Research', choices: false, answerable: false },
};

export const TYPE_GROUPS: { name: TypeInfo['group']; types: QuestionType[] }[] = [
  { name: 'Choice', types: ['single_choice', 'multi_choice', 'dropdown', 'rank'] },
  { name: 'Scales', types: ['rating_scale', 'matrix', 'slider', 'nps'] },
  { name: 'Text and numbers', types: ['short_text', 'long_text', 'number', 'date'] },
  { name: 'Research', types: ['consent', 'constant_sum', 'text_block'] },
];

export interface ScalePreset {
  id: string;
  name: string;
  labels: Record<Lang, string[]>;
}

export const SCALE_PRESETS: ScalePreset[] = [
  {
    id: 'agree5',
    name: 'Agreement, 5 points',
    labels: {
      en: ['Strongly disagree', 'Disagree', 'Neither agree nor disagree', 'Agree', 'Strongly agree'],
      de: ['Stimme überhaupt nicht zu', 'Stimme eher nicht zu', 'Weder noch', 'Stimme eher zu', 'Stimme voll und ganz zu'],
    },
  },
  {
    id: 'agree7',
    name: 'Agreement, 7 points',
    labels: {
      en: ['Strongly disagree', 'Disagree', 'Somewhat disagree', 'Neither agree nor disagree', 'Somewhat agree', 'Agree', 'Strongly agree'],
      de: ['Stimme überhaupt nicht zu', 'Stimme nicht zu', 'Stimme eher nicht zu', 'Weder noch', 'Stimme eher zu', 'Stimme zu', 'Stimme voll und ganz zu'],
    },
  },
  {
    id: 'freq5',
    name: 'Frequency, 5 points',
    labels: { en: ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'], de: ['Nie', 'Selten', 'Manchmal', 'Oft', 'Immer'] },
  },
  {
    id: 'sat5',
    name: 'Satisfaction, 5 points',
    labels: {
      en: ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'],
      de: ['Sehr unzufrieden', 'Unzufrieden', 'Neutral', 'Zufrieden', 'Sehr zufrieden'],
    },
  },
  {
    id: 'imp5',
    name: 'Importance, 5 points',
    labels: {
      en: ['Not at all important', 'Slightly important', 'Moderately important', 'Very important', 'Extremely important'],
      de: ['Überhaupt nicht wichtig', 'Wenig wichtig', 'Mittelmäßig wichtig', 'Sehr wichtig', 'Äußerst wichtig'],
    },
  },
  {
    id: 'likely5',
    name: 'Likelihood, 5 points',
    labels: {
      en: ['Very unlikely', 'Unlikely', 'Neutral', 'Likely', 'Very likely'],
      de: ['Sehr unwahrscheinlich', 'Unwahrscheinlich', 'Neutral', 'Wahrscheinlich', 'Sehr wahrscheinlich'],
    },
  },
  {
    id: 'quality5',
    name: 'Quality, 5 points',
    labels: {
      en: ['Very poor', 'Poor', 'Fair', 'Good', 'Excellent'],
      de: ['Sehr schlecht', 'Schlecht', 'Mittelmäßig', 'Gut', 'Sehr gut'],
    },
  },
];

const DEFAULT_TEXT = {
  en: {
    question: 'Untitled question',
    option: 'Option',
    statement: 'Statement',
    item: 'Item',
    agree: 'I agree to take part',
    decline: 'I do not agree',
    consentTitle: 'Do you agree to take part in this study?',
    consentText:
      'Describe the study here: its purpose, what taking part involves, how long it takes, how the data is stored, and that participation is voluntary and can be stopped at any time.',
    declineMessage: 'Thank you for your time. You can close this window now.',
    npsTitle: 'How likely are you to recommend us to a friend or colleague?',
    npsMin: 'Not at all likely',
    npsMax: 'Extremely likely',
    textTitle: 'Instructions',
    textBody: 'Write instructions, a vignette or any other text respondents should read.',
  },
  de: {
    question: 'Neue Frage',
    option: 'Option',
    statement: 'Aussage',
    item: 'Eintrag',
    agree: 'Ich stimme der Teilnahme zu',
    decline: 'Ich stimme nicht zu',
    consentTitle: 'Stimmen Sie der Teilnahme an dieser Studie zu?',
    consentText:
      'Beschreiben Sie hier die Studie: Zweck, Ablauf, Dauer, Umgang mit den Daten und dass die Teilnahme freiwillig ist und jederzeit beendet werden kann.',
    declineMessage: 'Vielen Dank für Ihre Zeit. Sie können dieses Fenster jetzt schließen.',
    npsTitle: 'Wie wahrscheinlich ist es, dass Sie uns Freunden oder Kollegen weiterempfehlen?',
    npsMin: 'Sehr unwahrscheinlich',
    npsMax: 'Sehr wahrscheinlich',
    textTitle: 'Hinweise',
    textBody: 'Schreiben Sie hier Hinweise, eine Fallvignette oder anderen Text, den die Teilnehmenden lesen sollen.',
  },
} as const;

export function defaultText(lang: Lang) {
  return DEFAULT_TEXT[lang] ?? DEFAULT_TEXT.en;
}

export function makeChoices(labels: string[], prefix = 'c', startCode = 1): Choice[] {
  return labels.map((label, i) => ({ id: uid(prefix), label, code: startCode + i }));
}

export function numbered(word: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${word} ${i + 1}`);
}

export function createQuestion(type: QuestionType, survey: Survey): Question {
  const lang = survey.settings.language;
  const t = defaultText(lang);
  const base: Question = {
    id: uid('q'),
    type,
    variable: type === 'text_block' ? '' : nextVariable(survey),
    title: t.question,
    required: false,
    displayLogic: null,
  };
  switch (type) {
    case 'single_choice':
    case 'multi_choice':
    case 'dropdown':
      return { ...base, choices: makeChoices(numbered(t.option, 3)), layout: 'vertical' };
    case 'rank':
      return { ...base, choices: makeChoices(numbered(t.item, 4)) };
    case 'constant_sum':
      return { ...base, choices: makeChoices(numbered(t.item, 3)), validation: { total: 100 } };
    case 'rating_scale': {
      const labels = SCALE_PRESETS[0].labels[lang];
      return { ...base, scale: { min: 1, max: 5, minLabel: labels[0], maxLabel: labels[4], style: 'numbers', pointLabels: [] } };
    }
    case 'matrix':
      return {
        ...base,
        rows: makeChoices(numbered(t.statement, 3), 'r'),
        columns: makeChoices(SCALE_PRESETS[0].labels[lang], 'k'),
      };
    case 'slider':
      return { ...base, scale: { min: 0, max: 100, step: 1, minLabel: '', maxLabel: '' } };
    case 'nps':
      return { ...base, title: t.npsTitle, scale: { min: 0, max: 10, minLabel: t.npsMin, maxLabel: t.npsMax } };
    case 'number':
      return { ...base, validation: { min: null, max: null, integer: false } };
    case 'short_text':
      return { ...base, validation: { format: 'any' } };
    case 'long_text':
    case 'date':
      return base;
    case 'consent':
      return {
        ...base,
        title: t.consentTitle,
        description: t.consentText,
        required: true,
        choices: [
          { id: uid('c'), label: t.agree, code: 1 },
          { id: uid('c'), label: t.decline, code: 0 },
        ],
        endOnDecline: true,
        declineMessage: t.declineMessage,
      };
    case 'text_block':
      return { ...base, title: t.textTitle, description: t.textBody };
  }
}

/** Change a question's type, keeping everything that still makes sense. */
export function convertQuestion(q: Question, type: QuestionType, survey: Survey): Question {
  if (q.type === type) return q;
  const fresh = createQuestion(type, survey);
  const next: Question = {
    ...fresh,
    id: q.id,
    variable: type === 'text_block' ? '' : q.variable || fresh.variable,
    title: q.title,
    description: q.description,
    required: type === 'text_block' ? false : type === 'consent' ? true : q.required,
    displayLogic: q.displayLogic ?? null,
  };
  const choiceTypes: QuestionType[] = ['single_choice', 'multi_choice', 'dropdown', 'rank', 'constant_sum'];
  if (choiceTypes.includes(q.type) && choiceTypes.includes(type) && q.choices?.length) {
    next.choices = q.choices.map((c) => ({
      ...c,
      other: type === 'single_choice' || type === 'multi_choice' ? c.other : undefined,
      exclusive: type === 'multi_choice' ? c.exclusive : undefined,
    }));
  }
  if (q.type === 'rating_scale' && type === 'matrix' && q.scale) {
    const labels = q.scale.pointLabels?.length ? q.scale.pointLabels : null;
    const cols: Choice[] = [];
    for (let v = q.scale.min, i = 0; v <= q.scale.max; v++, i++) {
      const label = labels?.[i] || (v === q.scale.min ? q.scale.minLabel : v === q.scale.max ? q.scale.maxLabel : '') || String(v);
      cols.push({ id: uid('k'), label, code: v });
    }
    next.columns = cols;
  }
  if (q.type === 'matrix' && type === 'rating_scale' && q.columns?.length) {
    const codes = q.columns.map((c) => c.code);
    next.scale = {
      min: Math.min(...codes),
      max: Math.max(...codes),
      minLabel: q.columns[0].label,
      maxLabel: q.columns[q.columns.length - 1].label,
      pointLabels: q.columns.map((c) => c.label),
      style: 'numbers',
    };
  }
  if (type === 'text_block' && !next.description) next.description = '';
  return next;
}

/** A fresh copy of a question with new ids (used by "Duplicate"). */
export function cloneQuestion(q: Question, survey: Survey): Question {
  const copy: Question = JSON.parse(JSON.stringify(q));
  copy.id = uid('q');
  copy.variable = q.type === 'text_block' ? '' : nextVariable(survey);
  const remap = (list?: Choice[], prefix = 'c') => list?.map((c) => ({ ...c, id: uid(prefix) }));
  copy.choices = remap(copy.choices);
  copy.rows = remap(copy.rows, 'r');
  copy.columns = remap(copy.columns, 'k');
  return copy;
}

export function scalePoints(q: Question): { value: number; label: string }[] {
  const s = q.scale;
  if (!s) return [];
  const pts: { value: number; label: string }[] = [];
  const count = Math.max(0, Math.min(101, Math.floor(s.max - s.min) + 1));
  for (let i = 0; i < count; i++) {
    const v = s.min + i;
    pts.push({ value: v, label: s.pointLabels?.[i] || '' });
  }
  return pts;
}
