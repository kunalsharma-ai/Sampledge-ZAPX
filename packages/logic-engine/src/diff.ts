/**
 * Structured diff between two survey definitions, used to review change sets (AI proposals,
 * imports) before they are applied. Items are keyed by id, so reordering is reported as a move
 * rather than as a delete plus an add.
 */
import type { Question, SurveyDefinition } from '@zapx/survey-schema';

export type DiffEntity = 'survey' | 'settings' | 'page' | 'question' | 'termination' | 'quota';

export interface DiffItem {
  change: 'added' | 'removed' | 'changed' | 'moved';
  entity: DiffEntity;
  id: string;
  /** Page holding the question (after the change, or before it for removals). */
  pageId?: string;
  /** Field names that changed (for `changed`). */
  fields?: string[];
  before?: unknown;
  after?: unknown;
  /** One-line, human-readable description. */
  summary: string;
}

export interface SurveyDiff {
  items: DiffItem[];
  counts: { added: number; removed: number; changed: number; moved: number };
  /** True if any change can alter stored data (ids, answer codes, question types removed). */
  affectsData: boolean;
}

function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );
}

function changedFields(a: Record<string, unknown>, b: Record<string, unknown>, ignore: string[] = []): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => !ignore.includes(k) && stable(a[k]) !== stable(b[k])).sort();
}

function shortText(t: string, n = 60): string {
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function codesOf(q: Question): number[] {
  if (q.type === 'single' || q.type === 'multi') return q.options.map((o) => o.code);
  if (q.type === 'grid') return q.columns.map((o) => o.code);
  return [];
}

function keyed<T extends { id: string }>(list: T[]): Map<string, { item: T; index: number }> {
  return new Map(list.map((item, index) => [item.id, { item, index }]));
}

export function diffSurveys(before: SurveyDefinition, after: SurveyDefinition): SurveyDiff {
  const items: DiffItem[] = [];
  let affectsData = false;

  const meta = changedFields(
    { title: before.title, language: before.language, welcome: before.welcome, thankYou: before.thankYou },
    { title: after.title, language: after.language, welcome: after.welcome, thankYou: after.thankYou },
  );
  if (meta.length)
    items.push({ change: 'changed', entity: 'survey', id: 'survey', fields: meta, summary: `Survey ${meta.join(', ')} changed` });
  const settings = changedFields(before.settings, after.settings);
  if (settings.length) {
    items.push({
      change: 'changed',
      entity: 'settings',
      id: 'settings',
      fields: settings,
      before: before.settings,
      after: after.settings,
      summary: `Settings changed: ${settings.join(', ')}`,
    });
  }

  // Pages
  const pb = keyed(before.pages);
  const pa = keyed(after.pages);
  for (const [id, { item, index }] of pa) {
    const old = pb.get(id);
    if (!old) {
      items.push({
        change: 'added',
        entity: 'page',
        id,
        after: { title: item.title, condition: item.condition },
        summary: `Page ${id} added${item.title ? ` (“${shortText(item.title)}”)` : ''}`,
      });
      continue;
    }
    const f = changedFields(old.item, item, ['questions']);
    if (f.length)
      items.push({
        change: 'changed',
        entity: 'page',
        id,
        fields: f,
        before: { title: old.item.title, condition: old.item.condition },
        after: { title: item.title, condition: item.condition },
        summary: `Page ${id}: ${f.join(', ')} changed`,
      });
    else if (old.index !== index)
      items.push({ change: 'moved', entity: 'page', id, summary: `Page ${id} moved from position ${old.index + 1} to ${index + 1}` });
  }
  for (const [id] of pb) if (!pa.has(id)) items.push({ change: 'removed', entity: 'page', id, summary: `Page ${id} removed` });

  // Questions (identified by id across pages)
  const qPos = (def: SurveyDefinition) => {
    const m = new Map<string, { q: Question; pageId: string; index: number }>();
    let i = 0;
    for (const p of def.pages) for (const q of p.questions) m.set(q.id, { q, pageId: p.id, index: i++ });
    return m;
  };
  const qb = qPos(before);
  const qa = qPos(after);
  for (const [id, cur] of qa) {
    const old = qb.get(id);
    if (!old) {
      items.push({
        change: 'added',
        entity: 'question',
        id,
        pageId: cur.pageId,
        after: cur.q,
        summary: `${id} added (${cur.q.type}): “${shortText(cur.q.text)}”`,
      });
      continue;
    }
    const f = changedFields(old.q as unknown as Record<string, unknown>, cur.q as unknown as Record<string, unknown>);
    if (f.length) {
      if (f.includes('type')) affectsData = true;
      const removedCodes = codesOf(old.q).filter((c) => !codesOf(cur.q).includes(c));
      if (removedCodes.length) affectsData = true;
      const extra = removedCodes.length ? `; answer codes removed: ${removedCodes.join(', ')}` : '';
      items.push({
        change: 'changed',
        entity: 'question',
        id,
        pageId: cur.pageId,
        fields: f,
        before: old.q,
        after: cur.q,
        summary: `${id}: ${f.join(', ')} changed${extra}`,
      });
    } else if (old.pageId !== cur.pageId) {
      items.push({
        change: 'moved',
        entity: 'question',
        id,
        pageId: cur.pageId,
        summary: `${id} moved from page ${old.pageId} to ${cur.pageId}`,
      });
    }
  }
  for (const [id, old] of qb) {
    if (!qa.has(id)) {
      affectsData = true;
      items.push({
        change: 'removed',
        entity: 'question',
        id,
        pageId: old.pageId,
        before: old.q,
        summary: `${id} removed: “${shortText(old.q.text)}”`,
      });
    }
  }

  // Terminations and quotas
  for (const [entity, b, a] of [
    ['termination', before.terminations, after.terminations],
    ['quota', before.quotas, after.quotas],
  ] as const) {
    const mb = keyed<{ id: string }>(b);
    const ma = keyed<{ id: string }>(a);
    for (const [id, { item }] of ma) {
      const old = mb.get(id);
      const desc = (x: unknown) => {
        const r = x as { condition: string; target?: number };
        return r.target === undefined ? r.condition : `${r.condition} (target ${r.target})`;
      };
      if (!old)
        items.push({
          change: 'added',
          entity,
          id,
          after: item,
          summary: `${entity === 'quota' ? 'Quota' : 'Termination'} ${id} added: ${desc(item)}`,
        });
      else {
        const f = changedFields(old.item, item);
        if (f.length)
          items.push({
            change: 'changed',
            entity,
            id,
            fields: f,
            before: old.item,
            after: item,
            summary: `${entity === 'quota' ? 'Quota' : 'Termination'} ${id}: ${f.join(', ')} changed`,
          });
      }
    }
    for (const [id, { item }] of mb) {
      if (!ma.has(id))
        items.push({
          change: 'removed',
          entity,
          id,
          before: item,
          summary: `${entity === 'quota' ? 'Quota' : 'Termination'} ${id} removed`,
        });
    }
  }

  const counts = { added: 0, removed: 0, changed: 0, moved: 0 };
  for (const i of items) counts[i.change] += 1;
  return { items, counts, affectsData };
}
