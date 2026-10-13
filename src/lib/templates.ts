// Starting points. Each template also demonstrates features: consent screening,
// display logic, skip logic, randomized conditions, piping and URL parameters.

import { uid } from './ids';
import { SCALE_PRESETS, defaultText, makeChoices } from './questionTypes';
import { tidy } from './flow';
import type { Block, Lang, Question, Randomizer, RandomizerArm, Survey, SurveySettings } from './types';

export const ACCENTS = [
  { name: 'Form green', value: '#136f55' },
  { name: 'Ink blue', value: '#1f4e8c' },
  { name: 'Teal', value: '#0f6a7a' },
  { name: 'Plum', value: '#7a3e72' },
  { name: 'Ochre', value: '#8a5a00' },
  { name: 'Graphite', value: '#3b4148' },
];

export function defaultSettings(lang: Lang = 'en'): SurveySettings {
  return {
    language: lang,
    showProgress: true,
    allowBack: true,
    numberQuestions: false,
    welcomeEnabled: false,
    welcomeTitle: '',
    welcomeText: '',
    endTitle: '',
    endMessage: '',
    redirectUrl: '',
    oneResponsePerBrowser: false,
    saveProgress: true,
    responseLimit: null,
    closeAt: null,
    closedMessage: '',
    accent: ACCENTS[0].value,
    textScale: 1,
    textColor: '',
  };
}

export function newBlock(survey: Pick<Survey, 'blocks'>, title?: string): Block {
  return {
    id: uid('b'),
    title: title ?? `Block ${survey.blocks.length + 1}`,
    pageMode: 'single',
    randomizeQuestions: false,
    displayLogic: null,
    branches: [],
    questions: [],
  };
}

export function blankSurvey(id: string, title = 'Untitled survey'): Survey {
  const survey: Survey = { schema: 1, id, title, blocks: [], randomizers: [], urlParams: [], settings: defaultSettings('en') };
  const block = newBlock(survey);
  block.questions.push({
    id: uid('q'),
    type: 'single_choice',
    variable: 'Q1',
    title: 'Untitled question',
    required: false,
    choices: makeChoices(['Option 1', 'Option 2', 'Option 3']),
    layout: 'vertical',
    displayLogic: null,
  });
  survey.blocks.push(block);
  return survey;
}

/* ----------------------------------------------------------- small helpers */

const q = (type: Question['type'], variable: string, title: string, extra: Partial<Question> = {}): Question => ({
  id: uid('q'),
  type,
  variable,
  title,
  required: false,
  displayLogic: null,
  ...extra,
});

const block = (title: string, questions: Question[], extra: Partial<Block> = {}): Block => ({
  id: uid('b'),
  title,
  pageMode: 'single',
  randomizeQuestions: false,
  displayLogic: null,
  branches: [],
  questions,
  ...extra,
});

function consentQuestion(): Question {
  const t = defaultText('en');
  return q('consent', 'consent', t.consentTitle, {
    description:
      'This study is run by the research team named below. It takes about 5 minutes. Your answers are stored without your name and used for research only. Taking part is voluntary, and you can stop at any time by closing this window.\n\nQuestions? Contact the research team at research@example.org.',
    required: true,
    choices: [
      { id: uid('c'), label: t.agree, code: 1 },
      { id: uid('c'), label: t.decline, code: 0 },
    ],
    endOnDecline: true,
    declineMessage: t.declineMessage,
  });
}

/* -------------------------------------------------------------- templates */

