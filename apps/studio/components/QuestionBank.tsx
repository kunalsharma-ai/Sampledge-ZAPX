'use client';
/**
 * Question bank in the survey editor: save the selected question for reuse, and insert a saved
 * question into the current page (renamed when its variable name is already taken).
 */
import { useState } from 'react';
import type { Question, SurveyDefinition } from '@zapx/survey-schema';
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
          setTitle(q.text.slice(0, 80) || q.id);
          setState('idle');
        }}
      >
        Save to question bank
      </button>
    );

  const save = async () => {
    setState('saving');
    setError(null);
    try {
      await api('/library', {
        body: {
          kind: 'QUESTION',
          name: title.trim() || q.id,
          category: category.trim() || 'General',
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          content: q,
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
      <h3 style={{ margin: 0 }}>Save {q.id} to the question bank</h3>
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
