/**
 * ZAPX XML (Professional Programmer workspace, blueprint phase 1).
 *
 * The canonical survey definition stays the single source of truth; XML is a second way to write
 * it, like the JSON view. `toZapxXml` and `fromZapxXml` round-trip every field of the definition.
 * Anything the reader does not understand is reported as a warning with its line, never silently
 * dropped, and the result still goes through the same schema and logic check as any other edit.
 *
 * `fromDecipherStyleXml` is a migration aid for questionnaires written in Decipher-style XML
 * (radio, checkbox, select, text, number, html, suspend...). It converts the structure and the
 * simplest conditions, and lists everything else (exec blocks, Python conditions, styles, loops,
 * quotas) as warnings for a programmer to finish by hand.
 *
 * The XML reader is deliberately small: no DTDs and no entity definitions, so documents cannot
 * pull in files or expand entities.
 */
import {
  blockSchema,
  urlVariableSchema,
  cardSortQuestionSchema,
  gridQuestionSchema,
  hotspotQuestionSchema,
  infoElementSchema,
  loopSchema,
  multiQuestionSchema,
  numericQuestionSchema,
  openQuestionSchema,
  photoQuestionSchema,
  signatureQuestionSchema,
  barcodeQuestionSchema,
  maxDiffQuestionSchema,
  conjointQuestionSchema,
  rankingQuestionSchema,
  scaleQuestionSchema,
  singleQuestionSchema,
  sumQuestionSchema,
  type Question,
  type SurveyDefinition,
} from '@zapx/survey-schema';
import { ExpressionError, parse } from './expression.js';

// ---- A small, safe XML reader ---------------------------------------------------------------------

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  line: number;
}
export type XmlNode = XmlElement | { text: string; line: number };

export class XmlError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(message);
    this.name = 'XmlError';
  }
}

const NAME = /[A-Za-z_][\w.:-]*/y;
const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(s: string, line: number): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code > 0x10ffff) throw new XmlError(`Invalid character reference ${m}`, line);
      return String.fromCodePoint(code);
    }
    const v = ENTITIES[e];
    if (v === undefined) throw new XmlError(`Unknown entity ${m} (only &lt; &gt; &amp; &quot; &apos; are allowed)`, line);
    return v;
  });
}

/** Parse an XML document into its root element. Throws XmlError with a line number. */
export function parseXml(src: string): XmlElement {
  if (src.length > 5_000_000) throw new XmlError('The document is larger than 5 MB', 1);
  let i = 0;
  let line = 1;
  const advance = (to: number) => {
    for (let k = i; k < to; k++) if (src.charCodeAt(k) === 10) line++;
    i = to;
  };
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  const push = (n: XmlNode) => {
    const top = stack[stack.length - 1];
    if (top) top.children.push(n);
    else if ('text' in n) {
      if (n.text.trim()) throw new XmlError('Text outside the root element', n.line);
    }
  };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      const text = src.slice(i);
      push({ text: decode(text, line), line });
      advance(src.length);
      break;
    }
    if (lt > i) {
      const startLine = line;
      const text = src.slice(i, lt);
      advance(lt);
      push({ text: decode(text, startLine), line: startLine });
    }
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      if (end < 0) throw new XmlError('Unclosed comment', line);
      advance(end + 3);
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9);
      if (end < 0) throw new XmlError('Unclosed CDATA section', line);
      const startLine = line;
      const text = src.slice(i + 9, end);
      advance(end + 3);
      push({ text, line: startLine });
      continue;
    }
    if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2);
      if (end < 0) throw new XmlError('Unclosed processing instruction', line);
      advance(end + 2);
      continue;
    }
    if (src.startsWith('<!', i)) throw new XmlError('Document type declarations are not allowed', line);
    if (src.startsWith('</', i)) {
      NAME.lastIndex = i + 2;
      const m = NAME.exec(src);
      if (!m) throw new XmlError('Invalid closing tag', line);
      const end = src.indexOf('>', NAME.lastIndex);
      if (end < 0 || src.slice(NAME.lastIndex, end).trim()) throw new XmlError(`Invalid closing tag </${m[0]}`, line);
      const top = stack.pop();
      if (!top || top.name !== m[0])
        throw new XmlError(`</${m[0]}> does not match ${top ? `<${top.name}> from line ${top.line}` : 'an open element'}`, line);
      advance(end + 1);
      if (!stack.length) root = top;
      continue;
    }
    // Start tag.
    NAME.lastIndex = i + 1;
    const m = NAME.exec(src);
    if (!m) throw new XmlError('Invalid tag (a "<" in text must be written &lt;)', line);
    const el: XmlElement = { name: m[0], attrs: {}, children: [], line };
    let k = NAME.lastIndex;
    for (;;) {
      while (k < src.length && /\s/.test(src[k]!)) k++;
      if (src[k] === '>' || src.startsWith('/>', k)) break;
      NAME.lastIndex = k;
      const a = NAME.exec(src);
      if (!a) throw new XmlError(`Invalid attribute in <${el.name}>`, line);
      k = NAME.lastIndex;
      while (/\s/.test(src[k] ?? '')) k++;
      if (src[k] !== '=') throw new XmlError(`Attribute ${a[0]} in <${el.name}> needs a value`, line);
      k++;
      while (/\s/.test(src[k] ?? '')) k++;
      const q = src[k];
      if (q !== '"' && q !== "'") throw new XmlError(`Attribute ${a[0]} in <${el.name}> must be quoted`, line);
      const close = src.indexOf(q, k + 1);
      if (close < 0) throw new XmlError(`Unclosed attribute ${a[0]} in <${el.name}>`, line);
      if (Object.hasOwn(el.attrs, a[0])) throw new XmlError(`Attribute ${a[0]} appears twice in <${el.name}>`, line);
      el.attrs[a[0]] = decode(src.slice(k + 1, close), line);
      k = close + 1;
    }
    const selfClosing = src.startsWith('/>', k);
    advance(k + (selfClosing ? 2 : 1));
    if (!stack.length && root) throw new XmlError('Only one root element is allowed', el.line);
    push(el);
    if (selfClosing) {
      if (!stack.length) root = el;
    } else stack.push(el);
    if (stack.length > 64) throw new XmlError('Elements are nested too deeply', line);
  }
  if (stack.length) throw new XmlError(`<${stack[stack.length - 1]!.name}> from line ${stack[stack.length - 1]!.line} is not closed`, line);
  if (!root) throw new XmlError('The document has no root element', 1);
  return root;
}

