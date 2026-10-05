import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Button, Dialog, Empty, Field, Icon, IconButton, Spinner, Toggle, downloadFile, formatDateTime, formatDuration, useConfirm, useToast } from '../components/ui';
import type { Backend } from '../lib/backend';
import { allQuestions, answerText, isEmpty } from '../lib/engine';
import {
  DEFAULT_EXPORT,
  codebookCSV,
  codebookMarkdown,
  fileSlug,
  responsesJSON,
  responsesTable,
  responsesToCSV,
  spssSyntax,
  type ExportOptions,
} from '../lib/export';
import { questionLabel } from '../lib/lint';
import { TYPE_INFO } from '../lib/questionTypes';
import { median, summarize, type CountRow, type NumericStats, type Summary } from '../lib/stats';
import type { Question, Survey, SurveyResponse } from '../lib/types';

type View = 'summary' | 'responses' | 'export';

export function Results({ backend, surveyId, survey }: { backend: Backend; surveyId: string; survey: Survey }) {
  const [all, setAll] = useState<SurveyResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('summary');
  const [includePreview, setIncludePreview] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'complete' | 'other'>('all');
  const toast = useToast();
  const confirm = useConfirm();

  const load = () => {
    setError(null);
    backend
      .listResponses(surveyId)
      .then(setAll)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(load, [backend, surveyId]);

  const responses = useMemo(() => {
    let list = all ?? [];
    if (!includePreview) list = list.filter((r) => !r.meta?.preview);
    if (statusFilter === 'complete') list = list.filter((r) => (r.meta?.status ?? 'complete') === 'complete');
    if (statusFilter === 'other') list = list.filter((r) => (r.meta?.status ?? 'complete') !== 'complete');
    return list;
  }, [all, includePreview, statusFilter]);

  const previews = (all ?? []).filter((r) => r.meta?.preview).length;
  const live = (all ?? []).filter((r) => !r.meta?.preview);
  const completed = live.filter((r) => (r.meta?.status ?? 'complete') === 'complete').length;
  const medianTime = median(live.map((r) => r.meta?.durationSec).filter((x): x is number => typeof x === 'number'));
  const statuses = [...new Set(live.map((r) => r.meta?.status ?? 'complete'))].filter((s) => s !== 'complete');

  const deletePreviews = async () => {
    const ids = (all ?? []).filter((r) => r.meta?.preview).map((r) => r.id);
    if (!ids.length) return;
    const ok = await confirm({ title: 'Delete test responses?', message: `${ids.length} response${ids.length === 1 ? '' : 's'} from the preview will be deleted.`, confirmLabel: 'Delete test responses', danger: true });
    if (!ok) return;
    await backend.deleteResponses(surveyId, ids).catch((e) => toast(e.message, 'error'));
    load();
  };

  if (error)
    return (
      <div className="page-narrow">
        <Empty title="Responses couldn’t be loaded" action={<Button onClick={load}>Try again</Button>}>
          <p>{error}</p>
        </Empty>
      </div>
    );
  if (!all) return <Spinner label="Loading responses" />;

  return (
    <div className="results">
      <div className="results-top">
        <dl className="kpis">
          <div>
            <dt>Responses</dt>
            <dd>{live.length}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{completed}</dd>
          </div>
          <div>
            <dt>Ended early</dt>
            <dd title={statuses.join(', ')}>{live.length - completed}</dd>
          </div>
          <div>
            <dt>Median time</dt>
            <dd>{formatDuration(medianTime)}</dd>
          </div>
        </dl>
        <div className="results-filters">
          <div className="segmented" role="tablist" aria-label="Results view">
            {(['summary', 'responses', 'export'] as View[]).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'is-on' : ''} onClick={() => setView(v)}>
                {v === 'summary' ? 'Summary' : v === 'responses' ? 'Responses' : 'Export'}
              </button>
            ))}
          </div>
          <select className="input input-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Filter by status">
            <option value="all">All statuses</option>
            <option value="complete">Completed only</option>
            <option value="other">Ended early only</option>
          </select>
          <Toggle label={`Include test responses (${previews})`} checked={includePreview} onChange={setIncludePreview} />
          <IconButton icon="undo" label="Reload responses" onClick={load} />
          {previews > 0 && (
            <Button size="sm" variant="ghost" icon="trash" onClick={deletePreviews}>
              Delete test responses
            </Button>
          )}
        </div>
      </div>

      {view === 'summary' &&
        (responses.length === 0 ? (
          <Empty title="No responses yet">
            <p>
              Share the link from the Share tab. Responses from Preview are kept as test responses
              {previews ? ': switch on “Include test responses” to see them.' : '.'}
            </p>
          </Empty>
        ) : (
          <div className="summary-list">
            {allQuestions(survey)
              .filter((q) => TYPE_INFO[q.type].answerable)
              .map((q) => (
                <QuestionSummary key={q.id} q={q} responses={responses} />
              ))}
          </div>
        ))}
      {view === 'responses' && <ResponsesTable survey={survey} responses={responses} onDelete={async (ids) => {
        const ok = await confirm({ title: 'Delete this response?', message: 'It will be removed from all results and exports. This can’t be undone.', confirmLabel: 'Delete response', danger: true });
        if (!ok) return false;
        await backend.deleteResponses(surveyId, ids).catch((e) => toast(e.message, 'error'));
        load();
        return true;
      }} />}
      {view === 'export' && <ExportPanel survey={survey} responses={all} includePreviewDefault={includePreview} />}
    </div>
  );
}

