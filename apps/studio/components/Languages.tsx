'use client';
/**
 * Global Language Studio: add languages, translate with AI or by hand, and review every text.
 * A language is offered to respondents only when it is enabled, and publishing requires every
 * enabled language to be complete and reviewed by a person.
 */
import { useMemo, useState } from 'react';
import { textKeys, translationQa, translationStatus, type TranslationIssue } from '@zapx/logic-engine';
import { LANGUAGE_TAG, textDirection, type Language, type Presentation, type SurveyDefinition } from '@zapx/survey-schema';
import { api } from '@/lib/api';
import { ErrorNote } from './Shell';
import { GlossaryEditor, useGlossary } from './Glossary';

type RowState = 'missing' | 'outdated' | 'machine' | 'reviewed';

export function Languages({
  surveyId,
  def,
  presentation,
  readOnly,
  dirty,
  aiConfigured,
  onChange,
  onServerUpdate,
}: {
  surveyId: string;
  def: SurveyDefinition;
  presentation: Presentation;
  readOnly: boolean;
  /** Unsaved edits exist (AI translation runs on the saved draft). */
  dirty: boolean;
  aiConfigured: boolean;
  onChange: (p: Presentation) => void;
  /** Called with the server's saved draft after AI translation. */
  onServerUpdate: (version: { updatedAt: string; presentation: unknown }) => void;
}) {
  const [selected, setSelected] = useState<string | null>(presentation.languages[0]?.tag ?? null);
  const [newTag, setNewTag] = useState('');
  const [newName, setNewName] = useState('');
  const [filter, setFilter] = useState<'attention' | 'all'>('attention');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const keys = useMemo(() => textKeys(def, presentation), [def, presentation]);
  const statuses = useMemo(() => translationStatus(def, presentation), [def, presentation]);
  const lang = presentation.languages.find((l) => l.tag === selected);
  const glossary = useGlossary(lang?.tag);
  // Per-language QA warnings (glossary, length, unchanged); blockers are shown by the status column.
  const warnings = useMemo(() => {
    const by = new Map<string, TranslationIssue[]>();
    if (!lang) return by;
    for (const i of translationQa(def, presentation, lang.tag, glossary.terms))
      if (i.severity === 'warning') by.set(i.key, [...(by.get(i.key) ?? []), i]);
    return by;
  }, [def, presentation, lang, glossary.terms]);

  const updateLang = (tag: string, fn: (l: Language) => Language) =>
    onChange({ ...presentation, languages: presentation.languages.map((l) => (l.tag === tag ? fn(l) : l)) });

  const add = () => {
    const tag = newTag.trim();
    if (!LANGUAGE_TAG.test(tag)) return setError(new Error('Use a language tag such as fr, es-MX or zh-Hans.'));
    if (tag === def.language || presentation.languages.some((l) => l.tag === tag))
      return setError(new Error('That language is already in the survey.'));
    setError(null);
    onChange({ ...presentation, languages: [...presentation.languages, { tag, name: newName.trim() || tag, enabled: false, texts: {} }] });
    setSelected(tag);
    setNewTag('');
    setNewName('');
  };

  const translate = async () => {
    if (!lang) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ translated: number; requested: number; model: string; version: { updatedAt: string; presentation: unknown } }>(
        `/surveys/${surveyId}/translate`,
        {
          method: 'POST',
          body: { language: lang.tag },
        },
      );
      onServerUpdate(r.version);
      setNotice(
        r.requested === 0
          ? 'Nothing to translate: every text already has a current translation.'
          : `${r.translated} of ${r.requested} texts translated by ${r.model}. Review them below before offering this language.`,
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const fillFromMemory = async () => {
    if (!lang) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ reused: number; memorySize: number; version: { updatedAt: string; presentation: unknown } }>(
        `/surveys/${surveyId}/translation-memory`,
        {
          method: 'POST',
          body: { language: lang.tag },
        },
      );
      onServerUpdate(r.version);
      setNotice(
        r.reused
          ? `${r.reused} texts filled from translations your team already approved in other surveys.`
          : `No matches in the translation memory (${r.memorySize} approved ${lang.name} texts in your other surveys).`,
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const rowState = (l: Language, key: string, source: string): RowState => {
    const e = l.texts[key];
    if (!e || !e.text.trim()) return 'missing';
    if (e.source !== source) return 'outdated';
    return e.status;
  };

  const status = statuses.find((s) => s.tag === selected);
  const rows = lang
    ? keys.filter(
        (k) =>
          filter === 'all' ||
          rowState(lang, k.key, k.source) !== 'reviewed' ||
          status?.placeholderMismatch.includes(k.key) ||
          warnings.has(k.key),
      )
    : [];

  return (
    <div className="editor" style={{ gridTemplateColumns: '280px minmax(0,1fr)' }}>
      <aside className="panel stack">
        <h2>Languages</h2>
        <label className="field">
          Source language ({def.language})
          <input
            value={presentation.sourceLanguageName ?? ''}
            placeholder="e.g. English"
            disabled={readOnly}
            onChange={(e) => onChange({ ...presentation, sourceLanguageName: e.target.value || undefined })}
          />
        </label>
        <div className="stack" style={{ gap: 6 }}>
          {statuses.map((s) => (
            <button
              key={s.tag}
              onClick={() => setSelected(s.tag)}
              aria-current={selected === s.tag}
              style={{ textAlign: 'left', fontWeight: 400 }}
            >
              <strong>{s.name}</strong> <span className="mono small">{s.tag}</span>{' '}
              <span className={`badge ${s.complete ? 'good' : 'warn'}`}>{s.complete ? 'ready' : `${s.reviewed}/${s.total} reviewed`}</span>
              <div className="muted small">{s.enabled ? 'Offered to respondents' : 'Not offered yet'}</div>
            </button>
          ))}
        </div>
        {!readOnly ? (
          <div className="stack" style={{ gap: 6 }}>
            <h3 style={{ margin: '8px 0 0' }}>Add a language</h3>
            <div className="row" style={{ gap: 6 }}>
              <input
                aria-label="Language tag"
                placeholder="fr"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                style={{ width: 70 }}
              />
              <input
                aria-label="Language name"
                placeholder="Français"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
            <button onClick={add} disabled={!newTag.trim()}>
              Add language
            </button>
          </div>
        ) : null}
      </aside>

      <div className="panel stack" data-testid="language-panel">
        <ErrorNote error={error} />
        {notice ? <p className="ok-text">{notice}</p> : null}
        {!lang || !status ? (
          <p className="muted">Add a language to start translating. Translations never change question ids, answer codes or logic.</p>
        ) : (
          <>
            <div className="row">
              <h2 style={{ margin: 0 }}>
                {lang.name} <span className="mono small muted">{lang.tag}</span>
              </h2>
              <div style={{ flex: 1 }} />
              {!readOnly ? (
                <>
                  <label
                    className="check"
                    title={status.complete ? '' : 'Publishing is blocked until this language is complete and reviewed'}
                  >
                    <input
                      type="checkbox"
                      checked={lang.enabled}
                      onChange={(e) => updateLang(lang.tag, (l) => ({ ...l, enabled: e.target.checked }))}
                    />
                    Offer to respondents
                  </label>
                  <button
                    className="danger"
                    onClick={() => {
                      if (!window.confirm(`Remove ${lang.name} and all its translations?`)) return;
                      onChange({ ...presentation, languages: presentation.languages.filter((l) => l.tag !== lang.tag) });
                      setSelected(null);
                    }}
                  >
                    Remove
                  </button>
                </>
              ) : null}
            </div>
            <p className="small" data-testid="language-summary">
              {status.translated} of {status.total} translated · {status.reviewed} reviewed
              {status.missing.length ? ` · ${status.missing.length} missing` : ''}
              {status.outdated.length ? ` · ${status.outdated.length} outdated (source changed)` : ''}
              {status.unreviewed.length ? ` · ${status.unreviewed.length} AI translations to review` : ''}
              {status.placeholderMismatch.length ? ` · ${status.placeholderMismatch.length} with broken {{piping}}` : ''}
              {warnings.size ? ` · ${warnings.size} with checks to look at` : ''}
              {textDirection(lang.tag) === 'rtl' ? ' · written right to left' : ''}
            </p>
            <GlossaryEditor
              language={lang.tag}
              name={lang.name}
              terms={glossary.terms}
              onChanged={() => void glossary.reload()}
              readOnly={readOnly}
            />
            {lang.enabled && !status.complete ? (
              <p className="error-text small">
                This language is offered to respondents, so publishing is blocked until every text is translated and reviewed.
              </p>
            ) : null}
            {!readOnly ? (
              <div className="row">
                <button
                  className="primary"
                  onClick={translate}
                  disabled={busy || dirty || !aiConfigured}
                  title={aiConfigured ? '' : 'AI is not configured on this server'}
                >
                  {busy ? 'Working…' : 'Translate missing with AI'}
                </button>
                <button
                  onClick={() => void fillFromMemory()}
                  disabled={busy || dirty}
                  title="Reuse translations your team approved in other surveys"
                >
                  Fill from translation memory
                </button>
                <button
                  onClick={() =>
                    updateLang(lang.tag, (l) => ({
                      ...l,
                      texts: Object.fromEntries(
                        Object.entries(l.texts).map(([k, e]) => [
                          k,
                          e.source === keys.find((x) => x.key === k)?.source && e.text.trim() ? { ...e, status: 'reviewed' as const } : e,
                        ]),
                      ),
                    }))
                  }
                  disabled={!status.unreviewed.length}
                >
                  Mark all current translations reviewed
                </button>
                {dirty ? (
                  <span className="small" style={{ color: 'var(--warn)' }}>
                    Save first: AI and the memory work on the saved draft.
                  </span>
                ) : null}
                {!aiConfigured ? <span className="muted small">AI is not configured; translate by hand below.</span> : null}
              </div>
            ) : null}
            <div className="row">
              <label className="check">
                <input type="radio" name="lang-filter" checked={filter === 'attention'} onChange={() => setFilter('attention')} /> Needs
                attention
              </label>
              <label className="check">
                <input type="radio" name="lang-filter" checked={filter === 'all'} onChange={() => setFilter('all')} /> All texts
              </label>
            </div>
            <table className="data small" data-testid="translation-grid">
              <thead>
                <tr>
                  <th style={{ width: '38%' }}>Source</th>
                  <th>{lang.name}</th>
                  <th style={{ width: 110 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((k) => {
                  const st = rowState(lang, k.key, k.source);
                  const entry = lang.texts[k.key];
                  const broken = status.placeholderMismatch.includes(k.key);
                  return (
                    <tr key={k.key}>
                      <td>
                        <div>{k.source}</div>
                        <div className="muted mono" style={{ fontSize: 10.5 }}>
                          {k.context}
                        </div>
                      </td>
                      <td>
                        <textarea
                          aria-label={`${lang.name}: ${k.context}`}
                          rows={Math.min(4, Math.max(1, Math.ceil(k.source.length / 60)))}
                          value={entry?.text ?? ''}
                          readOnly={readOnly}
                          onChange={(e) =>
                            updateLang(lang.tag, (l) => ({
                              ...l,
                              texts: { ...l.texts, [k.key]: { text: e.target.value, source: k.source, status: 'reviewed' } },
                            }))
                          }
                          dir={textDirection(lang.tag)}
                          style={{ fontFamily: 'inherit', fontSize: 13 }}
                        />
                        {(warnings.get(k.key) ?? []).map((w, i) => (
                          <div key={i} className="small" style={{ color: 'var(--warn)' }}>
                            {w.message}
                          </div>
                        ))}
                        {st === 'outdated' && entry ? <div className="muted small">Translated from: “{entry.source}”</div> : null}
                        {broken ? (
                          <div className="error-text small">
                            Keep the placeholders from the source, such as {'{{Q1}}'} or {'{n}'}.
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <span className={`badge ${st === 'reviewed' && !broken ? 'good' : st === 'missing' || broken ? 'bad' : 'warn'}`}>
                          {st === 'machine' ? 'AI, to review' : st}
                        </span>
                        {st === 'machine' && !readOnly ? (
                          <button
                            className="link small"
                            onClick={() =>
                              updateLang(lang.tag, (l) => ({
                                ...l,
                                texts: { ...l.texts, [k.key]: { ...l.texts[k.key]!, status: 'reviewed' } },
                              }))
                            }
                          >
                            Approve
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="ok-text">
                      Every text is translated and reviewed.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
