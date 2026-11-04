/**
 * Taking and releasing quota places (blueprint phase 4 adds least-fill groups). Every path that
 * counts a complete (web, CAPI sync, reinstated appeal) and every path that releases one (quality
 * reject, failed back-check) goes through here, so a grouped respondent is counted once, toward the
 * cell that was least filled, and the same cell is released later.
 */
import type { Prisma } from '@zapx/db';
import { matchingQuotas, quotaSlots } from '@zapx/logic-engine';
import type { Answers, SurveyDefinition } from '@zapx/survey-schema';

export type TakeResult = { ok: true; cells: string[] } | { ok: false; quotaId: string };

/**
 * Count the complete toward its quotas inside the caller's transaction, never overfilling. When a
 * slot has no room the caller must throw so the transaction rolls back the places already taken.
 */
export async function takeQuotaPlaces(
  tx: Prisma.TransactionClient,
  surveyId: string,
  def: SurveyDefinition,
  answers: Answers,
): Promise<TakeResult> {
  const matching = matchingQuotas(def, answers);
  if (!matching.length) return { ok: true, cells: [] };
  const counts = new Map(
    (await tx.quotaCount.findMany({ where: { surveyId, quotaId: { in: matching.map((q) => q.id) } } })).map((c) => [c.quotaId, c]),
  );
  const slots = quotaSlots(def, answers, (q) => {
    const c = counts.get(q.id);
    const target = c?.targetOverride ?? q.target;
    return target > 0 ? (c?.count ?? 0) / target : Infinity;
  });
  const cells: string[] = [];
  for (const slot of slots) {
    let taken: string | null = null;
    for (const q of slot) {
      const n = await tx.$executeRaw`UPDATE "QuotaCount" SET "count" = "count" + 1
        WHERE "surveyId" = ${surveyId} AND "quotaId" = ${q.id} AND "count" < COALESCE("targetOverride", ${q.target})`;
      if (n > 0) {
        taken = q.id;
        break;
      }
    }
    if (!taken) return { ok: false, quotaId: slot[0]!.id };
    cells.push(taken);
  }
  return { ok: true, cells };
}

/** The first quota that would refuse this respondent now (a least-fill group only when all its matches are full). */
export async function firstFullSlot(
  db: { quotaCount: Prisma.TransactionClient['quotaCount'] },
  surveyId: string,
  def: SurveyDefinition,
  answers: Answers,
): Promise<string | null> {
  const matching = matchingQuotas(def, answers);
  if (!matching.length) return null;
  const counts = new Map(
    (await db.quotaCount.findMany({ where: { surveyId, quotaId: { in: matching.map((q) => q.id) } } })).map((c) => [c.quotaId, c]),
  );
  const full = (id: string, target: number) => {
    const c = counts.get(id);
    return (c?.count ?? 0) >= (c?.targetOverride ?? target);
  };
  for (const slot of quotaSlots(def, answers)) if (slot.every((q) => full(q.id, q.target))) return slot[0]!.id;
  return null;
}

/** Give back the places a complete took. Completes stored before phase 4 have no cells: their matching quotas. */
export async function releaseQuotaPlaces(
  tx: Prisma.TransactionClient,
  surveyId: string,
  def: SurveyDefinition,
  r: { answers: unknown; quotaCells: string[] },
) {
  const ids = r.quotaCells.length ? r.quotaCells : matchingQuotas(def, (r.answers ?? {}) as Answers).map((q) => q.id);
  for (const id of ids)
    await tx.$executeRaw`UPDATE "QuotaCount" SET "count" = "count" - 1 WHERE "surveyId" = ${surveyId} AND "quotaId" = ${id} AND "count" > 0`;
}