/* ---------------------------------------------------------------- summary */

const fmt = (n: number, digits = 1) => (Number.isInteger(n) ? String(n) : n.toFixed(digits));

function QuestionSummary({ q, responses }: { q: Question; responses: SurveyResponse[] }) {
  const s = useMemo(() => summarize(q, responses), [q, responses]);
  if (s.kind === 'none') return null;
  return (
    <section className="summary-card">
      <header className="summary-head">
        <span className="var-chip">{q.variable}</span>
        <h3>{questionLabel(q)}</h3>
        <span className="hint summary-n">
          {s.answered} of {responses.length} answered
        </span>
      </header>
      <SummaryBody s={s} q={q} />
    </section>
  );
}

function Bars({ rows, total }: { rows: CountRow[]; total?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <table className="bars">
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} title={`${r.label}: ${r.n}${total !== undefined ? ` of ${total}` : ''} (${fmt(r.pct)}%)`}>
            <th scope="row">{r.label || <em>(no label)</em>}</th>
            <td className="bar-cell">
              <span className="bar" style={{ '--w': `${(r.n / max) * 100}%` } as CSSProperties} />
            </td>
            <td className="bar-n">{r.n}</td>
            <td className="bar-pct">{Math.round(r.pct)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatsLine({ stats }: { stats: NumericStats | null }) {
  if (!stats) return null;
  return (
    <dl className="stats-line">
      <div>
        <dt>Mean</dt>
        <dd>{fmt(stats.mean, 2)}</dd>
      </div>
      <div>
        <dt>Median</dt>
        <dd>{fmt(stats.median, 2)}</dd>
      </div>
      <div>
        <dt>SD</dt>
        <dd>{fmt(stats.sd, 2)}</dd>
      </div>
      <div>
        <dt>Range</dt>
        <dd>
          {fmt(stats.min)} to {fmt(stats.max)}
        </dd>
      </div>
    </dl>
  );
}

function SummaryBody({ s, q }: { s: Summary; q: Question }) {
  const [showAll, setShowAll] = useState(false);
  switch (s.kind) {
    case 'choice':
      return (
        <>
          <Bars rows={s.rows} total={s.answered} />
          {s.multi && <p className="hint">Percentages are of respondents who answered; they can add up to more than 100%.</p>}
          {s.others.length > 0 && (
            <details className="others">
              <summary>“Other” answers ({s.others.length})</summary>
              <ul>
                {s.others.slice(0, showAll ? undefined : 20).map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
              {s.others.length > 20 && !showAll && (
                <button type="button" className="link-btn" onClick={() => setShowAll(true)}>
                  Show all
                </button>
              )}
            </details>
          )}
        </>
      );
    case 'scale':
      return (
        <>
          {s.nps && (
            <div className="nps">
              <p className="nps-score">
                <span>NPS</span>
                <strong>{s.nps.score > 0 ? `+${s.nps.score}` : s.nps.score}</strong>
              </p>
              <p className="hint">
                {s.nps.promoters} promoters (9–10), {s.nps.passives} passives (7–8), {s.nps.detractors} detractors (0–6)
              </p>
            </div>
          )}
          <StatsLine stats={s.stats} />
          <Bars rows={s.rows} total={s.answered} />
        </>
      );
    case 'numeric':
      return (
        <>
          <StatsLine stats={s.stats} />
          <Bars rows={s.bins} total={s.answered} />
        </>
      );
    case 'matrix':
      return (
        <div className="mx-scroll">
          <table className="heat">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Statement</span>
                </th>
                {s.columns.map((c) => (
                  <th scope="col" key={c.id}>
                    {c.label}
                    <span className="mono heat-code">{c.code}</span>
                  </th>
                ))}
                <th scope="col">Mean</th>
                <th scope="col">n</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.label}</th>
                  {r.counts.map((n, i) => {
                    const pct = r.n ? (n / r.n) * 100 : 0;
                    return (
                      <td key={i} className={pct > 55 ? 'is-dark' : ''} style={{ '--p': `${Math.round(pct * 0.9)}%` } as CSSProperties} title={`${r.label}, ${s.columns[i].label}: ${n} (${Math.round(pct)}%)`}>
                        {Math.round(pct)}%
                      </td>
                    );
                  })}
                  <td className="heat-mean">{r.mean === null ? '–' : fmt(r.mean, 2)}</td>
                  <td className="heat-mean">{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rank':
      return (
        <table className="bars rank-table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Average position</th>
              <th scope="col">Ranked first</th>
            </tr>
          </thead>
          <tbody>
            {s.items.map((it) => (
              <tr key={it.id}>
                <th scope="row">{it.label}</th>
                <td>{it.meanRank ? fmt(it.meanRank, 2) : '–'}</td>
                <td>{it.firstPlace}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'sum': {
      const max = Math.max(1, ...s.items.map((i) => i.mean));
      return (
        <table className="bars">
          <tbody>
            {s.items.map((it) => (
              <tr key={it.id}>
                <th scope="row">{it.label}</th>
                <td className="bar-cell">
                  <span className="bar" style={{ '--w': `${(it.mean / max) * 100}%` } as CSSProperties} />
                </td>
                <td className="bar-n" colSpan={2}>
                  avg {fmt(it.mean, 1)} / {q.validation?.total ?? 100}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case 'text': {
      const shown = showAll ? s.values : s.values.slice(0, 8);
      return (
        <>
          <ul className="text-answers">
            {shown.map((v) => (
              <li key={v.id}>
                <p>{v.text}</p>
                <span className="hint">{formatDateTime(v.at)}</span>
              </li>
            ))}
          </ul>
          {s.values.length > 8 && !showAll && (
            <button type="button" className="link-btn" onClick={() => setShowAll(true)}>
              Show all {s.values.length}
            </button>
          )}
        </>
      );
    }
  }
}

/* ------------------------------------------------------------ responses */

const PAGE = 50;

function ResponsesTable({ survey, responses, onDelete }: { survey: Survey; responses: SurveyResponse[]; onDelete: (ids: string[]) => Promise<boolean> }) {
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<SurveyResponse | null>(null);
  const sorted = useMemo(() => [...responses].sort((a, b) => ((a.meta?.submittedAt || a.createdAt) < (b.meta?.submittedAt || b.createdAt) ? 1 : -1)), [responses]);
  const { columns } = useMemo(() => responsesTable(survey, [], { ...DEFAULT_EXPORT, values: 'labels', includePreview: true }), [survey]);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const slice = sorted.slice(page * PAGE, page * PAGE + PAGE);
  const dataCols = columns.filter((c) => !['response_id', 'started_at', 'submitted_at', 'duration_sec', 'status', 'preview'].includes(c.name));

  if (!responses.length) return <Empty title="No responses match these filters" />;

  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Submitted</th>
              <th scope="col">Status</th>
              <th scope="col">Time</th>
              {dataCols.map((c) => (
                <th scope="col" key={c.name} title={c.label}>
                  <span className="mono">{c.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={r.id} onClick={() => setOpen(r)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}>
                <td className="nowrap">
                  {formatDateTime(r.meta?.submittedAt || r.createdAt)}
                  {r.meta?.preview && <span className="tag">test</span>}
                </td>
                <td>
                  <span className={`status status-${(r.meta?.status ?? 'complete') === 'complete' ? 'ok' : 'early'}`}>{r.meta?.status ?? 'complete'}</span>
                </td>
                <td className="nowrap">{formatDuration(r.meta?.durationSec)}</td>
                {dataCols.map((c) => {
                  const v = c.get(r);
                  return (
                    <td key={c.name} className="clip">
                      {v === null ? <span className="missing">–</span> : String(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <IconButton icon="back" label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)} />
          <span>
            Page {page + 1} of {pages}
          </span>
          <IconButton icon="back" className="flip" label="Next page" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} />
        </div>
      )}
      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        title="Response"
        wide
        footer={
          open && (
            <>
              <Button
                variant="danger"
                icon="trash"
                onClick={async () => {
                  if (open && (await onDelete([open.id]))) setOpen(null);
                }}
              >
                Delete response
              </Button>
              <Button variant="primary" onClick={() => setOpen(null)}>
                Done
              </Button>
            </>
          )
        }
      >
        {open && <ResponseDetail survey={survey} r={open} />}
      </Dialog>
    </>
  );
}

function ResponseDetail({ survey, r }: { survey: Survey; r: SurveyResponse }) {
  const embedded = Object.entries(r.embedded ?? {});
  return (
    <div className="response-detail">
      <dl className="facts">
        <div>
          <dt>Submitted</dt>
          <dd>{formatDateTime(r.meta?.submittedAt || r.createdAt)}</dd>
        </div>
        <div>
          <dt>Time taken</dt>
          <dd>{formatDuration(r.meta?.durationSec)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{r.meta?.status ?? 'complete'}</dd>
        </div>
        <div>
          <dt>Response ID</dt>
          <dd className="mono small">{r.id}</dd>
        </div>
        {embedded.map(([k, v]) => (
          <div key={k}>
            <dt className="mono">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <ol className="answer-list">
        {allQuestions(survey)
          .filter((q) => TYPE_INFO[q.type].answerable)
          .map((q) => {
            const v = r.answers?.[q.id];
            return (
              <li key={q.id} className={isEmpty(v) ? 'is-empty' : ''}>
                <p className="answer-q">
                  <span className="var-chip">{q.variable}</span> {questionLabel(q)}
                </p>
                <p className="answer-a">{isEmpty(v) ? 'Not shown or not answered' : answerText(q, v, r.otherText?.[q.id])}</p>
              </li>
            );
          })}
      </ol>
    </div>
  );
}

/* ---------------------------------------------------------------- export */

function ExportPanel({ survey, responses, includePreviewDefault }: { survey: Survey; responses: SurveyResponse[]; includePreviewDefault: boolean }) {
  const [opts, setOpts] = useState<ExportOptions>({ ...DEFAULT_EXPORT, includePreview: includePreviewDefault });
  const slug = fileSlug(survey.title);
  const stamp = new Date().toISOString().slice(0, 10);
  const count = responses.filter((r) => opts.includePreview || !r.meta?.preview).length;
  const set = (patch: Partial<ExportOptions>) => setOpts((o) => ({ ...o, ...patch }));

  return (
    <div className="export-panel">
      <section className="panel">
        <header className="panel-head">
          <h2>Data file</h2>
          <p className="hint">One row per response, one column per variable. {count} response{count === 1 ? '' : 's'} will be exported.</p>
        </header>
        <div className="grid-2">
          <Field label="Answer values">
            <select className="input" value={opts.values} onChange={(e) => set({ values: e.target.value as ExportOptions['values'] })}>
              <option value="codes">Numeric codes (for R, SPSS, Stata, Python)</option>
              <option value="labels">Labels as text (for reading)</option>
            </select>
          </Field>
          <Field label="File format">
            <select className="input" value={opts.dialect} onChange={(e) => set({ dialect: e.target.value as ExportOptions['dialect'] })}>
              <option value="standard">CSV, comma-separated</option>
              <option value="excel_de">CSV for Excel with German settings (semicolon, decimal comma)</option>
            </select>
          </Field>
        </div>
        <Toggle label="Include test responses" hint="Adds a “preview” column so you can filter them later." checked={opts.includePreview} onChange={(on) => set({ includePreview: on })} />
        <Toggle label="Include time per block" hint="Seconds spent on each block, useful for spotting speeders." checked={opts.includeTimings} onChange={(on) => set({ includeTimings: on })} />
        <div className="button-row">
          <Button variant="primary" icon="download" onClick={() => downloadFile(`${slug}-responses-${stamp}.csv`, responsesToCSV(survey, responses, opts), 'text/csv;charset=utf-8')}>
            Download CSV
          </Button>
          <Button icon="download" onClick={() => downloadFile(`${slug}-responses-${stamp}.json`, responsesJSON(survey, responses, opts.includePreview), 'application/json')}>
            Raw JSON
          </Button>
        </div>
      </section>
      <section className="panel">
        <header className="panel-head">
          <h2>Documentation</h2>
          <p className="hint">A codebook lists every column with its question text and value codes, for your methods section and data archive.</p>
        </header>
        <div className="button-row">
          <Button icon="file" onClick={() => downloadFile(`${slug}-codebook.csv`, codebookCSV(survey, opts), 'text/csv;charset=utf-8')}>
            Codebook (CSV)
          </Button>
          <Button icon="file" onClick={() => downloadFile(`${slug}-codebook.md`, codebookMarkdown(survey, opts), 'text/markdown;charset=utf-8')}>
            Codebook (Markdown)
          </Button>
          <Button icon="file" onClick={() => downloadFile(`${slug}-labels.sps`, spssSyntax(survey, opts), 'text/plain;charset=utf-8')}>
            SPSS label syntax
          </Button>
          <Button icon="file" onClick={() => downloadFile(`${slug}.survey.json`, JSON.stringify(survey, null, 2), 'application/json')}>
            Survey definition (JSON)
          </Button>
        </div>
      </section>
      <p className="hint export-note">
        <Icon name="info" size={15} /> Columns follow the version of the survey shown here. Answers to questions you’ve since deleted stay in the raw JSON.
      </p>
    </div>
  );
}
