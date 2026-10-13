import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { QuestionView } from '../../components/QuestionView';
import { Button, Icon, IconButton, Menu, useConfirm, useMediaQuery } from '../../components/ui';
import { blockContents, readFolded, readOutlineShown, writeFolded, writeOutlineShown } from '../../lib/builderView';
import { canMoveBlock, describeTarget, insertBlockAfter, moveBlock as moveBlockInFlow, removeBlock } from '../../lib/flow';
import { uid } from '../../lib/ids';
import { TYPE_INFO, cloneQuestion, createQuestion } from '../../lib/questionTypes';
import { newBlock } from '../../lib/templates';
import type { Block, Question, QuestionType, Survey } from '../../lib/types';
import type { Updater } from '../../lib/useUndoable';
import { formatShortcut } from '../../components/formatText';
import { BlockInspector, QuestionInspector, SurveyOverview } from './Inspector';
import { describeLogic } from './LogicEditor';
import { Outline, type Selection } from './Outline';
import { QuestionEditor, type QMutate } from './QuestionEditor';
import { TypePicker } from './TypePicker';

function locate(s: Survey, qid: string): { block: Block; index: number } | null {
  for (const block of s.blocks) {
    const index = block.questions.findIndex((q) => q.id === qid);
    if (index >= 0) return { block, index };
  }
  return null;
}

const blockRect = (id: string) => document.getElementById(`block-${id}`)?.getBoundingClientRect();

/** The first block showing at the top of the screen (more than a sliver of it). */
function topBlock(ids: string[]): string | null {
  for (const id of ids) {
    const r = blockRect(id);
    if (r && r.bottom > 40) return id;
  }
  return ids[ids.length - 1] ?? null;
}

const headerOnScreen = (id: string) => {
  const r = blockRect(id);
  return !!r && r.top >= 0 && r.top < window.innerHeight - 40;
};

/** Space at the top of the screen taken by the toolbar when it sticks there. */
const topInset = () => {
  const bar = document.querySelector<HTMLElement>('.canvas-bar');
  return 12 + (bar && getComputedStyle(bar).position === 'sticky' ? bar.offsetHeight : 0);
};

