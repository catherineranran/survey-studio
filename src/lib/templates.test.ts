import { describe, expect, it } from 'vitest';
import { firstStep, makeCtx, makePlan, nextStep, pageAt, visibleQuestions } from './engine';
import { lintSurvey } from './lint';
import { TEMPLATES } from './templates';

describe('templates', () => {
  it('have no errors, apart from video links still to add', () => {
    for (const t of TEMPLATES) {
      const errors = lintSurvey(t.build('s1')).filter((i) => i.level === 'error' && !/has no video yet/.test(i.message));
      expect([t.id, errors]).toEqual([t.id, []]);
    }
    const video = lintSurvey(TEMPLATES.find((t) => t.id === 'video-experiment')!.build('s1'));
    expect(video.filter((i) => /has no video yet/.test(i.message))).toHaveLength(2);
  });

  it('video experiment: everyone gets the same questionnaire, minus the video questions for the vignette group', () => {
    const s = TEMPLATES.find((t) => t.id === 'video-experiment')!.build('s1');
    const r = s.randomizers[0];
    const seen = (armLabel: string) => {
      const arm = r.arms.find((a) => a.label === armLabel)!;
      const plan = makePlan(s, 7, {}, { [r.id]: [arm.id] });
      const ctx = makeCtx(s, {}, plan.assignments);
      const vars: string[] = [];
      for (let step = firstStep(plan, ctx); step.kind === 'page'; step = nextStep(plan, ctx, step.pos)) {
        vars.push(...visibleQuestions(pageAt(plan, ctx, step.pos)!, ctx).map((q) => q.variable || q.title));
      }
      return vars;
    };
    const video = seen('AI-generated video');
    const vignette = seen('Vignette');
    expect(video).toContain('video_quality');
    expect(video).toContain('watched_all');
    expect(vignette).not.toContain('video_quality');
    expect(vignette).not.toContain('watched_all');
    expect(vignette).toContain('Please read carefully');
    expect(video).toContain('video_ai');
    expect(vignette).not.toContain('video_ai');
    for (const v of ['realism', 'resp', 'manip_check', 'age', 'gender']) {
      expect(video).toContain(v);
      expect(vignette).toContain(v);
    }
    expect(seen('Captured video')).toEqual(video.map((v) => (v === 'video_ai' ? 'video_captured' : v)));
  });
});
