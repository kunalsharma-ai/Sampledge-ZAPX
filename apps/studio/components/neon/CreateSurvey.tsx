'use client';
import { useEffect, useRef, useState } from 'react';
import { FileUp, LayoutTemplate, PenLine, Sparkles, X } from 'lucide-react';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/Shell';

export type StartMode = 'blank' | 'template' | 'ai' | 'import';

interface ProjectOption {
  id: string;
  name: string;
}

const NEW = '__new__';

/** A built-in template, or a survey the organization saved to its question bank. */
interface TemplateOption {
  /** `t:<key>` for built-in, `l:<id>` for saved. */
  value: string;
  name: string;
  category: string;
  description: string;
  features: string[];
}

export function useTemplates(active: boolean) {
  const [templates, setTemplates] = useState<TemplateOption[] | null>(null);
  useEffect(() => {
    if (!active || templates) return;
    void Promise.all([
      api<Array<{ key: string; name: string; category: string; description: string; features: string[] }>>('/library/templates'),
      api<Array<{ id: string; name: string; category: string; tags: string[] }>>('/library?kind=SURVEY').catch(() => []),
    ]).then(([built, saved]) =>
      setTemplates([
        ...saved.map((s) => ({
          value: `l:${s.id}`,
          name: s.name,
          category: `Your organization · ${s.category}`,
          description: '',
          features: s.tags,
        })),
        ...built.map((t) => ({
          value: `t:${t.key}`,
          name: t.name,
          category: t.category,
          description: t.description,
          features: t.features,
        })),
      ]),
    );
  }, [active, templates]);
  return templates;
}

/** The request body fields that start a survey from the chosen template. */
export const templateBody = (value: string) =>
  value.startsWith('t:') ? { template: value.slice(2) } : value.startsWith('l:') ? { libraryItemId: value.slice(2) } : {};

/**
 * Create a survey from anywhere on the dashboard: pick (or create) its project, give it a title and
 * choose how to start. "Describe it to AI" and "Import a questionnaire" open the survey's AI & import
 * tab, where the AI architect or the file import drafts a change set for review.
 */
export function CreateSurveyDialog({
  open,
  mode: initialMode,
  template: initialTemplate,
  onClose,
}: {
  open: boolean;
  mode: StartMode;
  /** Preselected template (`t:<key>` or `l:<id>`). */
  template?: string;
  onClose: () => void;
}) {
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [projectId, setProjectId] = useState('');
  const [newProject, setNewProject] = useState('');
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<StartMode>(initialMode);
  const [prompt, setPrompt] = useState('');
  const [template, setTemplate] = useState('');
  const templates = useTemplates(open && mode === 'template');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const first = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    if (initialTemplate) setTemplate(initialTemplate);
    setError(null);
    void api<ProjectOption[]>('/projects').then((p) => {
      setProjects(p);
      setProjectId((cur) => cur || (p[0]?.id ?? NEW));
    }, setError);
    setTimeout(() => first.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, initialMode, initialTemplate, onClose]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let pid = projectId;
      if (pid === NEW) pid = (await api<{ id: string }>('/projects', { body: { name: newProject.trim() } })).id;
      const s = await api<{ id: string }>(`/projects/${pid}/surveys`, {
        body: { name: title.trim(), ...(mode === 'template' ? templateBody(template) : {}) },
      });
      const params = new URLSearchParams();
      if (mode === 'ai' || mode === 'import') params.set('tab', 'assist');
      if (mode === 'ai' && prompt.trim()) params.set('prompt', prompt.trim());
      if (mode === 'import') params.set('focus', 'import');
      window.location.href = `/surveys/${s.id}${params.size ? `?${params}` : ''}`;
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const options: Array<[StartMode, string, string, typeof PenLine]> = [
    ['blank', 'Start blank', 'Build it in the visual editor', PenLine],
    ['template', 'Use a template', 'Ready-made, tested surveys', LayoutTemplate],
    ['ai', 'Describe it to AI', 'The AI architect drafts it for your review', Sparkles],
    ['import', 'Import a questionnaire', 'Word, PDF, Excel or text file', FileUp],
  ];

  return (
    <div className="nx-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="nx-modal panel stack" role="dialog" aria-modal="true" aria-labelledby="create-survey-title" onSubmit={submit}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="create-survey-title" style={{ margin: 0 }}>
            Create a survey
          </h2>
          <button type="button" className="nx-icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <label className="field">
          Project
          <select ref={first} value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={projects === null}>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value={NEW}>+ New project…</option>
          </select>
        </label>
        {projectId === NEW ? (
          <label className="field">
            New project title
            <input
              required
              value={newProject}
              onChange={(e) => setNewProject(e.target.value)}
              placeholder="e.g. Cardiologist brand tracker W1"
            />
          </label>
        ) : null}
        <label className="field">
          Survey title
          <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Brand satisfaction survey" />
        </label>
        <div role="radiogroup" aria-label="How to start" className="nx-start-options">
          {options.map(([k, label, hint, Icon]) => (
            <button type="button" key={k} role="radio" aria-checked={mode === k} className="nx-start-option" onClick={() => setMode(k)}>
              <Icon size={18} aria-hidden="true" />
              <strong>{label}</strong>
              <span className="muted small">{hint}</span>
            </button>
          ))}
        </div>
        {mode === 'template' ? (
          <div role="radiogroup" aria-label="Template" className="nx-template-list">
            {templates === null ? <p className="muted small">Loading templates…</p> : null}
            {(templates ?? []).map((t) => (
              <button
                type="button"
                key={t.value}
                role="radio"
                aria-checked={template === t.value}
                className="nx-template"
                onClick={() => setTemplate(t.value)}
              >
                <span className="muted small">{t.category}</span>
                <strong>{t.name}</strong>
                {t.description ? <span className="small">{t.description}</span> : null}
                {t.features.length ? (
                  <span className="nx-template-tags">
                    {t.features.map((f) => (
                      <span key={f} className="badge">
                        {f}
                      </span>
                    ))}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
        {mode === 'ai' ? (
          <label className="field">
            What should the survey cover?
            <textarea
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. A 15-minute brand satisfaction survey for UK grocery shoppers, with screening, awareness, usage and NPS."
            />
          </label>
        ) : null}
        <ErrorNote error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || (mode === 'template' && !template)}>
            {busy ? 'Creating…' : 'Create survey'}
          </button>
        </div>
      </form>
    </div>
  );
}
