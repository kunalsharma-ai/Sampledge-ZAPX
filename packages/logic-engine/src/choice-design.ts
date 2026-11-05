/**
 * Experimental designs for MaxDiff and choice-based conjoint (blueprint phase 4).
 *
 * Designs are deterministic: computed from the question alone, so the device, the server and the
 * analysis all see the same sets without storing them. Each respondent gets one version, chosen from
 * their seed. The generators are greedy balancing heuristics (not D-optimal search): every item or
 * level is shown as evenly as possible, and pairs or level overlaps are kept low.
 */
import type { ConjointQuestion, MaxDiffQuestion } from '@zapx/survey-schema';

/** Small seeded generator (mulberry32 over an FNV-1a hash of the seed text). */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Which design version a respondent gets. */
export function designVersion(questionId: string, seed: string, versions: number): number {
  return Math.floor(rng(`${seed}:${questionId}:version`)() * versions);
}

const designCache = new Map<string, unknown>();
function cached<T>(key: string, make: () => T): T {
  if (!designCache.has(key)) {
    if (designCache.size > 200) designCache.clear();
    designCache.set(key, make());
  }
  return designCache.get(key) as T;
}

/**
 * MaxDiff design: versions × sets × item codes. Within a version, items with the fewest appearances
 * are picked first; ties go to the item that has appeared least with the items already in the set.
 */
export function maxDiffDesign(q: Pick<MaxDiffQuestion, 'id' | 'options' | 'itemsPerSet' | 'sets' | 'versions'>): number[][][] {
  const codes = q.options.map((o) => o.code);
  const per = Math.min(q.itemsPerSet, codes.length);
  return cached(`md:${q.id}:${codes.join(',')}:${per}:${q.sets}:${q.versions}`, () => {
    const out: number[][][] = [];
    for (let v = 0; v < q.versions; v++) {
      const r = rng(`${q.id}:maxdiff:${v}`);
      const shown = new Map(codes.map((c) => [c, 0]));
      const pair = new Map<string, number>();
      const pk = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
      const version: number[][] = [];
      for (let s = 0; s < q.sets; s++) {
        const set: number[] = [];
        while (set.length < per) {
          let best: number | null = null;
          let bestScore = Infinity;
          for (const c of codes) {
            if (set.includes(c)) continue;
            const together = set.reduce((n, x) => n + (pair.get(pk(c, x)) ?? 0), 0);
            const score = shown.get(c)! * 1000 + together * 10 + r();
            if (score < bestScore) {
              bestScore = score;
              best = c;
            }
          }
          set.push(best!);
        }
        for (const c of set) shown.set(c, shown.get(c)! + 1);
        for (let i = 0; i < set.length; i++)
          for (let j = i + 1; j < set.length; j++) pair.set(pk(set[i]!, set[j]!), (pair.get(pk(set[i]!, set[j]!)) ?? 0) + 1);
        // Show the set in random order, so position does not follow the item list.
        version.push(
          set
            .map((c) => [c, r()] as const)
            .sort((a, b) => a[1] - b[1])
            .map(([c]) => c),
        );
      }
      out.push(version);
    }
    return out;
  });
}

/**
 * Conjoint design: versions × tasks × concepts × level code per attribute (in attribute order).
 * Levels with the fewest appearances are used first (level balance), avoiding a level already used
 * in the same task when possible (minimal overlap), and never two identical concepts in a task.
 */
export function conjointDesign(q: Pick<ConjointQuestion, 'id' | 'attributes' | 'tasks' | 'conceptsPerTask' | 'versions'>): number[][][][] {
  const key = `cj:${q.id}:${JSON.stringify(q.attributes.map((a) => a.levels.map((l) => l.code)))}:${q.tasks}:${q.conceptsPerTask}:${q.versions}`;
  return cached(key, () => {
    const out: number[][][][] = [];
    for (let v = 0; v < q.versions; v++) {
      const r = rng(`${q.id}:conjoint:${v}`);
      const used = q.attributes.map((a) => new Map(a.levels.map((l) => [l.code, 0])));
      const version: number[][][] = [];
      for (let t = 0; t < q.tasks; t++) {
        const task: number[][] = [];
        for (let c = 0; c < q.conceptsPerTask; c++) {
          let concept: number[] = [];
          for (let tries = 0; tries < 20; tries++) {
            concept = q.attributes.map((a, ai) => {
              const inTask = new Set(task.map((x) => x[ai]));
              let best = a.levels[0]!.code;
              let bestScore = Infinity;
              for (const l of a.levels) {
                const score = (inTask.has(l.code) ? 1000 : 0) + used[ai]!.get(l.code)! * 10 + r() * 5;
                if (score < bestScore) {
                  bestScore = score;
                  best = l.code;
                }
              }
              return best;
            });
            if (!task.some((x) => x.every((code, i) => code === concept[i]))) break;
          }
          concept.forEach((code, ai) => used[ai]!.set(code, used[ai]!.get(code)! + 1));
          task.push(concept);
        }
        version.push(task);
      }
      out.push(version);
    }
    return out;
  });
}

/** The MaxDiff sets one respondent sees. */
export function maxDiffSetsFor(q: MaxDiffQuestion, seed: string): { version: number; sets: number[][] } {
  const version = designVersion(q.id, seed, q.versions);
  return { version, sets: maxDiffDesign(q)[version]! };
}

/** The conjoint tasks one respondent sees. */
export function conjointTasksFor(q: ConjointQuestion, seed: string): { version: number; tasks: number[][][] } {
  const version = designVersion(q.id, seed, q.versions);
  return { version, tasks: conjointDesign(q)[version]! };
}
