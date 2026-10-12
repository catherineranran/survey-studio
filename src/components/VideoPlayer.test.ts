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
