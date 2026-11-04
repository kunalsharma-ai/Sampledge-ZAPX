/**
 * AI research assistant (blueprint phase 4). ZAPX computes the tables (frequencies, or crosstabs by
 * a banner, with significance letters) exactly as the Analysis tab does; the model only reads them.
 * Every finding must cite a table it was read from: findings that cite nothing, or a table that was
 * not sent, are dropped and the answer says how many. Answers are never written into reports
 * automatically; the researcher reads them next to the tables they came from.
 */
import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { crosstab, frequency, type Crosstab, type Frequency, type Variable } from '@zapx/analysis-core';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { AiError, AiProvider, type InsightTable } from '../ai/ai-provider';
import { AiGateway } from '../ai/ai-gateway';
import { notConfigured } from '../ai/claude.provider';
import { redactPii } from '../ai/redact';
import { AnalysisService, filtersSchema, weightingSchema } from './analysis.service';

/** Most tables sent in one question (keeps the prompt small and the answer focused). */
export const MAX_ASSISTANT_TABLES = 20;

export const askSchema = z.object({
  question: z.string().trim().min(3).max(2000),
  /** Variables to tabulate; default: the first questions in the survey. */
  variables: z.array(z.string().max(100)).max(MAX_ASSISTANT_TABLES).optional(),
  /** Crosstab every variable by this one (single or multiple choice). */
  banner: z.string().max(100).optional(),
  filters: filtersSchema,
  weighting: weightingSchema,
});
export type AskInput = z.infer<typeof askSchema>;

const n1 = (x: number) => (Math.round(x * 10) / 10).toString();

export function frequencyText(f: Frequency, weighted: boolean): string {
  const lines = [
    `Base: ${f.unweightedBase} answered${weighted ? ` (weighted ${n1(f.base)}, effective ${n1(f.effectiveBase)})` : ''}${f.unweightedBase < 50 ? ' [LOW BASE]' : ''}`,
  ];
  if (f.variable.kind === 'multi') lines.push('More than one answer allowed: percentages can add up to more than 100.');
  if (f.rows.length) {
    lines.push('Answer | Count | %');
    for (const r of f.rows) lines.push(`${r.label} | ${n1(r.count)} | ${n1(r.pct)}%`);
  }
  if (f.stats) lines.push(`Mean ${n1(f.stats.mean)} (sd ${n1(f.stats.sd)}, median ${n1(f.stats.median)}, min ${f.stats.min}, max ${f.stats.max}, n ${f.stats.n})`);
  if (f.nps) lines.push(`NPS ${n1(f.nps.score)} (promoters ${n1(f.nps.promoters)}%, detractors ${n1(f.nps.detractors)}%)`);
  return lines.join('\n');
}

export function crosstabText(x: Crosstab, weighted: boolean): string {
  const cols = x.columns.map((c, i) => (i === 0 ? `Total` : `${c.letter}: ${c.label}`));
  const lines = [
    `Columns: ${cols.join(' | ')}`,
    `Bases: ${x.columns.map((c) => `${c.unweightedBase}${weighted ? ` (w ${n1(c.base)})` : ''}${c.lowBase ? ' [LOW BASE]' : ''}`).join(' | ')}`,
    `Significance at ${Math.round(x.confidence * 100)}%: a letter after a % means higher than that column.${x.testNote ? ` ${x.testNote}` : ''}`,
  ];
  for (const r of x.rows)
    lines.push(`${r.label} | ${r.cells.map((c) => `${n1(c.pct)}%${c.higherThan.length ? ` ${c.higherThan.join('')}` : ''}`).join(' | ')}`);
  if (x.means) lines.push(`Mean | ${x.means.map((m) => (m.stats ? `${n1(m.stats.mean)}${m.higherThan.length ? ` ${m.higherThan.join('')}` : ''}` : '-')).join(' | ')}`);
  return lines.join('\n');
}