const elements = (el: XmlElement, name?: string) => el.children.filter((c): c is XmlElement => 'name' in c && (!name || c.name === name));
const textOf = (el: XmlElement): string =>
  el.children
    .map((c) => ('text' in c ? c.text : textOf(c)))
    .join('')
    .trim();

// ---- Writing ZAPX XML -----------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = (k: string, v: unknown) =>
  v === undefined || v === null || v === '' ? '' : ` ${k}="${esc(Array.isArray(v) ? v.join(',') : String(v))}"`;
const scalarAttrs = (o: Record<string, unknown>, skip: string[]) =>
  Object.entries(o)
    .filter(([k, v]) => !skip.includes(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
    .map(([k, v]) => attr(k === 'condition' ? 'cond' : k, v))
    .join('');
const textEl = (name: string, v: string | undefined, ind: string) => (v ? `${ind}<${name}>${esc(v)}</${name}>\n` : '');

/** Child elements of a question for its list fields, keyed by field name. */
const LIST_ELEMENTS: Record<string, string> = { options: 'option', columns: 'col', rows: 'row', groups: 'group', regions: 'region' };
const OBJECT_ELEMENTS = ['media', 'optionsFrom', 'dontKnow'];

function questionXml(q: Question, ind: string): string {
  const o = q as unknown as Record<string, unknown>;
  let out = `${ind}<${q.type}${scalarAttrs(o, ['type', 'text', 'help'])}>\n`;
  const inner = `${ind}  `;
  out += textEl('text', q.text, inner);
  if ('help' in q) out += textEl('help', q.help, inner);
  for (const key of OBJECT_ELEMENTS) {
    const v = o[key] as Record<string, unknown> | undefined;
    if (!v) continue;
    if (key === 'dontKnow') out += `${inner}<dontKnow${attr('code', v.code)}>${esc(String(v.label))}</dontKnow>\n`;
    else out += `${inner}<${key}${scalarAttrs(v, [])}/>\n`;
  }
  for (const [key, name] of Object.entries(LIST_ELEMENTS)) {
    const list = o[key] as Array<Record<string, unknown>> | undefined;
    if (!list) continue;
    for (const item of list) out += `${inner}<${name}${scalarAttrs(item, ['label'])}>${esc(String(item.label ?? ''))}</${name}>\n`;
  }
  if (q.type === 'conjoint')
    for (const a of q.attributes) {
      out += `${inner}<attribute${attr('id', a.id)}${attr('label', a.label)}>\n`;
      for (const l of a.levels) out += `${inner}  <level${attr('code', l.code)}>${esc(l.label)}</level>\n`;
      out += `${inner}</attribute>\n`;
    }
  if (q.type !== 'info') for (const v of q.validations) out += `${inner}<validate${attr('message', v.message)}>${esc(v.expr)}</validate>\n`;
  return `${out}${ind}</${q.type}>\n`;
}

/** The definition as ZAPX XML. `fromZapxXml(toZapxXml(def))` gives back the same definition. */
export function toZapxXml(def: SurveyDefinition): string {
  let out = `<?xml version="1.0" encoding="UTF-8"?>\n<survey${attr('schemaVersion', def.schemaVersion)}${attr('title', def.title)}${attr('language', def.language)}>\n`;
  out += textEl('welcome', def.welcome, '  ');
  out += textEl('thankYou', def.thankYou, '  ');
  const st = def.settings;
  out += `  <settings${attr('allowBack', st.allowBack)}${attr('showProgress', st.showProgress)}>\n`;
  const qs = st.quality as unknown as Record<string, unknown>;
  out += `    <quality${scalarAttrs(qs, [])}${attr('countries', (qs.countries as string[]).join(','))}>\n`;
  for (const c of st.quality.checks)
    out += `      <check${attr('id', c.id)}${attr('label', c.label)}${attr('weight', c.weight)}>${esc(c.condition)}</check>\n`;
  out += `    </quality>\n`;
  out += `    <capi${attr('gps', st.capi.gps)}${attr('audio', st.capi.audio)}${attr('interruptions', st.capi.interruptions)}${attr('video', st.capi.video)}>${st.capi.consentText ? esc(st.capi.consentText) : ''}`;
  for (const g of st.capi.geofences)
    out += `<area${attr('label', g.label)}${attr('lat', g.lat)}${attr('lon', g.lon)}${attr('radiusM', g.radiusM)}/>`;
  out += `</capi>\n`;
  out += `  </settings>\n`;
  for (const u of def.urlVariables ?? [])
    out += `  <urlvar${attr('id', u.id)}${attr('param', u.param)}${attr('label', u.label)}${attr('numeric', u.numeric)}/>\n`;
  for (const v of def.variables ?? []) out += `  <variable${attr('id', v.id)}${attr('label', v.label)}>${esc(v.expr)}</variable>\n`;
  for (const r of def.recodes ?? []) {
    out += `  <recode${attr('id', r.id)}${attr('label', r.label)}${attr('source', r.source)}>\n`;
    for (const g of r.groups)
      out += `    <group${attr('code', g.code)}${attr('label', g.label)}${attr('values', g.values?.map(String).join('|'))}${attr('min', g.min)}${attr('max', g.max)}/>\n`;
    if (r.otherwise) out += `    <otherwise${attr('code', r.otherwise.code)}${attr('label', r.otherwise.label)}/>\n`;
    out += `  </recode>\n`;
  }
  for (const c of def.cleaning ?? [])
    out += `  <clean${attr('id', c.id)}${attr('label', c.label)}${attr('question', c.target)}${attr('action', c.action)}${attr('value', c.value)}${attr('method', c.method)}>${c.when ? esc(c.when) : ''}</clean>\n`;
  for (const p of def.pages) {
    out += `  <page${attr('id', p.id)}${attr('title', p.title)}${attr('cond', p.condition)}>\n`;
    for (const q of p.questions) out += questionXml(q, '    ');
    out += `  </page>\n`;
  }
  for (const l of def.loops ?? []) {
    out += `  <loop${attr('id', l.id)}${attr('label', l.label)}${attr('pages', l.pages)}${attr('source', l.source)}>\n`;
    for (const it of l.items) out += `    <item${attr('code', it.code)}>${esc(it.label)}</item>\n`;
    out += `  </loop>\n`;
  }
  for (const b of def.blocks ?? [])
    out += `  <block${attr('id', b.id)}${attr('label', b.label)}${attr('pages', b.pages)}${attr('randomize', b.randomize)}${attr('pick', b.pick)}${attr('balance', b.balance)}/>\n`;
  for (const t of def.terminations)
    out += `  <termination${attr('id', t.id)}${attr('status', t.status)}${attr('label', t.label)}>${esc(t.condition)}</termination>\n`;
  for (const q of def.quotas)
    out += `  <quota${attr('id', q.id)}${attr('label', q.label)}${attr('target', q.target)}${attr('group', q.group)}>${esc(q.condition)}</quota>\n`;
  return `${out}</survey>\n`;
}

// ---- Reading ZAPX XML -----------------------------------------------------------------------------

export interface XmlWarning {
  line: number;
  message: string;
}
export interface XmlReadResult {
  /** A candidate definition: still to be checked with parseSurveyDefinition (the caller does). */
  definition: unknown;
  warnings: XmlWarning[];
}

const NUMBER_KEYS = new Set([
  'schemaVersion',
  'code',
  'min',
  'max',
  'step',
  'total',
  'rankCount',
  'minSelected',
  'maxSelected',
  'maxLength',
  'target',
  'pick',
  'weight',
  'x',
  'y',
  'w',
  'h',
  'minSeconds',
  'speederRatio',
  'straightlineMinRows',
  'reviewBelow',
  'rejectBelow',
  'lat',
  'lon',
  'radiusM',
  'itemsPerSet',
  'sets',
  'versions',
  'tasks',
  'conceptsPerTask',
]);
const BOOLEAN_KEYS = new Set([
  'required',
  'randomize',
  'numeric',
  'anchor',
  'exclusive',
  'multiline',
  'integer',
  'nps',
  'randomizeRows',
  'allowUnsorted',
  'requireComplete',
  'allowBack',
  'showProgress',
  'enabled',
  'openEnds',
  'sameNetwork',
  'fraud',
  'interruptions',
  'video',
  'noneOption',
]);
const LIST_KEYS = new Set(['pages', 'countries']);

function coerce(key: string, v: string, line: number, warn: (w: XmlWarning) => void): unknown {
  if (LIST_KEYS.has(key))
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  if (NUMBER_KEYS.has(key)) {
    const n = Number(v);
    if (v.trim() === '' || !Number.isFinite(n)) warn({ line, message: `${key}="${v}" is not a number` });
    return n;
  }
  if (BOOLEAN_KEYS.has(key)) {
    if (!['true', 'false', '1', '0'].includes(v)) warn({ line, message: `${key}="${v}" should be true or false` });
    return v === 'true' || v === '1';
  }
  return v;
}

const QUESTION_SCHEMAS = {
  single: singleQuestionSchema,
  multi: multiQuestionSchema,
  open: openQuestionSchema,
  numeric: numericQuestionSchema,
  grid: gridQuestionSchema,
  scale: scaleQuestionSchema,
  ranking: rankingQuestionSchema,
  sum: sumQuestionSchema,
  cardsort: cardSortQuestionSchema,
  hotspot: hotspotQuestionSchema,
  photo: photoQuestionSchema,
  signature: signatureQuestionSchema,
  barcode: barcodeQuestionSchema,
  maxdiff: maxDiffQuestionSchema,
  conjoint: conjointQuestionSchema,
  info: infoElementSchema,
} as const;
const shapeKeys = (schema: { shape: Record<string, unknown> }) => new Set(Object.keys(schema.shape));

/** Read ZAPX XML. Unknown elements and attributes are reported, not silently ignored. */
export function fromZapxXml(src: string): XmlReadResult {
  const warnings: XmlWarning[] = [];
  const warn = (w: XmlWarning) => warnings.push(w);
  const root = parseXml(src);
  if (root.name !== 'survey') throw new XmlError(`The root element must be <survey>, not <${root.name}>`, root.line);
  const attrsTo = (el: XmlElement, allowed: Set<string>, rename: Record<string, string> = {}) => {
    const out: Record<string, unknown> = {};
    for (const [k0, v] of Object.entries(el.attrs)) {
      const k = rename[k0] ?? k0;
      if (!allowed.has(k)) {
        warn({ line: el.line, message: `<${el.name}> has no attribute "${k0}"; it was ignored.` });
        continue;
      }
      out[k] = coerce(k, v, el.line, warn);
    }
    return out;
  };
  const unexpected = (el: XmlElement, where: string) =>
    warn({ line: el.line, message: `<${el.name}> is not supported inside ${where}; it was ignored.` });

  const def: Record<string, unknown> = attrsTo(root, new Set(['schemaVersion', 'title', 'language']));
  def.schemaVersion ??= 1;
  def.pages = [];
  def.terminations = [];
  def.quotas = [];
  def.loops = [];
  def.blocks = [];
  def.variables = [];
  def.urlVariables = [];
  def.recodes = [];
  def.cleaning = [];
  for (const el of elements(root)) {
    switch (el.name) {
      case 'welcome':
      case 'thankYou':
        def[el.name] = textOf(el);
        break;
      case 'settings': {
        const settings = attrsTo(el, new Set(['allowBack', 'showProgress']));
        for (const s of elements(el)) {
          if (s.name === 'quality') {
            const quality = attrsTo(
              s,
              new Set([
                'enabled',
                'minSeconds',
                'speederRatio',
                'straightlineMinRows',
                'openEnds',
                'sameNetwork',
                'fraud',
                'countries',
                'reviewBelow',
                'rejectBelow',
              ]),
            );
            quality.checks = elements(s).flatMap((c) => {
              if (c.name !== 'check') return unexpected(c, '<quality>'), [];
              return [{ ...attrsTo(c, new Set(['id', 'label', 'weight'])), condition: textOf(c) }];
            });
            settings.quality = quality;
          } else if (s.name === 'capi') {
            const capi = attrsTo(s, new Set(['gps', 'audio', 'interruptions', 'video']));
            const t = s.children
              .map((c) => ('text' in c ? c.text : ''))
              .join('')
              .trim();
            if (t) capi.consentText = t;
            capi.geofences = elements(s).flatMap((a) =>
              a.name === 'area' ? [attrsTo(a, new Set(['label', 'lat', 'lon', 'radiusM']))] : (unexpected(a, '<capi>'), []),
            );
            settings.capi = capi;
          } else unexpected(s, '<settings>');
        }
        def.settings = settings;
        break;
      }
      case 'urlvar':
        (def.urlVariables as unknown[]).push(attrsTo(el, shapeKeys(urlVariableSchema)));
        break;
      case 'recode': {
        const rc = attrsTo(el, new Set(['id', 'label', 'source']));
        rc.groups = [];
        for (const g of elements(el)) {
          if (g.name === 'group') {
            const values = g.attrs.values;
            const grp = attrsTo(
              { ...g, attrs: Object.fromEntries(Object.entries(g.attrs).filter(([k]) => k !== 'values')) },
              new Set(['code', 'label', 'min', 'max']),
            );
            if (values !== undefined) grp.values = values.split('|').map((x) => (/^-?\d+(\.\d+)?$/.test(x) ? Number(x) : x));
            (rc.groups as unknown[]).push(grp);
          } else if (g.name === 'otherwise') rc.otherwise = attrsTo(g, new Set(['code', 'label']));
          else unexpected(g, '<recode>');
        }
        (def.recodes as unknown[]).push(rc);
        break;
      }
      case 'clean': {
        // The target question is written as question="..." (target="" is a quota's number elsewhere).
        const { question, ...rest } = el.attrs;
        const c = attrsTo({ ...el, attrs: rest }, new Set(['id', 'label', 'action', 'value', 'method']));
        if (question !== undefined) c.target = question;
        const when = textOf(el).trim();
        if (when) c.when = when;
        // A number-looking value is a number (a code or an amount); quote-free text stays text.
        if (typeof c.value === 'string' && /^-?\d+(\.\d+)?$/.test(c.value)) c.value = Number(c.value);
        (def.cleaning as unknown[]).push(c);
        break;
      }
      case 'variable':
        (def.variables as unknown[]).push({ ...attrsTo(el, new Set(['id', 'label'])), expr: textOf(el) });
        break;
      case 'page': {
        const page = attrsTo(el, new Set(['id', 'title', 'condition']), { cond: 'condition' });
        page.questions = elements(el).flatMap((qel) => {
          const q = readQuestion(qel, warn);
          return q ? [q] : [];
        });
        (def.pages as unknown[]).push(page);
        break;
      }
      case 'loop': {
        const loop = attrsTo(el, shapeKeys(loopSchema));
        loop.items = elements(el).flatMap((it) =>
          it.name === 'item' ? [{ ...attrsTo(it, new Set(['code'])), label: textOf(it) }] : (unexpected(it, '<loop>'), []),
        );
        (def.loops as unknown[]).push(loop);
        break;
      }
      case 'block':
        (def.blocks as unknown[]).push(attrsTo(el, shapeKeys(blockSchema)));
        break;
      case 'termination':
        (def.terminations as unknown[]).push({ ...attrsTo(el, new Set(['id', 'status', 'label'])), condition: textOf(el) });
        break;
      case 'quota':
        (def.quotas as unknown[]).push({ ...attrsTo(el, new Set(['id', 'label', 'target', 'group'])), condition: textOf(el) });
        break;
      default:
        unexpected(el, '<survey>');
    }
  }
  return { definition: def, warnings };
}

function readQuestion(el: XmlElement, warn: (w: XmlWarning) => void): Record<string, unknown> | null {
  const schema = QUESTION_SCHEMAS[el.name as keyof typeof QUESTION_SCHEMAS];
  if (!schema) {
    warn({ line: el.line, message: `<${el.name}> is not a ZAPX question type; it was ignored.` });
    return null;
  }
  const allowed = shapeKeys(schema as unknown as { shape: Record<string, unknown> });
  const q: Record<string, unknown> = { type: el.name };
  for (const [k0, v] of Object.entries(el.attrs)) {
    const k = k0 === 'cond' ? 'condition' : k0;
    if (!allowed.has(k) || k === 'type') {
      warn({ line: el.line, message: `<${el.name}> has no attribute "${k0}"; it was ignored.` });
      continue;
    }
    q[k] = coerce(k, v, el.line, warn);
  }
  const listName = Object.fromEntries(Object.entries(LIST_ELEMENTS).map(([k, v]) => [v, k]));
  for (const c of elements(el)) {
    if (c.name === 'text' || c.name === 'help') {
      if (!allowed.has(c.name)) warn({ line: c.line, message: `<${el.name}> has no <${c.name}>; it was ignored.` });
      else q[c.name] = textOf(c);
    } else if (c.name === 'validate') {
      if (!allowed.has('validations')) warn({ line: c.line, message: `<${el.name}> cannot have validations; ignored.` });
      else ((q.validations ??= []) as unknown[]).push({ message: c.attrs.message ?? '', expr: textOf(c) });
    } else if (c.name === 'dontKnow' && allowed.has('dontKnow')) {
      q.dontKnow = { code: coerce('code', c.attrs.code ?? '', c.line, warn), label: textOf(c) };
    } else if (OBJECT_ELEMENTS.includes(c.name) && allowed.has(c.name)) {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(c.attrs)) o[k] = coerce(k, v, c.line, warn);
      q[c.name] = o;
    } else if (c.name === 'attribute' && allowed.has('attributes')) {
      ((q.attributes ??= []) as unknown[]).push({
        id: c.attrs.id ?? '',
        label: c.attrs.label ?? '',
        levels: elements(c).flatMap((l) =>
          l.name === 'level'
            ? [{ code: coerce('code', l.attrs.code ?? '', l.line, warn), label: textOf(l) }]
            : (warn({ line: l.line, message: `<${l.name}> is not supported inside <attribute>; it was ignored.` }), []),
        ),
      });
    } else if (listName[c.name] && allowed.has(listName[c.name]!)) {
      const item: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(c.attrs)) item[k] = coerce(k, v, c.line, warn);
      const label = textOf(c);
      if (label) item.label = label;
      ((q[listName[c.name]!] ??= []) as unknown[]).push(item);
    } else warn({ line: c.line, message: `<${c.name}> is not supported inside <${el.name}>; it was ignored.` });
  }
  return q;
}

