import { Dialog } from '../../components/ui';
import { TYPE_GROUPS, TYPE_INFO } from '../../lib/questionTypes';
import type { QuestionType } from '../../lib/types';

// A tiny glyph per type, set in the mono face, so the list scans like a form legend.
const GLYPH: Record<QuestionType, string> = {
  single_choice: '◉ ○',
  multi_choice: '☑ ☐',
  dropdown: '▾',
  rank: '1 2 3',
  rating_scale: '① ⑤',
  matrix: '▦',
  slider: '─●─',
  nps: '0–10',
  short_text: 'Aa',
  long_text: '¶',
  number: '123',
  date: '31',
  consent: '✓ ✗',
  constant_sum: 'Σ',
  text_block: 'T',
};

export function TypePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (t: QuestionType) => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Add a question" wide>
      <div className="type-groups">
        {TYPE_GROUPS.map((g) => (
          <section key={g.name} className="type-group">
            <h3>{g.name}</h3>
            <div className="type-grid">
              {g.types.map((t) => (
                <button key={t} type="button" className="type-option" onClick={() => onPick(t)}>
                  <span className="type-glyph" aria-hidden="true">
                    {GLYPH[t]}
                  </span>
                  <span className="type-text">
                    <span className="type-name">{TYPE_INFO[t].label}</span>
                    <span className="type-hint">{TYPE_INFO[t].hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
