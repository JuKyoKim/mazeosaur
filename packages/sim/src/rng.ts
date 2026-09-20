/**
 * Seeded PRNG (mulberry32). The simulation must never call Math.random:
 * every run is reproducible from (seed, command log), which is what makes
 * replays, server-side verification and balance harnesses possible.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Next value as an unsigned 32-bit integer. */
  nextU32(): number {
    let t = (this.state += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Float in [0, 1). */
  float(): number {
    return this.nextU32() / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + (this.nextU32() % (max - min + 1));
  }

  /** Snapshot for save files / replays. */
  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}
