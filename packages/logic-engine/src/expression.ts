/**
 * The ZAPX logic expression language.
 *
 * A small, side-effect-free language used for skip logic, display conditions, validations,
 * terminations and quotas. It is parsed into an AST and interpreted; nothing is ever passed to
 * `eval`, so survey content cannot execute code. Expressions are bounded in length (schema) and
 * nesting depth (parser), and have no loops, so evaluation always terminates quickly.
 *
 * Examples:
 *   Q1 == 2
 *   AGE >= 18 and AGE <= 65
 *   Q3 in [1, 2, 5]
 *   selected(Q4, 7) or not answered(Q5)
 *   Q6.r1 >= 4            (grid row r1 of question Q6)
 */

export type Node =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'list'; items: Node[] }
  | { kind: 'var'; name: string; member?: string }
  | { kind: 'call'; name: string; args: Node[] }
  | { kind: 'unary'; op: 'not' | '-'; arg: Node }
  | { kind: 'binary'; op: BinaryOp; left: Node; right: Node };

export type BinaryOp = 'or' | 'and' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | '+' | '-' | '*' | '/' | '%';

export class ExpressionError extends Error {
  constructor(
    message: string,
    public readonly position: number,
  ) {
    super(message);
    this.name = 'ExpressionError';
  }
}

type Token =
  | { t: 'num'; v: number; p: number }
  | { t: 'str'; v: string; p: number }
  | { t: 'ident'; v: string; p: number }
  | { t: 'op'; v: string; p: number }
  | { t: 'eof'; p: number };

const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'true', 'false', 'null']);
const MAX_DEPTH = 64;

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const start = i;
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      while (i < src.length && /[0-9.]/.test(src[i]!)) i++;
      const text = src.slice(start, i);
      const v = Number(text);
      if (!Number.isFinite(v) || (text.match(/\./g)?.length ?? 0) > 1) throw new ExpressionError(`Invalid number "${text}"`, start);
      out.push({ t: 'num', v, p: start });
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      let s = '';
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\' && i + 1 < src.length) {
          s += src[i + 1];
          i += 2;
        } else s += src[i++];
      }
      if (i >= src.length) throw new ExpressionError('Unterminated string', start);
      i++;
      out.push({ t: 'str', v: s, p: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      while (i < src.length && /[A-Za-z0-9_.]/.test(src[i]!)) i++;
      out.push({ t: 'ident', v: src.slice(start, i), p: start });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      out.push({ t: 'op', v: two, p: start });
      i += 2;
      continue;
    }
    if ('<>+-*/%()[],!='.includes(c)) {
      if (c === '=') throw new ExpressionError('Use == to compare values', start);
      out.push({ t: 'op', v: c, p: start });
      i++;
      continue;
    }
    throw new ExpressionError(`Unexpected character "${c}"`, start);
  }
  out.push({ t: 'eof', p: src.length });
  return out;
}