function researchStudy(id: string): Survey {
  const gender = q('single_choice', 'gender', 'What is your gender?', {
    required: true,
    choices: [
      ...makeChoices(['Woman', 'Man', 'Non-binary']),
      { id: uid('c'), label: 'I prefer to self-describe', code: 4, other: true },
      { id: uid('c'), label: 'I prefer not to say', code: 99 },
    ],
  });
  const devices = q('multi_choice', 'devices', 'Which devices do you use at least once a week?', {
    description: 'Select all that apply.',
    required: true,
    choices: [
      ...makeChoices(['Smartphone', 'Laptop', 'Desktop computer', 'Tablet', 'Smartwatch']),
      { id: uid('c'), label: 'None of these', code: 0, exclusive: true },
    ],
  });
  const attitudes = q('matrix', 'att', 'How much do you agree with the following statements?', {
    required: true,
    randomizeRows: true,
    rows: makeChoices(
      [
        'I enjoy trying out new technology.',
        'I feel overwhelmed by how fast technology changes.',
        'Technology makes my everyday life easier.',
        'I worry about how my personal data is used.',
      ],
      'r',
    ),
    columns: makeChoices(SCALE_PRESETS[0].labels.en, 'k'),
  });
  const hours = q('slider', 'screen_hours', 'On a typical day, how many hours do you spend on screens outside of work or study?', {
    scale: { min: 0, max: 16, step: 0.5, minLabel: '0 hours', maxLabel: '16 hours' },
  });
  const survey: Survey = {
    schema: 1,
    id,
    title: 'Everyday technology use',
    randomizers: [],
    urlParams: [],
    settings: {
      ...defaultSettings('en'),
      welcomeEnabled: true,
      welcomeTitle: 'Everyday technology use',
      welcomeText: 'Thank you for your interest in this study. It takes about **5 minutes** and asks how you use and feel about technology in everyday life.',
      endTitle: 'Thank you for taking part!',
      endMessage: 'Your answers have been recorded. You can close this window now.',
    },
    blocks: [
      block('Consent', [consentQuestion()]),
      block('Demographics', [
        q('number', 'age', 'How old are you?', { required: true, placeholder: 'Age in years', validation: { min: 18, max: 110, integer: true } }),
        gender,
        q('dropdown', 'education', 'What is the highest level of education you have completed?', {
          required: true,
          choices: makeChoices([
            'No formal qualification',
            'Secondary school',
            'Vocational training',
            'Bachelor’s degree',
            'Master’s degree',
            'Doctorate',
          ]),
        }),
      ]),
      block('Technology use', [devices, attitudes, hours]),
      block('Feedback', [q('long_text', 'comments', 'Is there anything else you would like to tell us?', { placeholder: 'Optional' })]),
    ],
  };
  return survey;
}

