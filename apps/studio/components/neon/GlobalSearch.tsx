'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { FileText, FolderKanban, Search } from 'lucide-react';
import { api } from '@/lib/api';

interface Results {
  projects: Array<{ id: string; name: string; client: string | null }>;
  surveys: Array<{ id: string; name: string; status: string; projectName: string }>;
}

/** Top-bar search over the projects and surveys the member can see (GET /api/dashboard/search). Ctrl+K focuses it. */
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const text = q.trim();
    if (!text) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      void api<Results>(`/dashboard/search?q=${encodeURIComponent(text)}`).then(
        (r) => {
          setResults(r);
          setActive(0);
        },
        () => setResults({ projects: [], surveys: [] }),
      );
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const items = results
    ? [
        ...results.surveys.map((s) => ({
          key: `s${s.id}`,
          href: `/surveys/${s.id}`,
          label: s.name,
          meta: `Survey · ${s.projectName} · ${s.status.toLowerCase()}`,
          kind: 'survey' as const,
        })),
        ...results.projects.map((p) => ({
          key: `p${p.id}`,
          href: `/projects/${p.id}`,
          label: p.name,
          meta: p.client ? `Project · ${p.client}` : 'Project',
          kind: 'project' as const,
        })),
      ]
    : [];

  const go = (href: string) => {
    setOpen(false);
    setQ('');
    router.push(href);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && items[active]) {
      e.preventDefault();
      go(items[active].href);
    } else if (e.key === 'Escape') {
      setOpen(false);
      input.current?.blur();
    }
  };

  const showList = open && q.trim().length > 0 && results !== null;
  return (
    <div className="nx-search" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)}>
      <Search size={16} aria-hidden="true" className="nx-search-icon" />
      <input
        ref={input}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && items[active] ? `${listId}-${active}` : undefined}
        aria-label="Search projects and surveys"
        placeholder="Search projects and surveys…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      <kbd className="nx-kbd" aria-hidden="true">
        Ctrl K
      </kbd>
      {showList ? (
        <ul className="nx-search-list" id={listId} role="listbox" aria-label="Search results">
          {items.length === 0 ? <li className="muted small nx-search-empty">Nothing matches “{q.trim()}”.</li> : null}
          {items.map((it, i) => (
            <li
              key={it.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                go(it.href);
              }}
            >
              {it.kind === 'survey' ? <FileText size={15} aria-hidden="true" /> : <FolderKanban size={15} aria-hidden="true" />}
              <span>
                <strong>{it.label}</strong>
                <span className="muted small">{it.meta}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
