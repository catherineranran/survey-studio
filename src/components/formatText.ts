// Bold / italic for the builder's plain text fields. The fields store the
// tiny Markdown subset RichText understands (**bold**, *italic*), so the
// buttons and Ctrl/Cmd+B, Ctrl/Cmd+I just add or remove those marks around
// the selection. Editing goes through execCommand('insertText') where the
// browser supports it, so React's onChange fires and Ctrl+Z still works.

export type Mark = 'bold' | 'italic';
const MARKER: Record<Mark, string> = { bold: '**', italic: '*' };

type Field = HTMLInputElement | HTMLTextAreaElement;

export function isFormattable(el: Element | null): el is Field {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    return (el.type === 'text' || el.type === '') && !el.readOnly && !el.disabled && !el.inputMode && !el.closest('[data-no-format]');
  }
  return false;
}

/** Pure part: the new value and selection after toggling a mark. Exported for tests. */
export function toggleMark(value: string, start: number, end: number, mark: Mark): { value: string; start: number; end: number } {
  const m = MARKER[mark];
  // Keep spaces outside the marks ("**word** " not "**word **").
  while (start < end && /\s/.test(value[start])) start++;
  while (end > start && /\s/.test(value[end - 1])) end--;
  const sel = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);

  // Already marked just outside the selection → remove. For italic, don't mistake bold's ** for *.
  const outside = before.endsWith(m) && after.startsWith(m) && (mark === 'bold' || !(before.endsWith('**') && after.startsWith('**')) || (before.endsWith('***') && after.startsWith('***')));
  if (outside) {
    return { value: before.slice(0, -m.length) + sel + after.slice(m.length), start: start - m.length, end: end - m.length };
  }
  // Selection includes the marks → remove.
  if (sel.length > 2 * m.length && sel.startsWith(m) && sel.endsWith(m) && (mark === 'bold' || !sel.startsWith('**') || sel.startsWith('***'))) {
    const inner = sel.slice(m.length, -m.length);
    return { value: before + inner + after, start, end: start + inner.length };
  }
  return { value: before + m + sel + m + after, start: start + m.length, end: end + m.length };
}

export function applyMark(el: Field, mark: Mark) {
  const s0 = el.selectionStart ?? el.value.length;
  const e0 = el.selectionEnd ?? s0;
  const next = toggleMark(el.value, s0, e0, mark);
  // Replace the smallest span that changed, so undo history stays tidy.
  const old = el.value;
  let a = 0;
  while (a < old.length && a < next.value.length && old[a] === next.value[a]) a++;
  let b = 0;
  while (b < old.length - a && b < next.value.length - a && old[old.length - 1 - b] === next.value[next.value.length - 1 - b]) b++;
  const insert = next.value.slice(a, next.value.length - b);
  el.focus();
  el.setSelectionRange(a, old.length - b);
  let ok = false;
  try {
    ok = document.execCommand('insertText', false, insert);
  } catch {
    ok = false;
  }
  if (!ok || el.value !== next.value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, next.value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el.setSelectionRange(next.start, next.end);
}

/** Keyboard shortcut handler; attach with onKeyDownCapture on a container. */
export function formatShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; target: EventTarget | null; preventDefault: () => void }) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  const k = e.key.toLowerCase();
  if (k !== 'b' && k !== 'i') return;
  const el = e.target as Element | null;
  if (!isFormattable(el)) return;
  e.preventDefault();
  applyMark(el, k === 'b' ? 'bold' : 'italic');
}
