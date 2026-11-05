/**
 * Static logic inspection: finds problems in a survey before anyone takes it.
 *
 * Errors block publishing. Warnings are shown to the programmer but do not block.
 */
import { qualitySettingsOf, scaleCodes, type Question, type SurveyDefinition } from '@zapx/survey-schema';
import { ExpressionError, FUNCTIONS, evaluate, parse, references, truthy, type Node, type Value } from './expression.js';
import { PIPE_PATTERN } from './interview.js';
import { checkFlow, compileSurvey } from './flow.js';

export type IssueSeverity = 'error' | 'warning';

export interface LogicIssue {
  severity: IssueSeverity;
  code:
    | 'PARSE_ERROR'
    | 'UNDEFINED_VARIABLE'
    | 'FORWARD_REFERENCE'
    | 'NOT_A_VALUE'
    | 'INVALID_MEMBER'
    | 'UNKNOWN_FUNCTION'
    | 'WRONG_ARGUMENT_COUNT'
    | 'UNKNOWN_OPTION_CODE'
    | 'MULTI_EQUALITY'
    | 'DUPLICATE_ID'
    | 'DUPLICATE_CODE'
    | 'IMPOSSIBLE_CONDITION'
    | 'ALWAYS_TERMINATES'
    | 'UNREACHABLE'
    | 'INVALID_RANGE'
    | 'PIPING_UNDEFINED'
    | 'ZERO_QUOTA'
    | 'QUALITY_SETTINGS'
    | 'MEDIA'
    | 'FLOW'
    | 'BLOCK_ORDER'
    | 'DYNAMIC_LIST'
    | 'CLEANING'
    | 'EXPERIMENTAL';
  message: string;
  /** Where the problem is, e.g. "pages.P2.questions.Q5.condition". */
  location: string;
}

export interface AnalysisReport {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: LogicIssue[];
}

interface Symbol {
  question: Question;
  pageIndex: number;
  questionIndex: number;
}

type ExprRole =
  | { kind: 'page'; pageIndex: number }
  | { kind: 'question'; pageIndex: number; questionIndex: number }
  | { kind: 'validation'; pageIndex: number }
  | { kind: 'global' };

/** Largest number of answer combinations brute-forced when checking satisfiability. */
const MAX_COMBINATIONS = 20000;