function experiment(id: string): Survey {
  const vignetteA = block('Gain frame', [
    q('text_block', '', 'A new recycling programme', {
      description:
        'Your city is considering a new recycling programme.\n\n**If the programme is adopted, 2,000 tonnes of waste will be recycled every year.**\n\nPlease read this carefully before you continue.',
    }),
  ]);
  const vignetteB = block('Loss frame', [
    q('text_block', '', 'A new recycling programme', {
      description:
        'Your city is considering a new recycling programme.\n\n**If the programme is not adopted, 2,000 tonnes of recyclable waste will end up in landfill every year.**\n\nPlease read this carefully before you continue.',
    }),
  ]);
  const support = q('rating_scale', 'support', 'How much do you support the recycling programme?', {
    required: true,
    scale: {
      min: 1,
      max: 7,
      style: 'numbers',
      minLabel: 'Strongly oppose',
      maxLabel: 'Strongly support',
      pointLabels: ['Strongly oppose', 'Oppose', 'Somewhat oppose', 'Neutral', 'Somewhat support', 'Support', 'Strongly support'],
    },
  });
  const why = q('long_text', 'support_why', 'You said: “{{support}}”. What was the main reason for your answer?', { required: false });
  const attention = q('single_choice', 'attention', 'To show that you are reading carefully, please select “Sometimes” below.', {
    required: true,
    choices: makeChoices(['Never', 'Rarely', 'Sometimes', 'Often', 'Always']),
    layout: 'horizontal',
  });
  const outcome = block('Outcome', [support, why, attention]);
  outcome.branches.push({
    id: uid('br'),
    logic: { match: 'all', conditions: [{ id: uid('cd'), source: attention.id, operator: 'is_not', value: attention.choices![2].id }] },
    target: 'end',
    endTag: 'failed_attention',
    endMessage: 'Thank you for your time. Unfortunately you did not pass the attention check, so the survey ends here.',
  });
  const consent = consentQuestion();
  const survey: Survey = {
    schema: 1,
    id,
    title: 'Framing experiment (two conditions)',
    randomizers: [
      {
        id: uid('rz'),
        variable: 'condition',
        arms: [
          { id: uid('arm'), label: 'Gain frame', blockIds: [vignetteA.id] },
          { id: uid('arm'), label: 'Loss frame', blockIds: [vignetteB.id] },
        ],
        present: 1,
        balance: true,
      },
    ],
    urlParams: [
      { id: uid('p'), name: 'PROLIFIC_PID', required: false },
      { id: uid('p'), name: 'STUDY_ID', required: false },
      { id: uid('p'), name: 'SESSION_ID', required: false },
    ],
    settings: {
      ...defaultSettings('en'),
      allowBack: false,
      welcomeEnabled: true,
      welcomeTitle: 'Opinions on local policy',
      welcomeText: 'This short study takes about 3 minutes. You will read a short text and answer a few questions about it.',
      endTitle: 'Thank you!',
      endMessage: 'Your response has been recorded. You will now be sent back to Prolific.',
      redirectUrl: 'https://app.prolific.com/submissions/complete?cc=REPLACE_ME',
    },
    blocks: [block('Consent', [consent]), vignetteA, vignetteB, outcome],
  };
  return survey;
}

function videoExperiment(id: string): Survey {
  // Add the videos in the Build tab: paste each video's link into its video question.
  const stimulus = (title: string, variable: string) =>
    block(title, [
      q('video', variable, 'Please watch the following video carefully.', {
        description: 'Drag the picture to look around. You can continue once the video has finished.',
        required: true,
        video: { src: '', view: 'wrap', span: 180, fov: 90, tilt: false },
      }),
    ]);
  const ai = stimulus('AI-generated video', 'video_ai');
  const vignette = block('Vignette', [
    q('text_block', '', 'Please read carefully', {
      description: '**[Write the vignette here.]** A short written scenario that describes the same situation as the videos.',
    }),
  ]);
  const captured = stimulus('Captured video', 'video_captured');

  const realism = q('rating_scale', 'realism', 'How realistic did the situation you just saw or read about seem to you?', {
    required: true,
    scale: { min: 1, max: 7, style: 'numbers', minLabel: 'Not at all realistic', maxLabel: 'Completely realistic', pointLabels: [] },
  });
  const attitudes = q('matrix', 'resp', 'How much do you agree with the following statements?', {
    required: true,
    randomizeRows: true,
    rows: makeChoices(['The content was believable.', 'I felt emotionally involved.', 'I would like to know more about this topic.'], 'r'),
    columns: makeChoices(SCALE_PRESETS[0].labels.en, 'k'),
  });
  const realisticVideo = q('rating_scale', 'video_quality', 'How would you rate the picture and sound quality of the video?', {
    required: true,
    scale: { min: 1, max: 5, style: 'numbers', minLabel: 'Very poor', maxLabel: 'Very good', pointLabels: [] },
  });
  const watched = q('single_choice', 'watched_all', 'Did you watch the video until the end?', {
    required: true,
    choices: makeChoices(['Yes', 'No']),
    layout: 'horizontal',
  });
  const check = q('single_choice', 'manip_check', 'What did you see before these questions?', {
    required: true,
    choices: makeChoices(['A video', 'A written text', 'I don’t remember']),
  });
  const r: Randomizer = {
    id: uid('rz'),
    variable: 'condition',
    arms: [
      { id: uid('arm'), label: 'AI-generated video', blockIds: [ai.id] },
      { id: uid('arm'), label: 'Vignette', blockIds: [vignette.id] },
      { id: uid('arm'), label: 'Captured video', blockIds: [captured.id] },
    ],
    present: 1,
    balance: true,
  };
  // Video questions don't apply to people who read the vignette.
  const notVignette = () => ({ match: 'all' as const, conditions: [{ id: uid('cd'), source: `param:${r.variable}`, operator: 'is_not' as const, value: 'Vignette' }] });
  realisticVideo.displayLogic = notVignette();
  watched.displayLogic = notVignette();

  return {
    schema: 1,
    id,
    title: 'Video experiment (three conditions)',
    randomizers: [r],
    urlParams: [
      { id: uid('p'), name: 'PROLIFIC_PID', required: false },
      { id: uid('p'), name: 'STUDY_ID', required: false },
      { id: uid('p'), name: 'SESSION_ID', required: false },
    ],
    settings: {
      ...defaultSettings('en'),
      allowBack: false,
      welcomeEnabled: true,
      welcomeTitle: 'Perceptions of media content',
      welcomeText: 'This study takes about 8 minutes. You will watch a short video or read a short text, then answer some questions about it. Please use headphones or turn your sound on.',
      endTitle: 'Thank you!',
      endMessage: 'Your response has been recorded.',
    },
    blocks: [
      block('Consent', [consentQuestion()]),
      ai,
      vignette,
      captured,
      block('Questionnaire', [realism, attitudes, realisticVideo, watched, check]),
      block('Demographics', [
        q('number', 'age', 'How old are you?', { required: true, placeholder: 'Age in years', validation: { min: 18, max: 110, integer: true } }),
        q('single_choice', 'gender', 'What is your gender?', {
          required: true,
          choices: [...makeChoices(['Woman', 'Man', 'Non-binary']), { id: uid('c'), label: 'I prefer not to say', code: 99 }],
        }),
      ]),
    ],
  };
}