const BINARY_PRECEDENCE: Record<string, number> = {
  or: 1,
  '||': 1,
  and: 2,
  '&&': 2,
  '==': 4,
  '!=': 4,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  in: 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

function normalizeOp(v: string): BinaryOp {
  if (v === '||') return 'or';
  if (v === '&&') return 'and';
  return v as BinaryOp;
}

/** Parse an expression into an AST. Throws ExpressionError with a character position. */
export function parse(src: string): Node {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos]!;
  const next = () => tokens[pos++]!;
  const isOp = (v: string) => {
    const t = peek();
    return t.t === 'op' && t.v === v;
  };
  const expectOp = (v: string) => {
    const t = next();
    if (t.t !== 'op' || t.v !== v) throw new ExpressionError(`Expected "${v}"`, t.p);
  };

  function binaryOpOf(t: Token): string | null {
    if (t.t === 'op' && BINARY_PRECEDENCE[t.v] !== undefined) return t.v;
    if (t.t === 'ident' && ['and', 'or', 'in'].includes(t.v.toLowerCase())) return t.v.toLowerCase();
    return null;
  }

  function parseExpr(minPrec: number, depth: number): Node {
    if (depth > MAX_DEPTH) throw new ExpressionError('Expression is nested too deeply', peek().p);
    let left = parseUnary(depth);
    for (;;) {
      const op = binaryOpOf(peek());
      if (!op) break;
      const prec = BINARY_PRECEDENCE[op]!;
      if (prec < minPrec) break;
      next();
      const right = parseExpr(prec + 1, depth + 1);
      left = { kind: 'binary', op: normalizeOp(op), left, right };
    }
    return left;
  }

  function parseUnary(depth: number): Node {
    const t = peek();
    if ((t.t === 'ident' && t.v.toLowerCase() === 'not') || (t.t === 'op' && t.v === '!')) {
      next();
      // `not` binds looser than comparisons: `not Q1 == 2` means `not (Q1 == 2)`.
      return { kind: 'unary', op: 'not', arg: parseExpr(3, depth + 1) };
    }
    if (t.t === 'op' && t.v === '-') {
      next();
      return { kind: 'unary', op: '-', arg: parseUnary(depth + 1) };
    }
    return parsePrimary(depth);
  }

  function parseList(close: string, depth: number): Node[] {
    const items: Node[] = [];
    if (isOp(close)) {
      next();
      return items;
    }
    for (;;) {
      items.push(parseExpr(1, depth + 1));
      if (isOp(',')) {
        next();
        continue;
      }
      expectOp(close);
      return items;
    }
  }

  function parsePrimary(depth: number): Node {
    const t = next();
    switch (t.t) {
      case 'num':
        return { kind: 'num', value: t.v };
      case 'str':
        return { kind: 'str', value: t.v };
      case 'op':
        if (t.v === '(') {
          const e = parseExpr(1, depth + 1);
          expectOp(')');
          return e;
        }
        if (t.v === '[') return { kind: 'list', items: parseList(']', depth) };
        throw new ExpressionError(`Unexpected "${t.v}"`, t.p);
      case 'ident': {
        const lower = t.v.toLowerCase();
        if (lower === 'true' || lower === 'false') return { kind: 'bool', value: lower === 'true' };
        if (lower === 'null') return { kind: 'null' };
        if (KEYWORDS.has(lower)) throw new ExpressionError(`Unexpected "${t.v}"`, t.p);
        if (isOp('(')) {
          if (t.v.includes('.')) throw new ExpressionError(`Invalid function name "${t.v}"`, t.p);
          next();
          return { kind: 'call', name: lower, args: parseList(')', depth) };
        }
        const parts = t.v.split('.');
        if (parts.length > 2 || parts.some((p) => p === '')) throw new ExpressionError(`Invalid variable "${t.v}"`, t.p);
        return parts.length === 2 ? { kind: 'var', name: parts[0]!, member: parts[1]! } : { kind: 'var', name: parts[0]! };
      }
      case 'eof':
        throw new ExpressionError('Unexpected end of expression', t.p);
    }
  }

  const ast = parseExpr(1, 0);
  const rest = peek();
  if (rest.t !== 'eof') throw new ExpressionError('Unexpected input after expression', rest.p);
  return ast;
}

/** Built-in functions and their allowed argument counts. */
export const FUNCTIONS: Record<string, { min: number; max: number; doc: string }> = {
  answered: { min: 1, max: 1, doc: 'answered(Q) – true when Q has an answer' },
  selected: { min: 2, max: 50, doc: 'selected(Q, code, ...) – true when any of the codes was chosen' },
  count: { min: 1, max: 1, doc: 'count(Q) – number of options chosen (multi) or 1/0' },
  len: { min: 1, max: 1, doc: 'len(Q) – length of a text answer' },
  sum: { min: 1, max: 50, doc: 'sum(a, b, ...) – sum of numbers, ignoring blanks' },
  min: { min: 1, max: 50, doc: 'min(a, b, ...)' },
  max: { min: 1, max: 50, doc: 'max(a, b, ...)' },
  abs: { min: 1, max: 1, doc: 'abs(x)' },
  round: { min: 1, max: 2, doc: 'round(x, digits?)' },
};

export type Value = number | string | boolean | null | Value[] | { [k: string]: number };

export interface EvalContext {
  /** Returns the current value of a variable, or undefined if the variable does not exist. */
  lookup(name: string, member?: string): Value | undefined;
}

