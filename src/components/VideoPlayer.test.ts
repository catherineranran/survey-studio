import { describe, expect, it } from 'vitest';
import { clampView, deviceDirection, geometry } from './VideoPlayer';

const deg = (r: number) => (r * 180) / Math.PI;

describe('magic window view', () => {
  it('can look around a 180° picture only as far as it goes', () => {
    const g = geometry(180, 90, 1, 16 / 10);
    const [yaw] = clampView(g, 10, 0); // far past the side
    expect(deg(yaw)).toBeGreaterThan(30);
    expect(deg(yaw)).toBeCloseTo(45, 2); // 90° minus half the 90° view
    const [, pitch] = clampView(g, 0, 10); // far past the top
    expect(deg(pitch)).toBeGreaterThan(20);
    expect(deg(pitch)).toBeLessThan(90);
    // Near the top the picture narrows towards its pole, so there's less room to turn.
    const [yawUp] = clampView(g, 10, 10);
    expect(Math.abs(yawUp)).toBeLessThan(Math.abs(yaw));
    expect(clampView(g, 0.2, -0.1)).toEqual([0.2, -0.1]); // inside: unchanged
  });

  it('matches the website’s 140° view: 85 % of the width visible', () => {
    const g = geometry(140, 119, 1, 1.6);
    const [yaw] = clampView(g, 1, 0);
    expect(deg(yaw)).toBeGreaterThan(0);
    expect(deg(yaw)).toBeLessThan(11); // 70° − 59.5°
  });

  it('can keep respondents to the central part of the picture, to match another condition', () => {
    // A 180° picture limited to its central 140° turns exactly as far as a 140° picture.
    const limited = geometry(180, 90, 1, 1.6, 140);
    const narrow = geometry(140, 90, 1, 1.6);
    for (const [y, p] of [
      [5, 0],
      [-5, 0],
      [0, 5],
      [0, -5],
      [5, 5],
    ]) {
      const a = clampView(limited, y, p);
      const b = clampView(narrow, y, p);
      expect(deg(a[0])).toBeCloseTo(deg(b[0]), 6);
      expect(deg(a[1])).toBeCloseTo(deg(b[1]), 6);
    }
    expect(deg(clampView(limited, 5, 0)[0])).toBeCloseTo(25, 4); // 70° − 45°
    // The picture itself still spans 180°: only how far people can turn changes.
    expect(deg(limited.hSpan)).toBeCloseTo(180, 6);
  });

  it('shows the same 85 % of 140° on any screen, whether the picture spans 140° or 180°', () => {
    for (const aspect of [1.6, 1.25, 0.75]) {
      const limited = geometry(180, 119, 1, aspect, 140);
      const narrow = geometry(140, 119, 1, aspect);
      expect(deg(Math.atan(limited.tanH) * 2)).toBeCloseTo(119, 6); // the view isn't narrowed
      expect(limited.tanV).toBeCloseTo(narrow.tanV, 9);
      for (const [y, p] of [
        [5, 0],
        [0, 5],
        [-5, -5],
      ]) {
        const a = clampView(limited, y, p);
        const b = clampView(narrow, y, p);
        expect(deg(a[0])).toBeCloseTo(deg(b[0]), 6);
        expect(deg(a[1])).toBeCloseTo(deg(b[1]), 6);
      }
    }
  });

  it('goes all the way round a 360° picture', () => {
    const g = geometry(360, 90, 2, 16 / 10);
    const [yaw] = clampView(g, Math.PI * 1.5, 0);
    expect(deg(yaw)).toBeCloseTo(-90, 5);
  });
});

describe('moving the phone', () => {
  // Phone upright in portrait, screen facing the respondent: the back camera looks at the horizon.
  const ahead = deviceDirection(0, 90, 0, 0);
  it('looks straight ahead when held upright', () => {
    expect(deg(ahead[0])).toBeCloseTo(0, 3);
    expect(deg(ahead[1])).toBeCloseTo(0, 3);
  });
  it('turning left looks left, tilting the top back looks up', () => {
    const left = deviceDirection(30, 90, 0, 0);
    expect(deg(left[0] - ahead[0])).toBeCloseTo(30, 3);
    const up = deviceDirection(0, 110, 0, 0);
    expect(deg(up[1])).toBeCloseTo(20, 3);
  });
  it('works in landscape too', () => {
    // Rotated to landscape (screen turned 90°): upright means gamma ≈ −90 with the screen angle 90.
    const [yaw, pitch] = deviceDirection(0, 0, -90, 90);
    expect(Math.abs(deg(pitch))).toBeLessThan(1);
    expect(Number.isFinite(yaw)).toBe(true);
  });
});