function feedback(id: string): Survey {
  const nps = q('nps', 'nps', 'How likely are you to recommend us to a friend or colleague?', {
    required: true,
    scale: { min: 0, max: 10, minLabel: 'Not at all likely', maxLabel: 'Extremely likely' },
  });
  const improve = q('long_text', 'improve', 'What is the one thing we should improve?', {
    displayLogic: { match: 'all', conditions: [{ id: uid('cd'), source: nps.id, operator: 'lte', value: 6 }] },
  });
  const love = q('long_text', 'love', 'What do you like most about us?', {
    displayLogic: { match: 'all', conditions: [{ id: uid('cd'), source: nps.id, operator: 'gte', value: 9 }] },
  });
  const contact = q('single_choice', 'contact_ok', 'May we contact you about your answers?', {
    choices: makeChoices(['Yes', 'No']),
    layout: 'horizontal',
  });
  const email = q('short_text', 'email', 'Your email address', {
    required: true,
    validation: { format: 'email' },
    placeholder: 'name@example.org',
    displayLogic: { match: 'all', conditions: [{ id: uid('cd'), source: contact.id, operator: 'is', value: contact.choices![0].id }] },
  });
  return {
    schema: 1,
    id,
    title: 'Customer feedback',
    randomizers: [],
    urlParams: [],
    settings: { ...defaultSettings('en'), endTitle: 'Thanks for your feedback!', endMessage: 'We read every response.' },
    blocks: [
      block('Rating', [
        nps,
        improve,
        love,
        q('rating_scale', 'satisfaction', 'Overall, how satisfied are you with our service?', {
          required: true,
          scale: { min: 1, max: 5, style: 'stars', minLabel: 'Very dissatisfied', maxLabel: 'Very satisfied', pointLabels: [] },
        }),
      ]),
      block('Follow-up', [contact, email]),
    ],
  };
}

export interface Template {
  id: string;
  name: string;
  description: string;
  build: (surveyId: string) => Survey;
}