export function Builder({ survey, surveyId, update, onPreview }: { survey: Survey; surveyId: string; update: Updater<Survey>; onPreview?: (blockId: string) => void }) {
  // The Flow tab links here with ?block=<id> to open a block.
  const [arrival] = useState(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('block'));
  const [sel, setSel] = useState<Selection>(() => (arrival ? { kind: 'block', id: arrival } : null));
  const [adding, setAdding] = useState<{ blockId: string; afterId?: string } | null>(null);
  const [drag, setDrag] = useState<{ id: string; over?: string; overBlock?: string } | null>(null);
  const wide = useMediaQuery('(min-width: 1100px)');
  // Room for the outline next to the blocks; narrower screens open it over them.
  const roomy = useMediaQuery('(min-width: 1200px)');
  const [outlineShown, setOutlineShown] = useState(readOutlineShown);
  const [drawer, setDrawer] = useState(false);
  const docked = roomy && outlineShown;
  const drawerRef = useRef<HTMLDialogElement>(null);
  const confirm = useConfirm();

  // Folded blocks, remembered per survey in this browser. A block you arrive at opens.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set(readFolded(surveyId).filter((id) => id !== arrival)));
  const foldedIds = useMemo(() => survey.blocks.filter((b) => folded.has(b.id)).map((b) => b.id), [survey.blocks, folded]);
  const foldedKey = foldedIds.join(' ');
  useEffect(() => writeFolded(surveyId, foldedKey ? foldedKey.split(' ') : []), [surveyId, foldedKey]);

  useEffect(() => {
    if (sel?.kind === 'block') requestAnimationFrame(() => document.getElementById(`block-${sel.id}`)?.scrollIntoView({ block: 'start' }));
    // Only when arriving with a block to open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drop the selection when its target disappears (undo, delete).
  useEffect(() => {
    if (sel?.kind === 'question' && !locate(survey, sel.id)) setSel(null);
    if (sel?.kind === 'block' && !survey.blocks.some((b) => b.id === sel.id)) setSel(null);
  }, [survey, sel]);

  // Folding and unfolding changes how long the page is. `anchor` keeps a block where it
  // was on the screen (or, if it folded away above the screen, brings its header back).
  const anchor = useRef<{ id: string; top: number; reveal: boolean } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    const top = a && blockRect(a.id)?.top;
    if (!a || top == null) return;
    const shift = top - (a.reveal ? Math.max(a.top, topInset()) : a.top);
    if (Math.abs(shift) > 1) window.scrollBy(0, shift);
  }, [folded]);

  const setFold = (ids: string[], fold: boolean, keep: string | null = null) => {
    const top = keep ? blockRect(keep)?.top : undefined;
    anchor.current = keep && top != null ? { id: keep, top, reveal: fold && ids.includes(keep) } : null;
    setFolded((f) => {
      const next = new Set(f);
      for (const id of ids) {
        if (fold) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    // A question being edited in a block that folds away hands the selection to its block
    // (on narrow screens to nothing, since the block's settings would open inside it).
    if (fold && sel?.kind === 'question') {
      const at = locate(survey, sel.id);
      if (at && ids.includes(at.block.id)) setSel(wide ? { kind: 'block', id: at.block.id } : null);
    }
  };
  const blockIdList = () => survey.blocks.map((b) => b.id);
  // From its own header a block keeps its place; from the outline, the block it names does
  // if its header is on the screen, otherwise whatever is at the top of the screen stays put.
  const toggleFold = (blockId: string, keep: string | null) => setFold([blockId], !folded.has(blockId), keep);
  const toggleFromOutline = (blockId: string) => toggleFold(blockId, headerOnScreen(blockId) ? blockId : topBlock(blockIdList()));
  // Fold all, then Unfold all without scrolling in between, returns to the block you were at
  // (folded, the page may be too short to keep it at the top of the screen).
  const foldedAllAt = useRef<{ id: string; y: number } | null>(null);
  const foldAll = (fold: boolean) => {
    const ids = blockIdList();
    const back = foldedAllAt.current;
    const keep = !fold && back && Math.abs(window.scrollY - back.y) < 4 && ids.includes(back.id) ? back.id : topBlock(ids);
    setFold(ids, fold, keep);
    foldedAllAt.current = null;
    if (fold && keep) requestAnimationFrame(() => (foldedAllAt.current = { id: keep, y: window.scrollY }));
  };
  const allFolded = survey.blocks.every((b) => folded.has(b.id));
  const noneFolded = foldedIds.length === 0;

  // Whatever brings a question into view (the outline, a move, undo) opens its block.
  useEffect(() => {
    if (sel?.kind !== 'question') return;
    const at = locate(survey, sel.id);
    if (at && folded.has(at.block.id)) setFold([at.block.id], false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, survey, folded]);

  // A question taller than most of the screen (an open editor, with its settings below it
  // on narrow screens) lines up at the top rather than the middle, so its text shows.
  const scrollToQuestion = (id: string) => {
    const el = document.getElementById(`q-${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: el.offsetHeight < window.innerHeight * 0.75 ? 'center' : 'start' });
  };

  const selectQuestion = (id: string, scroll = false) => {
    const at = locate(survey, id);
    if (at && folded.has(at.block.id)) setFold([at.block.id], false);
    setSel({ kind: 'question', id });
    if (scroll) requestAnimationFrame(() => scrollToQuestion(id));
  };

  /* -------------------------------------------------------------- outline */

  // A layout effect, so the drawer is open before the outline inside it measures itself.
  useLayoutEffect(() => {
    const d = drawerRef.current;
    if (!d) return;
    if (drawer && !d.open) d.showModal();
    if (!drawer && d.open) d.close();
  }, [drawer]);
  useEffect(() => {
    if (docked) setDrawer(false);
  }, [docked]);

  // Showing or hiding the outline removes the button you pressed, so focus moves to its counterpart.
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    if (!focusAfter.current) return;
    document.querySelector<HTMLElement>(focusAfter.current)?.focus();
    focusAfter.current = null;
  }, [docked]);
  const showOutline = (shown: boolean) => {
    focusAfter.current = shown ? 'nav.outline .outline-hide' : '.canvas-bar .outline-toggle';
    setOutlineShown(shown);
    writeOutlineShown(shown);
  };
  const openOutline = () => (roomy ? showOutline(true) : setDrawer(true));
  // Going somewhere from the outline takes keyboard focus along (rather than leaving it in the
  // outline, or on the button that opened the drawer at the top of the page).
  const goToBlock = (id: string) => {
    setDrawer(false);
    requestAnimationFrame(() => {
      const el = document.getElementById(`block-${id}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el?.querySelector<HTMLElement>('.fold-btn')?.focus({ preventScroll: true });
    });
  };
  const goToQuestion = (id: string) => {
    setDrawer(false);
    selectQuestion(id, true);
    requestAnimationFrame(() => document.getElementById(`q-${id}`)?.focus({ preventScroll: true }));
  };
  const outlineProps = {
    survey,
    folded,
    sel,
    onToggleFold: toggleFromOutline,
    onFoldAll: foldAll,
    onBlock: goToBlock,
    onQuestion: goToQuestion,
  };

  const changeQ =
    (qid: string): QMutate =>
    (mutate, coalesce) =>
      update(
        (s) => {
          const at = locate(s, qid);
          if (at) mutate(at.block.questions[at.index]);
        },
        { coalesce: coalesce ? `${qid}:${coalesce}` : undefined },
      );

  const replaceQ = (q: Question) =>
    update((s) => {
      const at = locate(s, q.id);
      if (at) at.block.questions[at.index] = q;
    });

  const addQuestion = (type: QuestionType) => {
    if (!adding) return;
    const q = createQuestion(type, survey);
    update((s) => {
      const b = s.blocks.find((x) => x.id === adding.blockId) ?? s.blocks[s.blocks.length - 1];
      const after = adding.afterId ? b.questions.findIndex((x) => x.id === adding.afterId) : -1;
      if (after >= 0) b.questions.splice(after + 1, 0, q);
      else b.questions.push(q);
    });
    setAdding(null);
    selectQuestion(q.id, true);
    // After the picker closes (and hands focus back), put the cursor in the new question's text.
    setTimeout(() => document.querySelector<HTMLTextAreaElement>(`#q-${q.id} .qedit-title`)?.focus(), 80);
  };

  const duplicateQ = (qid: string) => {
    const at = locate(survey, qid);
    if (!at) return;
    const copy = cloneQuestion(at.block.questions[at.index], survey);
    update((s) => {
      const loc = locate(s, qid);
      loc?.block.questions.splice(loc.index + 1, 0, copy);
    });
    selectQuestion(copy.id, true);
  };

  const deleteQ = async (qid: string) => {
    const at = locate(survey, qid);
    if (!at) return;
    const q = at.block.questions[at.index];
    const usedIn = dependents(survey, qid);
    if (usedIn.length) {
      const ok = await confirm({
        title: 'Delete this question?',
        message: (
          <>
            <p>Logic elsewhere depends on {q.variable || 'this question'}:</p>
            <ul>
              {usedIn.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
            <p>Those conditions will stop working until you change them. You can also undo the deletion.</p>
          </>
        ),
        confirmLabel: 'Delete question',
        danger: true,
      });
      if (!ok) return;
    }
    update((s) => {
      const loc = locate(s, qid);
      loc?.block.questions.splice(loc.index, 1);
    });
    setSel(null);
  };

  const moveQ = (qid: string, dir: -1 | 1) => {
    // Moving past the first or last question goes into the next block, which opens if folded.
    const at = locate(survey, qid);
    const leaving = at && (dir < 0 ? at.index === 0 : at.index === at.block.questions.length - 1);
    const into = leaving ? survey.blocks[survey.blocks.indexOf(at.block) + dir] : null;
    if (into && folded.has(into.id)) setFold([into.id], false);
    update((s) => {
      const at = locate(s, qid);
      if (!at) return;
      const bi = s.blocks.indexOf(at.block);
      const target = at.index + dir;
      const [q] = at.block.questions.splice(at.index, 1);
      if (target >= 0 && target <= at.block.questions.length) at.block.questions.splice(target, 0, q);
      else if (dir < 0 && bi > 0) s.blocks[bi - 1].questions.push(q);
      else if (dir > 0 && bi < s.blocks.length - 1) s.blocks[bi + 1].questions.unshift(q);
      else at.block.questions.splice(at.index, 0, q);
    });
  };

  const moveToBlock = (qid: string, blockId: string) =>
    update((s) => {
      const at = locate(s, qid);
      const target = s.blocks.find((b) => b.id === blockId);
      if (!at || !target || at.block.id === blockId) return;
      const [q] = at.block.questions.splice(at.index, 1);
      target.questions.push(q);
    });

  const dropOn = (targetQid: string | null, blockId: string) => {
    if (!drag) return;
    const dragId = drag.id;
    setDrag(null);
    if (dragId === targetQid) return;
    update((s) => {
      const from = locate(s, dragId);
      if (!from) return;
      const [q] = from.block.questions.splice(from.index, 1);
      const block = s.blocks.find((b) => b.id === blockId)!;
      const idx = targetQid ? block.questions.findIndex((x) => x.id === targetQid) : -1;
      if (idx >= 0) block.questions.splice(idx, 0, q);
      else block.questions.push(q);
    });
  };

  const addBlock = (afterBlockId?: string) => {
    const b = newBlock(survey);
    update((s) => insertBlockAfter(s, b, afterBlockId ?? null));
    setSel({ kind: 'block', id: b.id });
    requestAnimationFrame(() => document.getElementById(`block-${b.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const deleteBlock = async (b: Block) => {
    if (survey.blocks.length === 1) return;
    const ok = await confirm({
      title: `Delete “${b.title}”?`,
      message: b.questions.length ? `Its ${b.questions.length} question${b.questions.length === 1 ? '' : 's'} will be deleted too. You can undo this.` : 'You can undo this.',
      confirmLabel: 'Delete block',
      danger: true,
    });
    if (!ok) return;
    update((s) => removeBlock(s, b.id));
  };

  const duplicateBlock = (b: Block) => {
    const copy: Block = {
      ...structuredClone(b),
      id: newBlock(survey).id,
      title: `${b.title} (copy)`,
      branches: [],
      questions: [],
    };
    const working: Survey = structuredClone(survey);
    const ids = new Map<string, string>(); // old question / option / row id -> copy's id
    for (const q of b.questions) {
      const c = cloneQuestion(q, working);
      working.blocks[0].questions.push(c);
      copy.questions.push(c);
      ids.set(q.id, c.id);
      const pairs: [typeof q.choices, typeof c.choices][] = [
        [q.choices, c.choices],
        [q.rows, c.rows],
        [q.columns, c.columns],
      ];
      for (const [from, to] of pairs) from?.forEach((x, i) => to?.[i] && ids.set(x.id, to[i].id));
    }
    // Conditions inside the copy that refer to questions of the same block follow the copies.
    const remap = (l: Block['displayLogic']) =>
      l?.conditions.forEach((cd) => {
        if (!ids.has(cd.source)) return;
        cd.source = ids.get(cd.source)!;
        if (cd.rowId && ids.has(cd.rowId)) cd.rowId = ids.get(cd.rowId);
        if (typeof cd.value === 'string' && ids.has(cd.value)) cd.value = ids.get(cd.value);
      });
    copy.questions.forEach((q) => remap(q.displayLogic));
    update((s) => insertBlockAfter(s, copy, b.id));
  };

  // Blocks move past whole steps; inside a randomizer branch they move within the branch.
  const moveBlock = (blockId: string, dir: -1 | 1) => update((s) => moveBlockInFlow(s, blockId, dir));

  const selectedQ = sel?.kind === 'question' ? locate(survey, sel.id) : null;
  const selectedBlock = sel?.kind === 'block' ? survey.blocks.find((b) => b.id === sel.id) : null;

  const inspector = selectedQ ? (
    <QuestionInspector
      survey={survey}
      q={selectedQ.block.questions[selectedQ.index]}
      change={changeQ(sel!.id)}
      replace={replaceQ}
      onDuplicate={() => duplicateQ(sel!.id)}
      onDelete={() => deleteQ(sel!.id)}
      onMoveToBlock={(bid) => moveToBlock(sel!.id, bid)}
      onApplyLogic={(ids, logic) =>
        update((s) => {
          for (const b of s.blocks)
            for (const x of b.questions)
              if (ids.includes(x.id)) x.displayLogic = { match: logic.match, conditions: logic.conditions.map((c) => ({ ...c, id: uid('cd') })) };
        })
      }
    />
  ) : selectedBlock ? (
    <BlockInspector survey={survey} block={selectedBlock} update={update} />
  ) : (
    <SurveyOverview survey={survey} />
  );

  const randomizerOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of survey.randomizers) for (const a of r.arms) for (const id of a.blockIds) m.set(id, `${r.variable}: ${a.label}`);
    return m;
  }, [survey.randomizers]);

  return (
    <div className={`builder ${wide ? 'is-wide' : ''} ${docked ? 'has-outline' : ''}`} onClick={() => setSel(null)}>
      {docked && <Outline {...outlineProps} onHide={() => showOutline(false)} hideLabel="Hide outline" />}

      <div className="canvas" onKeyDownCapture={formatShortcut}>
        <div className="canvas-bar" onClick={(e) => e.stopPropagation()}>
          {!docked && (
            <Button size="sm" variant="quiet" icon="sidebar" className="outline-toggle" onClick={openOutline} aria-haspopup={roomy ? undefined : 'dialog'}>
              Outline
            </Button>
          )}
          <span className="canvas-bar-gap" />
          {/* aria-disabled rather than disabled, so keyboard focus stays on a button that has just done its job */}
          <Button size="sm" variant="quiet" icon="fold" aria-disabled={allFolded} onClick={() => !allFolded && foldAll(true)}>
            Fold all
          </Button>
          <Button size="sm" variant="quiet" icon="unfold" aria-disabled={noneFolded} onClick={() => !noneFolded && foldAll(false)}>
            Unfold all
          </Button>
        </div>
        {survey.blocks.map((b, bi) => {
          const isSel = sel?.kind === 'block' && sel.id === b.id;
          const isFolded = folded.has(b.id);
          const badges: string[] = [];
          if (b.pageMode === 'each') badges.push('One question per page');
          if (b.randomizeQuestions) badges.push('Shuffled');
          const rz = randomizerOf.get(b.id);
          const vars = b.questions.map((q) => q.variable).filter(Boolean);
          return (
            <section
              key={b.id}
              id={`block-${b.id}`}
              className={`block ${isSel ? 'is-selected' : ''} ${isFolded ? 'is-folded' : ''} ${drag?.overBlock === b.id && !drag.over ? 'is-drop' : ''}`}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                if (drag.overBlock !== b.id || drag.over) setDrag({ ...drag, overBlock: b.id, over: undefined });
              }}
              onDrop={(e) => {
                e.preventDefault();
                dropOn(null, b.id);
              }}
            >
              <header
                className="block-head"
                onClick={(e) => {
                  e.stopPropagation();
                  setSel({ kind: 'block', id: b.id });
                }}
              >
                <div className="block-head-main">
                  <div className="block-heading">
                    <button
                      type="button"
                      className={`fold-btn ${isFolded ? 'is-folded' : ''}`}
                      aria-expanded={!isFolded}
                      aria-controls={isFolded ? undefined : `block-body-${b.id}`}
                      aria-label={`${isFolded ? 'Unfold' : 'Fold'} block ${bi + 1}`}
                      title={isFolded ? 'Unfold' : 'Fold'}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFold(b.id, b.id);
                      }}
                    >
                      <Icon name="chevron" size={16} />
                    </button>
                    <div className="block-title-row">
                      <span className="block-kicker">Block {bi + 1}</span>
                      <h2 className="block-title">{b.title || 'Untitled block'}</h2>
                    </div>
                  </div>
                  {isFolded && (
                    <p className="block-summary">
                      <span>{blockContents(b)}</span>
                      {b.branches.length > 0 && <span>{b.branches.length === 1 ? '1 skip rule' : `${b.branches.length} skip rules`}</span>}
                      {vars.length > 0 && <span className="block-summary-vars">{vars.join('  ')}</span>}
                    </p>
                  )}
                  <div className="block-badges">
                    {badges.map((x) => (
                      <span key={x} className="badge">
                        {x}
                      </span>
                    ))}
                    {rz && (
                      <span className="badge badge-logic" title="This block is one branch of a randomizer. Arrange it in the Flow tab.">
                        <Icon name="shuffle" size={13} /> {rz}
                      </span>
                    )}
                    {b.displayLogic?.conditions.length ? (
                      <span className="badge badge-logic">
                        <Icon name="logic" size={13} /> Shown if {describeLogic(b.displayLogic, survey)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <Menu
                  label={`Block actions for ${b.title}`}
                  items={[
                    { label: 'Block settings and logic', icon: 'sliders', onSelect: () => setSel({ kind: 'block', id: b.id }) },
                    onPreview && { label: 'Preview from this block', icon: 'eye', onSelect: () => onPreview(b.id) },
                    { label: 'Add a block after this one', icon: 'plus', onSelect: () => addBlock(b.id) },
                    { label: 'Move block up', icon: 'up', onSelect: () => moveBlock(b.id, -1), disabled: !canMoveBlock(survey, b.id, -1) },
                    { label: 'Move block down', icon: 'down', onSelect: () => moveBlock(b.id, 1), disabled: !canMoveBlock(survey, b.id, 1) },
                    { label: 'Duplicate block', icon: 'copy', onSelect: () => duplicateBlock(b) },
                    { label: 'Delete block', icon: 'trash', danger: true, onSelect: () => deleteBlock(b), disabled: survey.blocks.length === 1 },
                  ]}
                />
              </header>
              {!wide && isSel && <div className="inline-inspector">{inspector}</div>}

              {!isFolded && (
                <>
                  <div className="block-body" id={`block-body-${b.id}`}>
                    {!b.questions.length && <p className="block-empty">No questions in this block yet.</p>}
                    {b.questions.map((q, qi) => {
                      const isQ = sel?.kind === 'question' && sel.id === q.id;
                      return (
                        <article
                          key={q.id}
                          id={`q-${q.id}`}
                          tabIndex={isQ ? -1 : undefined}
                          className={`qcard ${isQ ? 'is-selected' : ''} ${drag?.id === q.id ? 'is-dragging' : ''} ${drag?.over === q.id ? 'is-drop-before' : ''}`}
                          draggable={drag?.id === q.id}
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', q.id);
                          }}
                          onDragOver={(e) => {
                            if (!drag) return;
                            e.preventDefault();
                            e.stopPropagation();
                            if (drag.over !== q.id) setDrag({ ...drag, over: q.id, overBlock: b.id });
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            dropOn(q.id, b.id);
                          }}
                          onDragEnd={() => setDrag(null)}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isQ) selectQuestion(q.id);
                          }}
                        >
                          <div className="qcard-meta">
                            <span
                              className="grip"
                              title="Drag to move"
                              onPointerDown={() => setDrag({ id: q.id })}
                              onPointerUp={() => setDrag((d) => (d && !d.over ? null : d))}
                            >
                              <Icon name="grip" size={16} />
                            </span>
                            {q.variable ? <span className="var-chip">{q.variable}</span> : null}
                            <span className="type-label">{TYPE_INFO[q.type].label}</span>
                            {q.required && <span className="req-chip">Required</span>}
                            {q.displayLogic?.conditions.length ? (
                              <span className="logic-chip" title={`Shown if ${describeLogic(q.displayLogic, survey)}`}>
                                <Icon name="logic" size={13} /> Shown if {describeLogic(q.displayLogic, survey)}
                              </span>
                            ) : null}
                            <span className="qcard-tools">
                              <IconButton icon="up" size="sm" label="Move up" onClick={(e) => (e.stopPropagation(), moveQ(q.id, -1))} disabled={bi === 0 && qi === 0} />
                              <IconButton
                                icon="down"
                                size="sm"
                                label="Move down"
                                onClick={(e) => (e.stopPropagation(), moveQ(q.id, 1))}
                                disabled={bi === survey.blocks.length - 1 && qi === b.questions.length - 1}
                              />
                              <IconButton icon="copy" size="sm" label="Duplicate" onClick={(e) => (e.stopPropagation(), duplicateQ(q.id))} />
                              <IconButton icon="trash" size="sm" label="Delete" onClick={(e) => (e.stopPropagation(), void deleteQ(q.id))} />
                            </span>
                          </div>
                          {isQ ? (
                            <QuestionEditor survey={survey} q={q} change={changeQ(q.id)} />
                          ) : (
                            <div className="qcard-preview" aria-hidden="true">
                              <QuestionView q={q} value={undefined} onChange={() => {}} onOther={() => {}} lang={survey.settings.language} disabled />
                            </div>
                          )}
                          {isQ && !wide && <div className="inline-inspector">{inspector}</div>}
                          <button
                            type="button"
                            className="insert-here"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAdding({ blockId: b.id, afterId: q.id });
                            }}
                          >
                            <Icon name="plus" size={14} />
                            <span>Insert question here</span>
                          </button>
                        </article>
                      );
                    })}
                    <Button
                      variant="quiet"
                      icon="plus"
                      className="add-question"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAdding({ blockId: b.id });
                      }}
                    >
                      Add question
                    </Button>
                  </div>

                  {b.branches.length > 0 && (
                    <footer className="block-foot">
                      <Icon name="logic" size={15} />
                      <div>
                        {b.branches.map((br) => (
                          <p key={br.id}>
                            If {describeLogic(br.logic, survey)}, go to{' '}
                            <strong>{br.target === 'end' ? `the end (${br.endTag || 'complete'})` : describeTarget(survey, b.id, br.target)}</strong>
                          </p>
                        ))}
                      </div>
                    </footer>
                  )}
                </>
              )}
            </section>
          );
        })}
        <Button
          icon="plus"
          className="add-block"
          onClick={(e) => {
            e.stopPropagation();
            addBlock();
          }}
        >
          Add block
        </Button>
      </div>

      {wide && (
        <aside className="inspector" aria-label="Settings for the selection" onClick={(e) => e.stopPropagation()} onKeyDownCapture={formatShortcut}>
          <div className="inspector-sticky">
            <h2 className="inspector-title">{selectedQ ? 'Question settings' : selectedBlock ? 'Block settings' : 'Overview'}</h2>
            {inspector}
          </div>
        </aside>
      )}

      {!docked && (
        <dialog
          ref={drawerRef}
          className="outline-drawer"
          aria-label="Survey outline"
          onCancel={(e) => {
            e.preventDefault();
            setDrawer(false);
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (e.target === e.currentTarget) setDrawer(false);
          }}
        >
          {drawer && <Outline {...outlineProps} onHide={() => setDrawer(false)} hideLabel="Close outline" hideIcon="x" />}
        </dialog>
      )}

      <TypePicker open={!!adding} onClose={() => setAdding(null)} onPick={addQuestion} />
    </div>
  );
}

/** Where a question is used in other questions' or blocks' logic. */
function dependents(s: Survey, qid: string): string[] {
  const out: string[] = [];
  for (const b of s.blocks) {
    if (b.displayLogic?.conditions.some((c) => c.source === qid)) out.push(`Display logic of block “${b.title}”`);
    b.branches.forEach((br, i) => {
      if (br.logic.conditions.some((c) => c.source === qid)) out.push(`Skip rule ${i + 1} of block “${b.title}”`);
    });
    for (const q of b.questions) {
      if (q.id !== qid && q.displayLogic?.conditions.some((c) => c.source === qid)) out.push(`Display logic of ${q.variable || 'a text block'}`);
    }
  }
  return out;
}