export function analyzeSurvey(source: SurveyDefinition): AnalysisReport {
  const issues: LogicIssue[] = [];
  const add = (severity: IssueSeverity, code: LogicIssue['code'], message: string, location: string) =>
    issues.push({ severity, code, message, location });

  // Loops, blocks and variables are checked on the definition as written; everything else on the
  // compiled definition (loops expanded), which is what respondents actually go through.
  for (const f of checkFlow(source)) add('error', 'FLOW', f.message, f.location);
  const def = compileSurvey(source);

  // ---- Symbol table and structural checks --------------------------------------------------
  const symbols = new Map<string, Symbol>();
  const seenIds = new Map<string, string>();
  const claim = (id: string, location: string) => {
    const key = id.toLowerCase();
    const prev = seenIds.get(key);
    if (prev) add('error', 'DUPLICATE_ID', `"${id}" is used more than once (also at ${prev}).`, location);
    else seenIds.set(key, location);
  };

  const pageIds = new Set<string>();
  def.pages.forEach((page, pi) => {
    if (pageIds.has(page.id)) add('error', 'DUPLICATE_ID', `Page id "${page.id}" is used more than once.`, `pages.${page.id}`);
    pageIds.add(page.id);
    page.questions.forEach((q, qi) => {
      const loc = `pages.${page.id}.questions.${q.id}`;
      claim(q.id, loc);
      symbols.set(q.id, { question: q, pageIndex: pi, questionIndex: qi });
      if (
        q.type === 'single' ||
        q.type === 'multi' ||
        q.type === 'grid' ||
        q.type === 'ranking' ||
        q.type === 'sum' ||
        q.type === 'cardsort' ||
        q.type === 'hotspot' ||
        q.type === 'eyetrack'
      ) {
        const lists =
          q.type === 'grid'
            ? [q.columns]
            : q.type === 'cardsort'
              ? [q.options, q.groups]
              : q.type === 'hotspot'
                ? [q.regions]
                : q.type === 'eyetrack'
                  ? [q.aois]
                  : [q.options];
        for (const opts of lists) {
          const codes = new Set<number>();
          for (const o of opts) {
            if (codes.has(o.code)) add('error', 'DUPLICATE_CODE', `Answer code ${o.code} appears twice in ${q.id}.`, loc);
            codes.add(o.code);
          }
        }
      }
      if (q.type === 'hotspot') {
        if (!q.image) add('error', 'MEDIA', `${q.id}: choose the picture respondents click on.`, loc);
        if (!q.imageAlt.trim())
          add('warning', 'MEDIA', `${q.id}: describe the picture in its text alternative, for people using screen readers.`, loc);
        for (const r of q.regions)
          if (r.x + r.w > 100.001 || r.y + r.h > 100.001)
            add('warning', 'INVALID_RANGE', `${q.id}: area "${r.label}" reaches past the edge of the picture.`, loc);
        if (q.maxSelected !== undefined && q.minSelected !== undefined && q.minSelected > q.maxSelected)
          add('error', 'INVALID_RANGE', `${q.id}: minimum selections exceed maximum.`, loc);
        if (q.minSelected !== undefined && q.minSelected > q.regions.length)
          add('error', 'INVALID_RANGE', `${q.id}: requires ${q.minSelected} areas but has ${q.regions.length}.`, loc);
      }
      if (q.type === 'eyetrack') {
        if (!q.image) add('error', 'MEDIA', `${q.id}: choose the picture respondents look at.`, loc);
        if (!q.imageAlt.trim())
          add('warning', 'MEDIA', `${q.id}: describe the picture in its text alternative, for people using screen readers.`, loc);
        for (const r of q.aois)
          if (r.x + r.w > 100.001 || r.y + r.h > 100.001)
            add('warning', 'INVALID_RANGE', `${q.id}: area of interest "${r.label}" reaches past the edge of the picture.`, loc);
        add(
          'warning',
          'EXPERIMENTAL',
          `${q.id}: webcam eye tracking is experimental. Gaze is estimated in the browser and has not been validated on real webcams; treat heatmaps as approximate.`,
          loc,
        );
      }
      if (q.type === 'grid') {
        const rows = new Set<string>();
        for (const r of q.rows) {
          if (rows.has(r.id)) add('error', 'DUPLICATE_ID', `Row "${r.id}" appears twice in ${q.id}.`, loc);
          rows.add(r.id);
        }
      }
      if (q.type === 'numeric' && q.min !== undefined && q.max !== undefined && q.min > q.max)
        add('error', 'INVALID_RANGE', `${q.id}: minimum ${q.min} is greater than maximum ${q.max}.`, loc);
      if (q.type === 'numeric' && q.display === 'slider' && (q.min === undefined || q.max === undefined))
        add('error', 'INVALID_RANGE', `${q.id}: a slider needs a minimum and a maximum.`, loc);
      if (q.type === 'scale') {
        if (q.min >= q.max) add('error', 'INVALID_RANGE', `${q.id}: the scale must go from a lower to a higher number.`, loc);
        if (q.nps && (q.min !== 0 || q.max !== 10))
          add('error', 'INVALID_RANGE', `${q.id}: a Net Promoter Score question runs from 0 to 10.`, loc);
        if (q.dontKnow && q.dontKnow.code >= q.min && q.dontKnow.code <= q.max)
          add('error', 'DUPLICATE_CODE', `${q.id}: the "${q.dontKnow.label}" code ${q.dontKnow.code} is also a point on the scale.`, loc);
      }
      if (q.type === 'ranking' && q.rankCount !== undefined && q.rankCount > q.options.length)
        add('error', 'INVALID_RANGE', `${q.id}: asks for the top ${q.rankCount} but has ${q.options.length} items.`, loc);
      if (q.type === 'sum' && q.integer && !Number.isInteger(q.total))
        add('error', 'INVALID_RANGE', `${q.id}: whole-number amounts cannot add up to ${q.total}.`, loc);
      if (q.media && q.media.kind === 'image' && !q.media.alt.trim())
        add('warning', 'MEDIA', `${q.id}: describe the image in its text alternative, for people using screen readers.`, loc);
      if (q.media && q.media.kind === 'image' && q.media.requireComplete)
        add('warning', 'MEDIA', `${q.id}: "play to the end" only applies to video and audio.`, loc);
      if (q.type === 'multi') {
        if (q.minSelected !== undefined && q.minSelected > q.options.length)
          add('error', 'INVALID_RANGE', `${q.id}: requires ${q.minSelected} selections but has ${q.options.length} options.`, loc);
        if (q.minSelected !== undefined && q.maxSelected !== undefined && q.minSelected > q.maxSelected)
          add('error', 'INVALID_RANGE', `${q.id}: minimum selections exceed maximum.`, loc);
      }
    });
  });
  def.terminations.forEach((t) => claim(t.id, `terminations.${t.id}`));
  qualitySettingsOf(def).checks.forEach((c) => claim(c.id, `settings.quality.checks.${c.id}`));
  {
    const q = qualitySettingsOf(def);
    if (q.enabled && q.rejectBelow > q.reviewBelow)
      add(
        'warning',
        'QUALITY_SETTINGS',
        `Quality: completes scoring below ${q.rejectBelow} are rejected in the survey, which is stricter than the review threshold ${q.reviewBelow}; nothing between them can be reviewed.`,
        'settings.quality',
      );
  }
  def.quotas.forEach((q) => {
    claim(q.id, `quotas.${q.id}`);
    if (q.target === 0)
      add('warning', 'ZERO_QUOTA', `Quota ${q.id} has a target of 0; every matching respondent will be over quota.`, `quotas.${q.id}`);
  });

  // URL variables are known before the first page, like an answer given on entry.
  (def.urlVariables ?? []).forEach((u) => {
    claim(u.id, `urlVariables.${u.id}`);
    const pseudo = (u.numeric
      ? { id: u.id, type: 'numeric', text: u.label ?? u.id, required: false, validations: [], integer: false, display: 'input' }
      : { id: u.id, type: 'open', text: u.label ?? u.id, required: false, validations: [], multiline: false }) as unknown as Question;
    symbols.set(u.id, { question: pseudo, pageIndex: -1, questionIndex: -1 });
  });

  // Calculated variables behave like a question asked right after the last question they use.
  (def.variables ?? []).forEach((v, vi) => {
    const loc = `variables.${v.id}`;
    claim(v.id, loc);
    let pageIndex = -1;
    let questionIndex = -1;
    try {
      for (const r of references(parse(v.expr))) {
        const s = symbols.get(r.name);
        if (!s) {
          if ((def.variables ?? []).slice(vi + 1).some((x) => x.id === r.name))
            add(
              'error',
              'FORWARD_REFERENCE',
              `Variable ${v.id} uses ${r.name}, which is defined after it. Move ${r.name} up.`,
              `${loc}.expr`,
            );
          continue;
        }
        if (s.pageIndex > pageIndex || (s.pageIndex === pageIndex && s.questionIndex > questionIndex)) {
          pageIndex = s.pageIndex;
          questionIndex = s.questionIndex;
        }
      }
    } catch {
      /* reported by checkExpr below */
    }
    const pseudo = {
      id: v.id,
      type: 'numeric',
      text: v.label ?? v.id,
      required: false,
      validations: [],
      integer: false,
      display: 'input',
    } as unknown as Question;
    symbols.set(v.id, { question: pseudo, pageIndex, questionIndex });
  });

  // ---- Expression checks ---------------------------------------------------------------------
  const codesOf = (name: string, member?: string): number[] | null => {
    const s = symbols.get(name);
    if (!s) return null;
    const q = s.question;
    if (q.type === 'single' || q.type === 'multi') return member ? null : q.options.map((o) => o.code);
    if (q.type === 'ranking') return member ? null : q.options.map((o) => o.code);
    if (q.type === 'scale') return member ? null : scaleCodes(q);
    if (q.type === 'grid' && member) return q.columns.map((o) => o.code);
    if (q.type === 'cardsort' && member) return q.groups.map((o) => o.code);
    if (q.type === 'hotspot') return member ? null : q.regions.map((r) => r.code);
    return null;
  };

  /** Parse + check an expression; returns the AST when it parsed. */
  const checkExpr = (expr: string, role: ExprRole, location: string): Node | null => {
    let ast: Node;
    try {
      ast = parse(expr);
    } catch (e) {
      const msg = e instanceof ExpressionError ? `${e.message} at character ${e.position + 1}` : String(e);
      add('error', 'PARSE_ERROR', `Cannot read "${expr}": ${msg}.`, location);
      return null;
    }
    for (const ref of references(ast)) {
      const s = symbols.get(ref.name);
      if (!s) {
        add('error', 'UNDEFINED_VARIABLE', `"${ref.name}" is not a question in this survey.`, location);
        continue;
      }
      if (s.question.type === 'info') {
        add('error', 'NOT_A_VALUE', `"${ref.name}" is an information screen and has no answer.`, location);
        continue;
      }
      if (ref.member !== undefined) {
        const q = s.question;
        if (q.type === 'grid') {
          if (!q.rows.some((r) => r.id === ref.member))
            add('error', 'INVALID_MEMBER', `Grid ${ref.name} has no row "${ref.member}".`, location);
        } else if (q.type === 'ranking' || q.type === 'sum' || q.type === 'cardsort') {
          if (!q.options.some((o) => String(o.code) === ref.member))
            add('error', 'INVALID_MEMBER', `${ref.name} has no item with code ${ref.member}.`, location);
        } else
          add(
            'error',
            'INVALID_MEMBER',
            `"${ref.name}.${ref.member}": only grid rows, ranking, constant sum and card sort items can be addressed with a dot.`,
            location,
          );
      }
      if (role.kind === 'page') {
        if (s.pageIndex >= role.pageIndex)
          add(
            'error',
            'FORWARD_REFERENCE',
            `"${ref.name}" is asked on this or a later page, so it has no answer when the page condition is checked.`,
            location,
          );
      } else if (role.kind === 'question') {
        if (s.pageIndex > role.pageIndex || (s.pageIndex === role.pageIndex && s.questionIndex >= role.questionIndex))
          add('error', 'FORWARD_REFERENCE', `"${ref.name}" is asked later, so it has no answer when this condition is checked.`, location);
      } else if (role.kind === 'validation' && s.pageIndex > role.pageIndex) {
        add('error', 'FORWARD_REFERENCE', `"${ref.name}" is asked on a later page.`, location);
      }
    }
    walkCalls(ast, (call) => {
      const fn = FUNCTIONS[call.name];
      if (!fn) add('error', 'UNKNOWN_FUNCTION', `Unknown function "${call.name}()".`, location);
      else if (call.args.length < fn.min || call.args.length > fn.max)
        add('error', 'WRONG_ARGUMENT_COUNT', `Wrong number of arguments: ${fn.doc}.`, location);
    });
    checkCodes(ast, location);
    return ast;
  };

  const checkCodes = (ast: Node, location: string) => {
    walk(ast, (n) => {
      let target: { name: string; member?: string } | null = null;
      let literals: Node[] = [];
      if (n.kind === 'binary' && ['==', '!=', 'in'].includes(n.op)) {
        const [v, other] =
          n.left.kind === 'var' ? [n.left, n.right] : n.right.kind === 'var' && n.op !== 'in' ? [n.right, n.left] : [null, null];
        if (v && v.kind === 'var' && other) {
          target = v.member !== undefined ? { name: v.name, member: v.member } : { name: v.name };
          literals = other.kind === 'list' ? other.items : [other];
          const s = symbols.get(v.name);
          if (s?.question.type === 'multi' && n.op !== 'in' && v.member === undefined)
            add(
              'warning',
              'MULTI_EQUALITY',
              `${v.name} is multiple choice; "${v.name} ${n.op} …" checks whether a code is among the choices. Prefer selected(${v.name}, …) for clarity.`,
              location,
            );
        }
      } else if (n.kind === 'call' && n.name === 'selected' && n.args[0]?.kind === 'var') {
        const v = n.args[0];
        target = v.member !== undefined ? { name: v.name, member: v.member } : { name: v.name };
        literals = n.args.slice(1).flatMap((a) => (a.kind === 'list' ? a.items : [a]));
      }
      if (!target) return;
      const codes = codesOf(target.name, target.member);
      if (!codes) return;
      for (const lit of literals) {
        if (lit.kind === 'num' && !codes.includes(lit.value))
          add(
            'warning',
            'UNKNOWN_OPTION_CODE',
            `${target.name}${target.member ? '.' + target.member : ''} has no answer code ${lit.value} (codes: ${codes.join(', ')}).`,
            location,
          );
      }
    });
  };

  const pageConds: Array<Node | null> = [];
  def.pages.forEach((page, pi) => {
    const ploc = `pages.${page.id}`;
    const pageAst = page.condition ? checkExpr(page.condition, { kind: 'page', pageIndex: pi }, `${ploc}.condition`) : null;
    pageConds.push(pageAst);
    if (pageAst && !satisfiable(pageAst))
      add('error', 'IMPOSSIBLE_CONDITION', `Page ${page.id} can never be shown: its condition can never be true.`, `${ploc}.condition`);
    let anyVisible = false;
    page.questions.forEach((q, qi) => {
      const qloc = `${ploc}.questions.${q.id}`;
      let qVisible = true;
      if (q.condition) {
        const ast = checkExpr(q.condition, { kind: 'question', pageIndex: pi, questionIndex: qi }, `${qloc}.condition`);
        if (ast && !satisfiable(ast)) {
          qVisible = false;
          add('error', 'IMPOSSIBLE_CONDITION', `${q.id} can never be shown: its condition can never be true.`, `${qloc}.condition`);
        }
      }
      anyVisible ||= qVisible;
      if (q.type !== 'info') {
        q.validations.forEach((v, i) => checkExpr(v.expr, { kind: 'validation', pageIndex: pi }, `${qloc}.validations.${i}`));
      }
      const texts = [q.text, ...('help' in q && q.help ? [q.help] : [])];
      for (const t of texts) {
        for (const m of t.matchAll(PIPE_PATTERN)) {
          const ref = m[1]!;
          const s = symbols.get(ref);
          if (!s || s.question.type === 'info')
            add('error', 'PIPING_UNDEFINED', `{{${ref}}} in ${q.id} does not refer to a question.`, qloc);
          else if (s.pageIndex >= pi) add('error', 'PIPING_UNDEFINED', `{{${ref}}} in ${q.id} is not answered before this page.`, qloc);
        }
      }
    });
    if (!anyVisible) add('error', 'UNREACHABLE', `Page ${page.id} has no question that can ever be shown.`, ploc);
  });

  // Terminations and quotas are evaluated after every page and may reference any question.
  def.terminations.forEach((t) => {
    const loc = `terminations.${t.id}.condition`;
    const ast = checkExpr(t.condition, { kind: 'global' }, loc);
    if (!ast) return;
    if (references(ast).length === 0 && truthy(evaluate(ast, { lookup: () => null })))
      add('error', 'ALWAYS_TERMINATES', `Termination ${t.id} is always true: every respondent would be terminated.`, loc);
    else if (!satisfiable(ast)) add('warning', 'IMPOSSIBLE_CONDITION', `Termination ${t.id} can never trigger.`, loc);
  });
  qualitySettingsOf(def).checks.forEach((c) => {
    const loc = `settings.quality.checks.${c.id}.condition`;
    const ast = checkExpr(c.condition, { kind: 'global' }, loc);
    if (!ast) return;
    if (references(ast).length === 0 && truthy(evaluate(ast, { lookup: () => null })))
      add('warning', 'QUALITY_SETTINGS', `Quality check ${c.id} is always true: every complete would fail it.`, loc);
    else if (!satisfiable(ast)) add('warning', 'IMPOSSIBLE_CONDITION', `Quality check ${c.id} can never fail.`, loc);
  });
  def.quotas.forEach((q) => {
    const loc = `quotas.${q.id}.condition`;
    const ast = checkExpr(q.condition, { kind: 'global' }, loc);
    if (ast && !satisfiable(ast)) add('warning', 'IMPOSSIBLE_CONDITION', `Quota ${q.id} can never be filled.`, loc);
  });

  (def.variables ?? []).forEach((v) => checkExpr(v.expr, { kind: 'global' }, `variables.${v.id}.expr`));
  // Recodes are analysis variables: their names must not clash with questions or calculated variables.
  (def.recodes ?? []).forEach((r) => claim(r.id, `recodes.${r.id}`));

  // Cleaning rules (blueprint phase 5): a single-value question as target, a valid value, a checked condition.
  const cleaningIds = new Set<string>();
  (def.cleaning ?? []).forEach((r) => {
    const loc = `cleaning.${r.id}`;
    if (cleaningIds.has(r.id)) add('error', 'DUPLICATE_ID', `Cleaning rule id "${r.id}" is used twice.`, loc);
    cleaningIds.add(r.id);
    if (r.when) checkExpr(r.when, { kind: 'global' }, `${loc}.when`);
    const q = symbols.get(r.target)?.question;
    if (!q || !(['single', 'numeric', 'scale', 'open'] as string[]).includes(q.type)) {
      add(
        'error',
        'CLEANING',
        `Cleaning rule ${r.id} targets "${r.target}", which is not a single choice, number, scale or text question.`,
        loc,
      );
      return;
    }
    if (r.action === 'impute' && r.method !== 'mode' && q.type !== 'numeric' && q.type !== 'scale')
      add(
        'error',
        'CLEANING',
        `Cleaning rule ${r.id}: a ${r.method} needs a number or scale question; use mode for ${q.type} questions.`,
        loc,
      );
    if (r.action === 'set' && q.type === 'single' && !q.options.some((o) => o.code === r.value))
      add('error', 'CLEANING', `Cleaning rule ${r.id} sets ${q.id} to ${String(r.value)}, which is not one of its answer codes.`, loc);
    if (r.action === 'set' && (q.type === 'numeric' || q.type === 'scale') && typeof r.value !== 'number')
      add('error', 'CLEANING', `Cleaning rule ${r.id} sets ${q.id} to text; ${q.id} takes a number.`, loc);
  });

  // Dynamic answer lists need an earlier choice question that shares answer codes.
  def.pages.forEach((page, pi) =>
    page.questions.forEach((q) => {
      if ((q.type !== 'single' && q.type !== 'multi' && q.type !== 'ranking') || !q.optionsFrom) return;
      const loc = `pages.${page.id}.questions.${q.id}.optionsFrom`;
      const s = symbols.get(q.optionsFrom.question);
      const src = s?.question;
      if (!s || !src || (src.type !== 'single' && src.type !== 'multi' && src.type !== 'ranking')) {
        add(
          'error',
          'DYNAMIC_LIST',
          `${q.id} takes its options from "${q.optionsFrom.question}", which is not a single, multiple choice or ranking question.`,
          loc,
        );
        return;
      }
      if (s.pageIndex >= pi)
        add('error', 'FORWARD_REFERENCE', `${q.id} takes its options from ${src.id}, which must be asked on an earlier page.`, loc);
      const codes = new Set(src.options.map((o) => o.code));
      if (!q.options.some((o) => codes.has(o.code)))
        add(
          'warning',
          'DYNAMIC_LIST',
          `${q.id} shares no answer codes with ${src.id}, so its list never changes. Use the same codes as ${src.id}.`,
          loc,
        );
    }),
  );

  // In a randomized block, a page may come before another page of the same block.
  for (const block of def.blocks ?? []) {
    if (!block.randomize && block.pick === undefined) continue;
    const inBlock = new Set(block.pages);
    const blockQuestions = new Map<string, string>();
    for (const p of def.pages) if (inBlock.has(p.id)) for (const q of p.questions) blockQuestions.set(q.id, p.id);
    for (const p of def.pages) {
      if (!inBlock.has(p.id)) continue;
      const exprs = [
        p.condition,
        ...p.questions.flatMap((q) => [q.condition, ...(q.type === 'info' ? [] : q.validations.map((v) => v.expr))]),
      ];
      for (const e of exprs) {
        if (!e) continue;
        let refs: string[] = [];
        try {
          refs = references(parse(e)).map((r) => r.name);
        } catch {
          continue;
        }
        for (const r of refs) {
          const other = blockQuestions.get(r);
          if (other && other !== p.id)
            add(
              'warning',
              'BLOCK_ORDER',
              `Page ${p.id} uses ${r} from page ${other}, but block ${block.id} shows its pages in a random order (or not at all), so ${r} may not be answered yet.`,
              `blocks.${block.id}`,
            );
        }
      }
    }
  }

  // ---- Satisfiability by bounded enumeration ---------------------------------------------------
  // For conditions over closed-ended questions only, try every combination of answers
  // (including "not answered"). If none makes the condition true, it is impossible.
  function satisfiable(ast: Node): boolean {
    const refs = references(ast);
    const domains: Array<{ key: string; values: Value[] }> = [];
    for (const r of refs) {
      const key = r.member ? `${r.name}.${r.member}` : r.name;
      if (domains.some((d) => d.key === key)) continue;
      const s = symbols.get(r.name);
      if (!s) return true; // reported elsewhere
      const q = s.question;
      if (q.type === 'single' || (q.type === 'grid' && r.member) || (q.type === 'cardsort' && r.member)) {
        const opts = q.type === 'single' ? q.options : q.type === 'grid' ? q.columns : q.type === 'cardsort' ? q.groups : [];
        domains.push({ key, values: [null, ...opts.map((o) => o.code)] });
      } else if (q.type === 'scale' && !r.member) {
        domains.push({ key, values: [null, ...scaleCodes(q)] });
      } else if (q.type === 'ranking' && r.member) {
        domains.push({ key, values: [null, ...q.options.map((_, i) => i + 1)] });
      } else if ((q.type === 'multi' && q.options.length <= 10) || (q.type === 'hotspot' && q.regions.length <= 10)) {
        // every subset of the options
        const subsets: Value[] = [];
        const opts = q.type === 'multi' ? q.options : q.type === 'hotspot' ? q.regions : [];
        const n = opts.length;
        for (let mask = 0; mask < 1 << n; mask++) subsets.push(opts.filter((_, i) => mask & (1 << i)).map((o) => o.code));
        domains.push({ key, values: [null, ...subsets] });
      } else {
        return true; // open-ended domain: assume satisfiable
      }
    }
    const total = domains.reduce((acc, d) => acc * d.values.length, 1);
    if (total > MAX_COMBINATIONS) return true;
    const assignment = new Map<string, Value>();
    const ctx = {
      lookup: (name: string, member?: string) => assignment.get(member ? `${name}.${member}` : name) ?? null,
    };
    const search = (i: number): boolean => {
      if (i === domains.length) return truthy(evaluate(ast, ctx));
      for (const v of domains[i]!.values) {
        assignment.set(domains[i]!.key, v);
        if (search(i + 1)) return true;
      }
      return false;
    };
    return search(0);
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  return { ok: errors === 0, errors, warnings: issues.length - errors, issues };
}

function walk(n: Node, fn: (n: Node) => void): void {
  fn(n);
  switch (n.kind) {
    case 'list':
      n.items.forEach((x) => walk(x, fn));
      break;
    case 'call':
      n.args.forEach((x) => walk(x, fn));
      break;
    case 'unary':
      walk(n.arg, fn);
      break;
    case 'binary':
      walk(n.left, fn);
      walk(n.right, fn);
      break;
  }
}

function walkCalls(n: Node, fn: (n: Extract<Node, { kind: 'call' }>) => void): void {
  walk(n, (x) => {
    if (x.kind === 'call') fn(x);
  });
}
