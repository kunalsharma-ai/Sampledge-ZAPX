/**
 * Per provider+model circuit breaker. After `failures` consecutive provider failures the
 * circuit opens and calls fail fast for `openMs`; then one trial call is let through
 * (half-open). A success closes it again. In-process state: each API instance protects itself.
 */
export class CircuitBreaker {
  private readonly state = new Map<string, { failures: number; openUntil: number; trial: boolean }>();

  constructor(
    private readonly failures: number,
    private readonly openMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when a call may go ahead. */
  allow(key: string): boolean {
    const s = this.state.get(key);
    if (!s || s.openUntil === 0) return true;
    if (this.now() < s.openUntil) return false;
    if (s.trial) return false;
    s.trial = true;
    return true;
  }

  success(key: string) {
    this.state.delete(key);
  }

  failure(key: string) {
    const s = this.state.get(key) ?? { failures: 0, openUntil: 0, trial: false };
    s.failures++;
    if (s.trial || s.failures >= this.failures) {
      s.openUntil = this.now() + this.openMs;
      s.trial = false;
    }
    this.state.set(key, s);
  }

  snapshot(key: string) {
    const s = this.state.get(key);
    return { open: !!s && s.openUntil > this.now(), failures: s?.failures ?? 0 };
  }
}