export function truthy(v: Value): boolean {
  if (v === null || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function looseEquals(a: Value, b: Value): boolean {
  if (a === null || b === null) return a === b;
  // A multiple-choice answer equals a code when it contains that code.
  if (Array.isArray(a) && !Array.isArray(b)) return a.some((x) => looseEquals(x, b));
  if (Array.isArray(b) && !Array.isArray(a)) return looseEquals(b, a);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => looseEquals(x, b[i]!));
  if (typeof a === 'number' && typeof b === 'string') return String(a) === b;
  if (typeof a === 'string' && typeof b === 'number') return a === String(b);
  return a === b;
}

function toNumber(v: Value): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Evaluate an AST. Unknown variables evaluate to null (static analysis reports them). */
export function evaluate(node: Node, ctx: EvalContext): Value {
  switch (node.kind) {
    case 'num':
    case 'str':
    case 'bool':
      return node.value;
    case 'null':
      return null;
    case 'list':
      return node.items.map((n) => evaluate(n, ctx));
    case 'var': {
      const v = ctx.lookup(node.name, node.member);
      return v === undefined ? null : v;
    }
    case 'unary': {
      const v = evaluate(node.arg, ctx);
      if (node.op === 'not') return !truthy(v);
      const n = toNumber(v);
      return n === null ? null : -n;
    }
    case 'binary': {
      if (node.op === 'and') return truthy(evaluate(node.left, ctx)) && truthy(evaluate(node.right, ctx));
      if (node.op === 'or') return truthy(evaluate(node.left, ctx)) || truthy(evaluate(node.right, ctx));
      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);
      switch (node.op) {
        case '==':
          return looseEquals(l, r);
        case '!=':
          return !looseEquals(l, r);
        case 'in': {
          const list = Array.isArray(r) ? r : [r];
          if (Array.isArray(l)) return l.some((x) => list.some((y) => looseEquals(x, y)));
          return list.some((y) => looseEquals(l, y));
        }
        case '<':
        case '<=':
        case '>':
        case '>=': {
          const a = toNumber(l);
          const b = toNumber(r);
          if (a === null || b === null) return false;
          if (node.op === '<') return a < b;
          if (node.op === '<=') return a <= b;
          if (node.op === '>') return a > b;
          return a >= b;
        }
        default: {
          const a = toNumber(l);
          const b = toNumber(r);
          if (a === null || b === null) return null;
          if (node.op === '+') return a + b;
          if (node.op === '-') return a - b;
          if (node.op === '*') return a * b;
          if (b === 0) return null;
          if (node.op === '/') return a / b;
          return a % b;
        }
      }
    }
    case 'call':
      return callFunction(node, ctx);
  }
}

function callFunction(node: Extract<Node, { kind: 'call' }>, ctx: EvalContext): Value {
  const fn = FUNCTIONS[node.name];
  if (!fn || node.args.length < fn.min || node.args.length > fn.max) return null;
  const args = node.args.map((a) => evaluate(a, ctx));
  const nums = () =>
    args
      .flatMap((a) => (Array.isArray(a) ? a : [a]))
      .map(toNumber)
      .filter((n): n is number => n !== null);
  switch (node.name) {
    case 'answered': {
      const v = args[0]!;
      if (v === null || v === '') return false;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'object') return Object.keys(v).length > 0;
      return true;
    }
    case 'selected': {
      const v = args[0]!;
      const codes = args.slice(1).flatMap((a) => (Array.isArray(a) ? a : [a]));
      const chosen = Array.isArray(v) ? v : v === null ? [] : [v];
      return chosen.some((c) => codes.some((code) => looseEquals(c, code)));
    }
    case 'count': {
      const v = args[0]!;
      if (Array.isArray(v)) return v.length;
      if (v && typeof v === 'object') return Object.keys(v).length;
      return v === null || v === '' ? 0 : 1;
    }
    case 'len': {
      const v = args[0]!;
      return typeof v === 'string' ? v.length : v === null ? 0 : String(v).length;
    }
    case 'sum':
      return nums().reduce((a, b) => a + b, 0);
    case 'min': {
      const n = nums();
      return n.length ? Math.min(...n) : null;
    }
    case 'max': {
      const n = nums();
      return n.length ? Math.max(...n) : null;
    }
    case 'abs': {
      const n = toNumber(args[0]!);
      return n === null ? null : Math.abs(n);
    }
    case 'round': {
      const n = toNumber(args[0]!);
      const d = args[1] === undefined ? 0 : (toNumber(args[1]) ?? 0);
      if (n === null) return null;
      const f = 10 ** Math.max(0, Math.min(10, Math.trunc(d)));
      return Math.round(n * f) / f;
    }
  }
  return null;
}

/** All variable references in an expression. */
export function references(node: Node): Array<{ name: string; member?: string }> {
  const out: Array<{ name: string; member?: string }> = [];
  const walk = (n: Node) => {
    switch (n.kind) {
      case 'var':
        out.push(n.member ? { name: n.name, member: n.member } : { name: n.name });
        break;
      case 'list':
        n.items.forEach(walk);
        break;
      case 'call':
        n.args.forEach(walk);
        break;
      case 'unary':
        walk(n.arg);
        break;
      case 'binary':
        walk(n.left);
        walk(n.right);
        break;
    }
  };
  walk(node);
  return out;
}

const cache = new Map<string, Node>();
/** Parse with a small cache; expressions are re-evaluated on every page of every interview. */
export function parseCached(src: string): Node {
  let ast = cache.get(src);
  if (!ast) {
    ast = parse(src);
    if (cache.size > 5000) cache.clear();
    cache.set(src, ast);
  }
  return ast;
}
