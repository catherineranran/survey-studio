import { describe, expect, it } from 'vitest';
import { toggleMark } from './formatText';
import { plainText } from '../lib/markdown';

describe('toggleMark', () => {
  it('wraps the selection in bold and keeps it selected', () => {
    expect(toggleMark('I felt anger now', 7, 12, 'bold')).toEqual({ value: 'I felt **anger** now', start: 9, end: 14 });
  });
  it('keeps spaces outside the marks', () => {
    expect(toggleMark('felt anger now', 4, 11, 'bold').value).toBe('felt **anger** now');
  });
  it('removes bold when pressed again', () => {
    expect(toggleMark('I felt **anger** now', 9, 14, 'bold')).toEqual({ value: 'I felt anger now', start: 7, end: 12 });
    expect(toggleMark('I felt **anger** now', 7, 16, 'bold').value).toBe('I felt anger now');
  });
  it('italic does not eat bold marks', () => {
    expect(toggleMark('**anger**', 2, 7, 'italic').value).toBe('***anger***');
    expect(toggleMark('***anger***', 3, 8, 'italic').value).toBe('**anger**');
  });
  it('inserts empty marks with no selection', () => {
    expect(toggleMark('ab', 1, 1, 'bold')).toEqual({ value: 'a****b', start: 3, end: 3 });
  });
});

describe('plainText', () => {
  it('drops formatting marks', () => {
    expect(plainText('**Angry** and *sad*, [site](https://x.org), PROLIFIC_PID')).toBe('Angry and sad, site, PROLIFIC_PID');
  });
});
