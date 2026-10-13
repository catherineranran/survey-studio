import { useEffect, useRef, useState } from 'react';
import { Icon, IconButton, type IconName } from '../../components/ui';
import { blockContents } from '../../lib/builderView';
import { flowSteps } from '../../lib/flow';
import { questionLabel } from '../../lib/lint';
import type { Block, Survey } from '../../lib/types';

export type Selection = { kind: 'question'; id: string } | { kind: 'block'; id: string } | null;

interface OutlineProps {
  survey: Survey;
  folded: ReadonlySet<string>;
  sel: Selection;
  onToggleFold: (blockId: string) => void;
  onFoldAll: (fold: boolean) => void;
  onBlock: (blockId: string) => void;
  onQuestion: (questionId: string) => void;
  onHide: () => void;
  hideLabel: string;
  hideIcon?: IconName;
}

/**
 * The block you're reading: the last one whose header has scrolled past a line near
 * the top of the screen. At the very end of the page, the last block on the screen.
 */
function blockAt(ids: string[], atEnd: boolean): string | null {
  const line = window.innerHeight * 0.3;
  let found: string | null = ids[0] ?? null;
  for (const id of ids) {
    const top = document.getElementById(`block-${id}`)?.getBoundingClientRect().top;
    if (top === undefined) continue;
    if (top <= line || (atEnd && top < window.innerHeight)) found = id;
    else if (!atEnd) break;
  }
  return found;
}

/**
 * Follows the block you're reading as the page scrolls (null while the whole survey
 * fits on the screen). It lives here, not in the builder, so scrolling re-renders
 * only the outline, and only while it's shown.
 */
function useCurrentBlock(blockIds: string, layout: unknown): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    const ids = blockIds ? blockIds.split(' ') : [];
    let frame = 0;
    const measure = () => {
      frame = 0;
      const doc = document.documentElement;
      if (doc.scrollHeight <= window.innerHeight + 4) return setCurrent(null);
      setCurrent(blockAt(ids, window.innerHeight + window.scrollY >= doc.scrollHeight - 4));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [blockIds, layout]);
  return current;
}

/**
 * The survey at a glance, in flow order: blocks (randomizer branches side by side),
 * and the questions of blocks that aren't folded. Clicking an entry goes there.
 */
export function Outline(props: OutlineProps) {
  const current = useCurrentBlock(props.survey.blocks.map((b) => b.id).join(' '), props.folded);
  return <OutlineView {...props} current={current} />;
}

export function OutlineView({
  survey,
  folded,
  sel,
  current,
  onToggleFold,
  onFoldAll,
  onBlock,
  onQuestion,
  onHide,
  hideLabel,
  hideIcon = 'sidebar',
}: OutlineProps & { current: string | null }) {
  const listRef = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  const numbers = new Map(survey.blocks.map((b, i) => [b.id, i + 1]));
  const allFolded = survey.blocks.every((b) => folded.has(b.id));
  const noneFolded = !survey.blocks.some((b) => folded.has(b.id));

  // The block you're at stays in sight here too: straight there when the outline
  // opens, smoothly as you scroll on.
  useEffect(() => {
    const list = listRef.current;
    const row = current ? list?.querySelector<HTMLElement>(`[data-block="${CSS.escape(current)}"] > .outline-row`) : null;
    if (!list || !row) return;
    const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    if (top < 8 || top + row.offsetHeight > list.clientHeight - 8)
      list.scrollTo({ top: list.scrollTop + top - list.clientHeight / 3, behavior: placed.current ? 'smooth' : 'auto' });
    placed.current = true;
  }, [current]);

  const block = (b: Block) => {
    const isFolded = folded.has(b.id);
    const title = b.title || 'Untitled block';
    return (
      <li key={b.id} data-block={b.id} className={`outline-item ${current === b.id ? 'is-current' : ''}`}>
        <div className="outline-row">
          <button
            type="button"
            className={`fold-btn outline-fold ${isFolded ? 'is-folded' : ''}`}
            aria-expanded={!isFolded}
            aria-label={`${isFolded ? 'Unfold' : 'Fold'} ${title}`}
            title={isFolded ? 'Unfold' : 'Fold'}
            onClick={() => onToggleFold(b.id)}
          >
            <Icon name="chevron" size={14} />
          </button>
          <button
            type="button"
            className={`outline-block ${sel?.kind === 'block' && sel.id === b.id ? 'is-active' : ''}`}
            aria-current={current === b.id ? 'location' : undefined}
            title={title}
            onClick={() => onBlock(b.id)}
          >
            <span className="outline-num">{numbers.get(b.id)}</span>
            <span className="outline-text">{title}</span>
            {b.displayLogic?.conditions.length ? <Icon name="logic" size={13} className="logic-ico" /> : null}
            {isFolded && (
              <span className="outline-count" title={blockContents(b)}>
                {b.questions.length}
              </span>
            )}
          </button>
        </div>
        {!isFolded && b.questions.length > 0 && (
          <ol className="outline-qs">
            {b.questions.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  className={`outline-q ${sel?.kind === 'question' && sel.id === q.id ? 'is-active' : ''}`}
                  title={`${q.variable ? `${q.variable}: ` : ''}${questionLabel(q)}`}
                  onClick={() => onQuestion(q.id)}
                >
                  <span className="outline-var">{q.variable || 'Text'}</span>
                  <span className="outline-text">{questionLabel(q)}</span>
                  {q.displayLogic?.conditions.length ? <Icon name="logic" size={13} className="logic-ico" /> : null}
                </button>
              </li>
            ))}
          </ol>
        )}
      </li>
    );
  };

  return (
    <nav className="outline" aria-label="Survey outline" onClick={(e) => e.stopPropagation()}>
      <div className="outline-head">
        <h2 className="outline-title">Outline</h2>
        {/* aria-disabled rather than disabled, so keyboard focus stays on a button that has just done its job */}
        <IconButton icon="fold" size="sm" label="Fold all blocks" aria-disabled={allFolded} onClick={() => !allFolded && onFoldAll(true)} />
        <IconButton icon="unfold" size="sm" label="Unfold all blocks" aria-disabled={noneFolded} onClick={() => !noneFolded && onFoldAll(false)} />
        <IconButton icon={hideIcon} size="sm" label={hideLabel} className="outline-hide" onClick={onHide} />
      </div>
      <div className="outline-list" ref={listRef}>
        <ol>
          {flowSteps(survey).map((step) =>
            step.kind === 'block' ? (
              block(step.block)
            ) : (
              <li key={step.randomizer.id} className="outline-rand">
                <div className="outline-rand-head" title="Randomizer: respondents are assigned to its branches at random">
                  <Icon name="shuffle" size={13} />
                  <span className="outline-var">{step.randomizer.variable}</span>
                  <span>{step.randomizer.present > 1 ? `${step.randomizer.present} branches each` : 'one branch each'}</span>
                </div>
                <ol>
                  {step.arms.map(({ arm, blocks }) => (
                    <li key={arm.id} className="outline-arm">
                      {!(blocks.length === 1 && blocks[0].title.trim() === arm.label.trim()) && <div className="outline-arm-label">{arm.label || 'Unnamed branch'}</div>}
                      {blocks.length ? <ol>{blocks.map(block)}</ol> : <p className="outline-none">Nothing shown</p>}
                    </li>
                  ))}
                </ol>
              </li>
            ),
          )}
        </ol>
      </div>
    </nav>
  );
}