export const TEMPLATES: Template[] = [
  { id: 'blank', name: 'Blank survey', description: 'One block with one question. Start from scratch.', build: (id) => blankSurvey(id) },
  {
    id: 'study',
    name: 'Research study',
    description: 'Consent that screens out decliners, demographics with an “other” option, a randomized Likert matrix and a slider.',
    build: researchStudy,
  },
  {
    id: 'experiment',
    name: 'Two-condition experiment',
    description: 'Balanced random assignment to a gain or loss frame, piped follow-up, attention check and a Prolific redirect.',
    build: experiment,
  },
  {
    id: 'video-experiment',
    name: 'Three-condition video experiment',
    description: 'Balanced random assignment to an AI-generated video, a written vignette or a captured video. Everyone answers the same questionnaire; video questions are skipped for the vignette group.',
    build: videoExperiment,
  },
  {
    id: 'feedback',
    name: 'Feedback form',
    description: 'Net Promoter Score with follow-ups that depend on the score, star rating and an optional email.',
    build: feedback,
  },
];

/** Randomizers from older files listed single blocks; each becomes a branch named after its block. */
function normalizeRandomizer(raw: Partial<Randomizer>, blocks: Block[]): Randomizer {
  const title = (blockId: string) => blocks.find((b) => b.id === blockId)?.title.trim() || blockId;
  // Old files could list blocks that no longer exist; tidy() drops their (then empty) branches.
  const arms: RandomizerArm[] = Array.isArray(raw.arms)
    ? raw.arms.map((a, i) => ({
        id: typeof a?.id === 'string' && a.id ? a.id : uid('arm'),
        label: typeof a?.label === 'string' ? a.label : `Branch ${i + 1}`,
        blockIds: Array.isArray(a?.blockIds) ? a.blockIds.filter((x): x is string => typeof x === 'string') : [],
      }))
    : (Array.isArray(raw.blockIds) ? raw.blockIds : []).map((blockId) => ({ id: `arm_${blockId}`, label: title(blockId), blockIds: [blockId] }));
  return {
    id: raw.id || uid('rz'),
    variable: typeof raw.variable === 'string' && raw.variable ? raw.variable : 'condition',
    arms,
    present: Math.max(1, Math.floor(Number(raw.present)) || 1),
    balance: raw.balance !== false,
  };
}

/** Brings older or imported survey files up to the current shape. */
export function normalizeSurvey(raw: unknown, id: string): Survey {
  const survey = readSurvey(raw, id);
  tidy(survey);
  return survey;
}

function readSurvey(raw: unknown, id: string): Survey {
  const s = (raw ?? {}) as Partial<Survey>;
  const settings = { ...defaultSettings((s.settings?.language as Lang) ?? 'en'), ...(s.settings ?? {}) };
  const blocks: Block[] = (Array.isArray(s.blocks) ? s.blocks : []).map((b) => ({
    id: b.id || uid('b'),
    title: typeof b.title === 'string' ? b.title : 'Block',
    pageMode: b.pageMode === 'each' ? 'each' : 'single',
    randomizeQuestions: !!b.randomizeQuestions,
    ...(b.responses === 'forced' || b.responses === 'optional' ? { responses: b.responses } : {}),
    displayLogic: b.displayLogic ?? null,
    branches: Array.isArray(b.branches) ? b.branches : [],
    questions: Array.isArray(b.questions) ? b.questions.map((x) => ({ ...x, id: x.id || uid('q'), required: !!x.required })) : [],
  }));
  return {
    schema: 1,
    id,
    title: typeof s.title === 'string' && s.title.trim() ? s.title : 'Untitled survey',
    blocks,
    randomizers: (Array.isArray(s.randomizers) ? s.randomizers : []).map((r) => normalizeRandomizer(r, blocks)),
    urlParams: Array.isArray(s.urlParams) ? s.urlParams : [],
    settings,
  };
}
