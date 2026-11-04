'use client';
/**
 * Question bank in the survey editor: save the selected question (or a whole page, as a block) for
 * reuse, and insert a saved question into the current page or a block after it (renamed when a
 * variable name is already taken).
 */
import { useState } from 'react';
import type { BankBlock, Page, Question, SurveyDefinition } from '@zapx/survey-schema';
import { insertBankBlock } from '@zapx/logic-engine';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/Shell';

interface SavedQuestion {
  id: string;
  name: string;
  category: string;
  tags: string[];
  content: Question;
}

/** Every name already used for a variable in the survey. */
function usedNames(def: SurveyDefinition) {
  return new Set([
    ...def.pages.flatMap((p) => p.questions.map((q) => q.id)),
    ...(def.variables ?? []).map((v) => v.id),
    ...(def.loops ?? []).map((l) => l.id),
  ]);
}

/** A copy of a saved question with a variable name that is free in this survey. */
export function withFreeId(q: Question, def: SurveyDefinition): Question {
  const used = usedNames(def);
  if (!used.has(q.id)) return q;
  let n = 2;
  while (used.has(`${q.id}_${n}`)) n++;
  return { ...q, id: `${q.id}_${n}` };
}

export function SaveQuestionToBank({ q }: { q: Question }) {
  return <SaveToBank kind="QUESTION" content={q} what={q.id} button="Save to question bank" defaultTitle={q.text.slice(0, 80) || q.id} />;
}

/** Blueprint phase 4: save a page with all its questions as a reusable block. */
export function SavePageToBank({ page }: { page: Page }) {
  return (
    <SaveToBank
      kind="BLOCK"
      content={{ pages: [page] }}
      what={`page ${page.id} (${page.questions.length} question${page.questions.length === 1 ? '' : 's'})`}
      button="Save page to question bank as a block"
      defaultTitle={page.title || page.id}
    />
  );
}

function SaveToBank({
  kind,
  content,
  what,
  button,
  defaultTitle,
}: {
  kind: 'QUESTION' | 'BLOCK';
  content: unknown;
  what: string;
  button: string;
  defaultTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('General');
  const [tags, setTags] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<unknown>(null);

  if (!open)
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setTitle(defaultTitle);
          setState('idle');
        }}
      >
        {button}
      </button>
    );

  const save = async () => {
    setState('saving');
    setError(null);
    try {
      await api('/library', {
        body: {
          kind,
          name: title.trim() || defaultTitle,
          category: category.trim() || 'General',
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          content,
        },
      });
      setState('saved');
    } catch (e) {
      setError(e);
      setState('idle');
    }
  };

  return (
    <div className="flow-card stack">
      <h3 style={{ margin: 0 }}>Save {what} to the question bank</h3>
      {state === 'saved' ? (
        <p className="small">Saved. Anyone in your organization can now insert it from the question bank.</p>
      ) : (
        <>
          <label className="field">
            Title in the bank
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </label>
          <label className="field">
            Category
            <input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} placeholder="e.g. Demographics" />
          </label>
          <label className="field">
            Tags (comma separated)
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. age, screener" />
          </label>
        </>
      )}
      <ErrorNote error={error} />
      <div className="row" style={{ gap: 8 }}>
        {state !== 'saved' ? (
          <button type="button" className="primary" disabled={state === 'saving'} onClick={() => void save()}>
            {state === 'saving' ? 'Saving…' : 'Save'}
          </button>
        ) : null}
        <button type="button" onClick={() => setOpen(false)}>
          {state === 'saved' ? 'Close' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}

export function InsertFromBank({ def, onInsert }: { def: SurveyDefinition; onInsert: (q: Question) => void }) {
  const [items, setItems] = useState<SavedQuestion[] | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<unknown>(null);

  const show = async () => {
    setOpen(true);
    setError(null);
    try {
      setItems(await api<SavedQuestion[]>('/library?kind=QUESTION'));
    } catch (e) {
      setError(e);
    }
  };

  if (!open)
    return (
      <button type="button" className="link small" onClick={() => void show()}>
        + from question bank
      </button>
    );

  const f = filter.trim().toLowerCase();
  const shown = (items ?? []).filter(
    (i) =>
      !f || i.name.toLowerCase().includes(f) || i.category.toLowerCase().includes(f) || i.tags.some((t) => t.toLowerCase().includes(f)),
  );
  return (
    <div className="flow-card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>Insert from question bank</strong>
        <button type="button" className="link small" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" aria-label="Filter saved questions" />
      <ErrorNote error={error} />
      {items === null ? <p className="muted small">Loading…</p> : null}
      {items && shown.length === 0 ? <p className="muted small">{items.length ? 'Nothing matches.' : 'No saved questions yet.'}</p> : null}
      <div className="bank-picker">
        {shown.map((i) => (
          <button
            type="button"
            key={i.id}
            onClick={() => {
              onInsert(withFreeId(i.content, def));
              setOpen(false);
            }}
          >
            <strong className="small">{i.name}</strong>
            <span className="muted small">
              {i.category} · {i.content.type} · {i.content.id}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface SavedBlock {
  id: string;
  name: string;
  category: string;
  tags: string[];
  content: BankBlock;
}

/** Blueprint phase 4: insert a saved block of pages after a page, with clashing names renamed. */
export function InsertBlockFromBank({
  def,
  after,
  onInsert,
}: {
  def: SurveyDefinition;
  after: number;
  onInsert: (d: SurveyDefinition, renamed: Record<string, string>) => void;
}) {
  const [items, setItems] = useState<SavedBlock[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const show = async () => {
    setOpen(true);
    setError(null);
    try {
      setItems(await api<SavedBlock[]>('/library?kind=BLOCK'));
    } catch (e) {
      setError(e);
    }
  };
  if (!open)
    return (
      <button type="button" className="link small" onClick={() => void show()}>
        + block from bank
      </button>
    );
  return (
    <div className="flow-card stack" data-testid="insert-block">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>Insert a block after {def.pages[after]?.id}</strong>
        <button type="button" className="link small" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <ErrorNote error={error} />
      {items === null ? <p className="muted small">Loading…</p> : null}
      {items && !items.length ? <p className="muted small">No saved blocks yet. Select a page and save it to the bank as a block.</p> : null}
      <div className="bank-picker">
        {(items ?? []).map((i) => {
          const questions = i.content.pages.reduce((n, p) => n + p.questions.length, 0);
          return (
            <button
              type="button"
              key={i.id}
              onClick={() => {
                const r = insertBankBlock(def, i.content, after);
                onInsert(r.def, r.renamed);
                setOpen(false);
              }}
            >
              <strong className="small">{i.name}</strong>
              <span className="muted small">
                {i.category} · {i.content.pages.length} page{i.content.pages.length === 1 ? '' : 's'}, {questions} question{questions === 1 ? '' : 's'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