// ---- Decipher-style XML migration -------------------------------------------------------------------

export interface MigrationResult extends XmlReadResult {
  /** What was converted, for the summary shown before the change is applied. */
  converted: { questions: number; pages: number; conditions: number; terminations: number };
}

const DECIPHER_QUESTION = new Set(['radio', 'checkbox', 'select', 'text', 'textarea', 'number', 'float', 'html']);
const DECIPHER_IGNORED: Record<string, string> = {
  exec: 'Python code (<exec>) cannot run in ZAPX; rewrite it as calculated variables or conditions.',
  style: 'Custom styles (<style>) are not imported; use the Design tab.',
  res: 'Resource strings (<res>) are not imported; translate text in the Languages tab.',
  quota: 'Decipher quotas live in a separate quota sheet; rebuild them with the quota table builder.',
  loop: 'Loops are not converted automatically; recreate them in Survey settings → Loops.',
  logic: 'Logic nodes (<logic>) are not imported.',
  note: 'Notes are not imported.',
  samplesources: 'Sample sources are configured as vendors in ZAPX.',
  goto: 'Goto jumps are not supported; use page conditions.',
  define: 'Reusable lists (<define>) are not expanded; insert the rows directly.',
};

const toId = (s: string, fallback: string) => {
  const id = s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z]+/, '');
  return id ? id.slice(0, 64) : fallback;
};
const stripHtml = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

