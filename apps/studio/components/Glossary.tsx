'use client';
/** The organization's glossary for one language: required translations of terms (blueprint phase 2). */
import { useCallback, useEffect, useState } from 'react';
import type { GlossaryTerm } from '@zapx/logic-engine';
import { api } from '@/lib/api';
import { ErrorNote } from './Shell';

export interface StoredTerm extends GlossaryTerm {
  id: string;
}

export function useGlossary(language: string | undefined) {
  const [terms, setTerms] = useState<StoredTerm[]>([]);
  const reload = useCallback(async () => {
    if (!language) return setTerms([]);
    try {
      const rows = await api<Array<{ id: string; source: string; target: string; note: string | null }>>(
        `/glossary?language=${encodeURIComponent(language)}`,
      );
      setTerms(rows.map((r) => ({ id: r.id, source: r.source, target: r.target, note: r.note ?? undefined })));
    } catch {
      setTerms([]);
    }
  }, [language]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { terms, reload };
}

export function GlossaryEditor({
  language,
  name,
  terms,
  onChanged,
  readOnly,
}: {
  language: string;
  name: string;
  terms: StoredTerm[];
  onChanged: () => void;
  readOnly: boolean;
}) {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<unknown>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api('/glossary', { body: { language, source: source.trim(), target: target.trim() } });
      setSource('');
      setTarget('');
      onChanged();
    } catch (err) {
      setError(err);
    }
  };
  const remove = async (id: string) => {
    try {
      await api(`/glossary/${id}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <details className="flow-card" data-testid="glossary">
      <summary>
        <strong>Glossary for {name}</strong> <span className="muted small">({terms.length} terms, shared by your organization)</span>
      </summary>
      <p className="muted small">
        Brand names and fixed terms. AI translation is told to use them, and the checks below warn when a translation does not.
      </p>
      {terms.length ? (
        <table className="data small">
          <thead>
            <tr>
              <th>Term</th>
              <th>Always translate as</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {terms.map((t) => (
              <tr key={t.id}>
                <td>{t.source}</td>
                <td dir="auto">{t.target}</td>
                <td>
                  {!readOnly ? (
                    <button className="link small" onClick={() => void remove(t.id)} aria-label={`Remove glossary term ${t.source}`}>
                      Remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {!readOnly ? (
        <form className="row" style={{ gap: 6, marginTop: 8 }} onSubmit={add}>
          <input
            aria-label="Glossary term"
            placeholder="Term, e.g. Acme Pro"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            required
          />
          <input
            aria-label="Glossary translation"
            placeholder="Translation"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            required
            dir="auto"
          />
          <button>Add term</button>
        </form>
      ) : null}
      <ErrorNote error={error} />
    </details>
  );
}
