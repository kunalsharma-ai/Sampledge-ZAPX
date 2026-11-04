/**
 * Inserting a question bank block (blueprint phase 4): pages copied into a survey, with page ids
 * and variable names that clash renamed (Q1 becomes Q1_2), and the block's own conditions,
 * validations, piping and dynamic lists updated to the new names. Logic that points outside the
 * block (to a screener question, say) is kept as written and checked by the survey analysis.
 */
import type { BankBlock, Page, SurveyDefinition } from '@zapx/survey-schema';


function free(base: string, used: Set<string>) {
  if (!used.has(base.toLowerCase())) return base;
  let n = 2;
  while (used.has(`${base}_${n}`.toLowerCase())) n++;
  return `${base}_${n}`;
}

/** Replace whole identifiers in a logic expression, leaving text inside quotes alone. */
function renameInExpr(expr: string, map: Map<string, string>) {
  return expr.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*/g, (m) => (m[0] === '"' || m[0] === "'" ? m : (map.get(m) ?? m)));
}
/** Replace piping like {{Q1}} or {{Q1.label}} in text. */
function renameInText(text: string, map: Map<string, string>) {
  return text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)/g, (m, id: string) => (map.has(id) ? m.replace(id, map.get(id)!) : m));
}

function rewrite(node: unknown, map: Map<string, string>, key = ''): unknown {
  if (typeof node === 'string') {
    if (key === 'condition' || key === 'expr') return renameInExpr(node, map);
    return renameInText(node, map);
  }
  if (Array.isArray(node)) return node.map((x) => rewrite(x, map, key));
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'id' && typeof v === 'string') out[k] = v;
      else if (k === 'question' && key === 'optionsFrom' && typeof v === 'string') out[k] = map.get(v) ?? v;
      else out[k] = rewrite(v, map, k);
    }
    return out;
  }
  return node;
}

export interface InsertedBlock {
  def: SurveyDefinition;
  /** Old name to new name, for every page id and variable that had to change. */
  renamed: Record<string, string>;
  /** Ids of the pages added. */
  pages: string[];
}

/** Insert the block's pages after page `afterIndex` (-1 for the start, default the end). */
export function insertBankBlock(def: SurveyDefinition, block: BankBlock, afterIndex = def.pages.length - 1): InsertedBlock {
  const usedVars = new Set(
    [
      ...def.pages.flatMap((p) => p.questions.map((q) => q.id)),
      ...(def.variables ?? []).map((v) => v.id),
      ...(def.recodes ?? []).map((v) => v.id),
      ...(def.loops ?? []).map((l) => l.id),
      ...(def.urlVariables ?? []).map((u) => u.id),
    ].map((x) => x.toLowerCase()),
  );
  const usedPages = new Set(def.pages.map((p) => p.id.toLowerCase()));
  const varMap = new Map<string, string>();
  const renamed: Record<string, string> = {};
  for (const p of block.pages)
    for (const q of p.questions) {
      const id = free(q.id, usedVars);
      usedVars.add(id.toLowerCase());
      if (id !== q.id) {
        varMap.set(q.id, id);
        renamed[q.id] = id;
      }
    }
  const pages: Page[] = block.pages.map((p) => {
    const id = free(p.id, usedPages);
    usedPages.add(id.toLowerCase());
    if (id !== p.id) renamed[p.id] = id;
    const body = rewrite(p, varMap) as Page;
    return { ...body, id, questions: body.questions.map((q) => ({ ...q, id: varMap.get(q.id) ?? q.id })) };
  });
  const at = Math.max(-1, Math.min(afterIndex, def.pages.length - 1)) + 1;
  return { def: { ...def, pages: [...def.pages.slice(0, at), ...pages, ...def.pages.slice(at)] }, renamed, pages: pages.map((p) => p.id) };
}