/** Inner text of an element including markup children, flattened to plain text. */
const innerText = (el: XmlElement): string =>
  stripHtml(el.children.map((c) => ('text' in c ? c.text : ['br'].includes(c.name) ? '\n' : innerText(c))).join(''));

/**
 * Convert a Decipher-style questionnaire. Structure is converted; conditions are converted only
 * when they use the simple `Q1.r2`, `and`, `or`, `not` forms. Everything else becomes a warning.
 */
export function fromDecipherStyleXml(src: string): MigrationResult {
  const warnings: XmlWarning[] = [];
  const warn = (line: number, message: string) => warnings.push({ line, message });
  const root = parseXml(src);
  const converted = { questions: 0, pages: 0, conditions: 0, terminations: 0 };
  const pages: Array<{ id: string; questions: Record<string, unknown>[]; condition?: string }> = [];
  const terminations: unknown[] = [];
  const known = new Map<string, { type: string; rows: Map<string, number> }>();
  let current: (typeof pages)[number] = { id: 'P1', questions: [] };
  const newPage = () => {
    if (current.questions.length) pages.push(current);
    current = { id: `P${pages.length + 1}`, questions: [] };
  };

  /** Q1.r2 -> Q1 == 2 (radio) or selected(Q1, 2) (checkbox); returns undefined when it cannot. */
  const convertCond = (cond: string | undefined, line: number, what: string): string | undefined => {
    if (!cond) return undefined;
    let ok = true;
    let out = cond.replace(/\b([A-Za-z]\w*)\.(r\w+|any|all)\b/g, (m, q: string, member: string) => {
      const info = known.get(q);
      if (!info) {
        ok = false;
        return m;
      }
      if (member === 'any') return `answered(${q})`;
      const code = info.rows.get(member);
      if (code === undefined) {
        ok = false;
        return m;
      }
      return info.type === 'multi' ? `selected(${q}, ${code})` : `${q} == ${code}`;
    });
    out = out.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false');
    try {
      if (ok) parse(out);
    } catch (e) {
      if (e instanceof ExpressionError) ok = false;
      else throw e;
    }
    if (!ok) {
      warn(line, `${what}: the condition "${cond}" could not be converted; add it by hand.`);
      return undefined;
    }
    converted.conditions++;
    return out;
  };

  const rowsOf = (el: XmlElement, name: string) =>
    elements(el, name).map((r, i) => {
      const value = r.attrs.value !== undefined ? Number(r.attrs.value) : i + 1;
      const label = r.attrs.label ?? `${name[0]}${i + 1}`;
      if (r.attrs.open === '1') warn(r.line, `"${innerText(r)}" asks for an open "please specify" answer; add a follow-up open question.`);
      if (r.attrs.cond)
        warn(r.line, `Row "${innerText(r)}" has a display condition ("${r.attrs.cond}"); use a dynamic list or split the question.`);
      return {
        label,
        option: {
          code: Number.isFinite(value) ? value : i + 1,
          label: innerText(r) || label,
          ...(r.attrs.exclusive === '1' ? { exclusive: true } : {}),
          ...(r.attrs.randomize === '0' ? { anchor: true } : {}),
        },
      };
    });

  const visit = (el: XmlElement, blockCond?: string) => {
    for (const c of elements(el)) {
      if (c.name === 'suspend') {
        newPage();
        continue;
      }
      if (c.name === 'block') {
        if (c.attrs.randomizeChildren === '1')
          warn(c.line, 'A block randomizes its children; set up a randomized block in Survey settings → Randomized blocks.');
        const cond = convertCond(c.attrs.cond, c.line, `Block ${c.attrs.label ?? ''}`);
        newPage();
        visit(c, cond);
        newPage();
        continue;
      }
      if (c.name === 'term') {
        const cond = convertCond(c.attrs.cond, c.line, 'Termination');
        if (cond) {
          terminations.push({
            id: toId(c.attrs.label ?? `TERM${terminations.length + 1}`, `TERM${terminations.length + 1}`),
            condition: cond,
            status: 'terminate',
            label: innerText(c) || undefined,
          });
          converted.terminations++;
        }
        continue;
      }
      if (DECIPHER_IGNORED[c.name]) {
        warn(c.line, DECIPHER_IGNORED[c.name]!);
        continue;
      }
      if (!DECIPHER_QUESTION.has(c.name)) {
        warn(c.line, `<${c.name}> is not converted.`);
        continue;
      }
      const id = toId(c.attrs.label ?? '', `Q${converted.questions + 1}`);
      const titleEl = elements(c, 'title')[0];
      const text = (titleEl ? innerText(titleEl) : '') || (c.name === 'html' ? innerText(c) : '') || id;
      const commentEl = elements(c, 'comment')[0];
      const help = commentEl ? innerText(commentEl) : undefined;
      const own = convertCond(c.attrs.cond, c.line, id);
      const condition = blockCond && own ? `(${blockCond}) and (${own})` : (blockCond ?? own);
      const base: Record<string, unknown> = { id, text, ...(help ? { help } : {}), ...(condition ? { condition } : {}) };
      if (c.attrs.optional === '1') base.required = false;
      const rows = rowsOf(c, 'row');
      const cols = rowsOf(c, 'col');
      const choices = rowsOf(c, 'choice');
      const shuffle = (c.attrs.shuffle ?? '').includes('rows');
      let q: Record<string, unknown> | null = null;
      if (c.name === 'html') q = { id, type: 'info', text, ...(condition ? { condition } : {}) };
      else if (c.name === 'radio' && cols.length && rows.length)
        q = {
          ...base,
          type: 'grid',
          rows: rows.map((r) => ({ id: toId(r.label, 'r'), label: r.option.label })),
          columns: cols.map((x) => x.option),
          randomizeRows: shuffle,
        };
      else if (c.name === 'radio' || c.name === 'select') {
        const list = c.name === 'select' ? choices : rows.length ? rows : cols;
        if (c.name === 'select' && rows.length) warn(c.line, `${id}: a select with rows (one dropdown per row) is imported as a grid.`);
        q =
          c.name === 'select' && rows.length
            ? {
                ...base,
                type: 'grid',
                rows: rows.map((r) => ({ id: toId(r.label, 'r'), label: r.option.label })),
                columns: choices.map((x) => x.option),
                randomizeRows: shuffle,
              }
            : { ...base, type: 'single', options: list.map((r) => r.option), randomize: shuffle };
        known.set(id, { type: 'single', rows: new Map(list.map((r) => [r.label, r.option.code as number])) });
      } else if (c.name === 'checkbox') {
        if (cols.length && rows.length)
          warn(
            c.line,
            `${id}: a checkbox grid is imported as one multiple choice per column is not supported; it was imported over its rows only.`,
          );
        q = { ...base, type: 'multi', options: rows.map((r) => r.option), randomize: shuffle };
        if (c.attrs.atleast) q.minSelected = Number(c.attrs.atleast);
        if (c.attrs.atmost) q.maxSelected = Number(c.attrs.atmost);
        known.set(id, { type: 'multi', rows: new Map(rows.map((r) => [r.label, r.option.code as number])) });
      } else if (c.name === 'text' || c.name === 'textarea') {
        if (rows.length > 1) warn(c.line, `${id}: an open question with several rows is imported as one open question.`);
        q = { ...base, type: 'open', multiline: c.name === 'textarea' };
      } else if (c.name === 'number' || c.name === 'float') {
        if (rows.length > 1) warn(c.line, `${id}: a number question with several rows is imported as one number; consider a constant sum.`);
        q = { ...base, type: 'numeric', integer: c.name === 'number' };
        const range = /^\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*$/.exec(
          c.attrs.verify?.replace(/^range\(|\)$/g, '').replace(',', '-') ?? '',
        );
        if (range) Object.assign(q, { min: Number(range[1]), max: Number(range[2]) });
        else if (c.attrs.verify) warn(c.line, `${id}: the check "${c.attrs.verify}" was not converted; add a validation.`);
      }
      for (const a of Object.keys(c.attrs))
        if (!['label', 'cond', 'optional', 'shuffle', 'atleast', 'atmost', 'verify', 'type', 'size', 'where'].includes(a))
          warn(c.line, `${id}: attribute ${a}="${c.attrs[a]}" was not converted.`);
      if (c.attrs.where && c.attrs.where !== 'survey')
        warn(c.line, `${id}: where="${c.attrs.where}" (hidden/report-only question) was imported as a normal question.`);
      if (q) {
        current.questions.push(q);
        converted.questions++;
      }
    }
  };
  visit(root);
  newPage();
  converted.pages = pages.length;
  const definition = {
    schemaVersion: 1,
    title: root.attrs.alt ?? root.attrs.name ?? root.attrs.title ?? 'Imported survey',
    language: 'en',
    pages,
    terminations,
  };
  if (!pages.length) warn(root.line, 'No questions were found to convert.');
  return { definition, warnings, converted };
}
