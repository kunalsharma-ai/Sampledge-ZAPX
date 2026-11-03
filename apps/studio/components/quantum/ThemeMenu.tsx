'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Monitor, Moon, Palette, Settings2, Sun } from 'lucide-react';
import { PRESET_LIST, PRESETS, type PresetId, type ThemeMode } from '@zapx/quantum';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { SegmentedControl } from './SegmentedControl';

/** Three-colour dot for a preset: its page colour and two accents, in the active scheme. */
function PresetDot({ id, scheme }: { id: PresetId; scheme: 'light' | 'dark' }) {
  const p = PRESETS[id];
  const seed = p[scheme];
  const accent = seed.accent ?? p.accents[0];
  return (
    <span
      className="q-preset-dot"
      aria-hidden="true"
      style={{ background: `linear-gradient(135deg, ${accent} 0 45%, ${p.accents[1]} 45% 70%, ${seed.bg} 70%)` }}
    />
  );
}

/**
 * Top-bar theme switcher: every preset and light/dark/system in one click, plus a link to the full
 * Appearance settings. A disclosure (button + panel); the presets are a radio group with arrow keys.
 */
export function ThemeMenu() {
  const { appearance, resolved, update } = useTheme();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const scheme = resolved.scheme;
  const current = PRESETS[appearance.preset];
  const index = PRESET_LIST.findIndex((p) => p.id === appearance.preset);

  useEffect(() => {
    if (!open) return;
    items.current[Math.max(0, index)]?.focus();
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // Focus the selected theme only when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const onPresetKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + PRESET_LIST.length) % PRESET_LIST.length;
    update({ preset: PRESET_LIST[next]!.id });
    items.current[next]?.focus();
  };

  return (
    <div className="q-theme-menu" ref={root} onKeyDown={onKey}>
      <button
        ref={trigger}
        type="button"
        className="q-theme-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Theme: ${current.name}`}
        title="Change theme"
        onClick={() => setOpen((o) => !o)}
        data-testid="theme-menu"
      >
        <Palette size={14} aria-hidden />
        <span className="q-theme-trigger-name">{current.name}</span>
        <ChevronDown size={13} aria-hidden className="q-theme-chevron" />
      </button>
      {open ? (
        <div id={panelId} className="q-theme-panel" role="dialog" aria-label="Theme">
          <SegmentedControl<ThemeMode>
            label="Colour mode"
            size="sm"
            value={appearance.mode}
            onChange={(mode) => update({ mode })}
            options={[
              {
                value: 'light',
                label: (
                  <>
                    <Sun size={13} aria-hidden /> Light
                  </>
                ),
              },
              {
                value: 'dark',
                label: (
                  <>
                    <Moon size={13} aria-hidden /> Dark
                  </>
                ),
              },
              {
                value: 'system',
                label: (
                  <>
                    <Monitor size={13} aria-hidden /> System
                  </>
                ),
              },
            ]}
          />
          <div role="radiogroup" aria-label="Theme" className="q-theme-list">
            {PRESET_LIST.map((p, i) => {
              const selected = p.id === appearance.preset;
              return (
                <button
                  key={p.id}
                  ref={(el) => {
                    items.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  className="q-theme-item"
                  onClick={() => update({ preset: p.id })}
                  onKeyDown={(e) => onPresetKey(e, i)}
                >
                  <PresetDot id={p.id} scheme={scheme} />
                  <span>{p.name}</span>
                  {selected ? <Check size={14} aria-hidden className="q-theme-check" /> : null}
                </button>
              );
            })}
          </div>
          <Link href="/appearance" className="q-theme-more" onClick={() => setOpen(false)} data-testid="appearance-link">
            <Settings2 size={14} aria-hidden /> All appearance settings
          </Link>
        </div>
      ) : null}
    </div>
  );
}
