'use client';
import { useCallback, useEffect, useState } from 'react';
import { Library, Search, Trash2 } from 'lucide-react';
import { Shell, ErrorNote } from '@/components/Shell';
import { CreateSurveyDialog } from '@/components/neon/CreateSurvey';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';

export interface LibraryItem {
  id: string;
  kind: 'QUESTION' | 'SURVEY';
  name: string;
  category: string;
  tags: string[];
  content: { id?: string; type?: string; text?: string; title?: string; pages?: Array<{ questions: unknown[] }> };
  updatedAt: string;
}

interface BuiltInTemplate {
  key: string;
  name: string;
  category: string;
  description: string;
  features: string[];
  questions: number;
}

type Pane = 'QUESTION' | 'SURVEY' | 'templates';

/**
 * The organization's question bank: questions and whole surveys saved for reuse, plus the built-in
 * templates. Questions are saved from the survey editor and inserted there; surveys start new ones.
 */
export default function QuestionBankPage() {
  const me = useMe();
  const canEdit = me?.role === 'ADMIN' || me?.role === 'PROGRAMMER';
  const [pane, setPane] = useState<Pane>('QUESTION');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [templates, setTemplates] = useState<BuiltInTemplate[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [useTemplate, setUseTemplate] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (pane === 'templates') setTemplates(await api<BuiltInTemplate[]>('/library/templates'));
      else setItems(await api<LibraryItem[]>(`/library?kind=${pane}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`));
    } catch (e) {
      setError(e);
    }
  }, [pane, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  const remove = async (item: LibraryItem) => {
    if (!window.confirm(`Remove "${item.name}" from the question bank?`)) return;
    try {
      await api(`/library/${item.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e);
    }
  };

  const tabs: Array<[Pane, string]> = [
    ['QUESTION', 'Saved questions'],
    ['SURVEY', 'Saved surveys'],
    ['templates', 'Built-in templates'],
  ];

  return (
    <Shell>
      <div className="nx-page-head">
        <h1>Question bank</h1>
        <p className="muted">
          Questions and surveys your team saved for reuse, and ready-made templates. Save a question from the survey editor with &ldquo;Save
          to question bank&rdquo;, and add it to another survey with &ldquo;Insert from question bank&rdquo;.
        </p>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div className="tabs" role="tablist" aria-label="Question bank">
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={pane === k} onClick={() => setPane(k)}>
              {label}
            </button>
          ))}
        </div>
        {pane !== 'templates' ? (
          <label className="nx-search-field">
            <Search size={16} aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by title, category or tag"
              aria-label="Search the question bank"
            />
          </label>
        ) : null}
      </div>
      <ErrorNote error={error} />
      {pane === 'templates' ? (
        <div className="library-grid">
          {(templates ?? []).map((t) => (
            <article key={t.key} className="panel library-card">
              <span className="muted small">
                {t.category} · {t.questions} questions
              </span>
              <h3>{t.name}</h3>
              <p className="small">{t.description}</p>
              <div className="nx-template-tags">
                {t.features.map((f) => (
                  <span key={f} className="badge">
                    {f}
                  </span>
                ))}
              </div>
              {canEdit ? (
                <button className="primary" onClick={() => setUseTemplate(`t:${t.key}`)}>
                  Use this template
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ) : items === null ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="panel empty-state">
          <Library size={28} aria-hidden="true" />
          <p>
            {q.trim()
              ? 'Nothing matches that search.'
              : pane === 'QUESTION'
                ? 'No saved questions yet. Open a survey, select a question and choose “Save to question bank”.'
                : 'No saved surveys yet. In a survey’s Programmer tab, choose “Save survey to question bank”.'}
          </p>
        </div>
      ) : (
        <div className="library-grid">
          {items.map((item) => (
            <article key={item.id} className="panel library-card">
              <span className="muted small">
                {item.category}
                {item.kind === 'QUESTION'
                  ? ` · ${item.content.type ?? ''} question`
                  : ` · ${item.content.pages?.reduce((n, p) => n + p.questions.length, 0) ?? 0} questions`}
              </span>
              <h3>{item.name}</h3>
              <p className="small">{item.kind === 'QUESTION' ? item.content.text : item.content.title}</p>
              {item.tags.length ? (
                <div className="nx-template-tags">
                  {item.tags.map((t) => (
                    <span key={t} className="badge">
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
              {canEdit ? (
                <div className="row" style={{ gap: 8 }}>
                  {item.kind === 'SURVEY' ? (
                    <button className="primary" onClick={() => setUseTemplate(`l:${item.id}`)}>
                      Start a survey from it
                    </button>
                  ) : null}
                  <button className="danger" onClick={() => void remove(item)} aria-label={`Remove ${item.name}`}>
                    <Trash2 size={14} aria-hidden="true" /> Remove
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
      <CreateSurveyDialog
        open={useTemplate !== null}
        mode="template"
        template={useTemplate ?? undefined}
        onClose={() => setUseTemplate(null)}
      />
    </Shell>
  );
}