@Injectable()
export class ResearchAssistantService {
  constructor(
    private readonly analysis: AnalysisService,
    private readonly gateway: AiGateway,
    private readonly ai: AiProvider,
  ) {}

  /** The tables the assistant would read, without calling AI (shown before asking, and in tests). */
  async tables(user: AuthUser, surveyId: string, input: Omit<AskInput, 'question'>) {
    const { survey, def, vars, records } = await this.analysis.load(user, surveyId, input.filters);
    const weighting = input.weighting ? this.analysis.applyWeights(vars, records, input.weighting) : null;
    const find = (id: string): Variable => {
      const v = vars.find((x) => x.id === id);
      if (!v) throw new BadRequestException(`Unknown variable ${id}`);
      return v;
    };
    const banner = input.banner ? find(input.banner) : null;
    if (banner && banner.kind !== 'single' && banner.kind !== 'multi') throw new BadRequestException('Choose a single or multiple choice banner.');
    const chosen = (
      input.variables?.length ? input.variables.map(find) : vars.filter((v) => v.source !== 'system' && v.kind !== 'open' && v.id !== banner?.id)
    )
      .filter((v) => v.kind !== 'open')
      .slice(0, MAX_ASSISTANT_TABLES);
    const tables: Array<InsightTable & { variable: string }> = chosen.map((v, i) => ({
      id: `T${i + 1}`,
      variable: v.id,
      title: banner ? `${v.id}: ${v.label} by ${banner.id}: ${banner.label}` : `${v.id}: ${v.label}`,
      text: banner && v.id !== banner.id ? crosstabText(crosstab(banner, v, records), !!weighting) : frequencyText(frequency(v, records), !!weighting),
    }));
    return { survey, def, total: records.length, weighted: !!weighting, tables };
  }

  async ask(user: AuthUser, surveyId: string, input: AskInput) {
    if (!this.gateway.configured) throw toHttp(notConfigured());
    const { def, total, weighted, tables } = await this.tables(user, surveyId, input);
    if (!total) throw new BadRequestException('There are no interviews in this selection to read.');
    if (!tables.length) throw new BadRequestException('Choose at least one variable to tabulate.');
    const actor = { tenantId: user.tenantId, userId: user.id };
    const admitted = await this.gateway.admit('insights', actor, surveyId).catch((e: unknown) => {
      throw toHttp(e);
    });
    // The question is free text a researcher typed, so it is redacted like a brief. Tables are
    // counts and survey labels, not personal data (open answers are never sent).
    const q = admitted.policy.redactPii ? redactPii(input.question) : { text: input.question, count: 0 };
    const r = await this.gateway
      .run('insights', actor, (m) => this.ai.insights({ surveyTitle: def.title, question: q.text, tables: tables.map(({ id, title, text }) => ({ id, title, text })) }, m), {
        surveyId,
        redactions: q.count,
        admitted,
      })
      .catch((e: unknown) => {
        throw toHttp(e);
      });
    const known = new Set(tables.map((t) => t.id));
    const findings = r.findings
      .map((f) => ({ statement: f.statement.slice(0, 2000), tables: [...new Set(f.tables.filter((t) => known.has(t)))] }))
      .filter((f) => f.statement.trim() && f.tables.length);
    const dropped = r.findings.length - findings.length;
    const caveats = r.caveats.map((c) => c.slice(0, 1000)).slice(0, 20);
    if (dropped) caveats.push(`${dropped} statement${dropped === 1 ? '' : 's'} that did not cite a table ${dropped === 1 ? 'was' : 'were'} left out.`);
    if (!weighted) caveats.push('Unweighted data.');
    return {
      answer: r.answer.slice(0, 4000),
      findings: findings.slice(0, 30),
      caveats,
      tables,
      total,
      weighted,
      model: r.model,
      redactions: q.count,
    };
  }
}

function toHttp(e: unknown): unknown {
  if (e instanceof AiError) return new HttpException({ message: e.message, code: e.code }, e.status);
  return e;
}
