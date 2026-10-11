/**
 * The statistics of the analysis plan (proposal §11.5): medians and proportions with their counts,
 * the change between phases, and the paired tests (McNemar for a yes/no answer of the same
 * household, Wilcoxon signed-rank for times and ordinal scores of the same point or household).
 */

/** The median, or null without values (the mean of the two middle values for an even count). */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

/** 100 × part / whole, or null when the whole is zero. */
export function percentage(part: number, whole: number): number | null {
  return whole === 0 ? null : (100 * part) / whole;
}

/** part / whole, or null when the whole is zero. */
export function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

/**
 * The change from a baseline to a later value:
 * - `relative`: 100 × (later − baseline) / baseline, in percent (a reduction is negative, as the
 *   proposal's "−30 %" targets read);
 * - `absolute`: later − baseline, when the baseline is zero (a relative change is undefined);
 * - `points`: later − baseline in percentage points, for proportions compared as such.
 */
export type Change =
  | { readonly kind: 'relative'; readonly percent: number }
  | { readonly kind: 'absolute'; readonly difference: number }
  | { readonly kind: 'points'; readonly difference: number };

/** The relative change, or the absolute one when the baseline is zero; null without both. */
export function relativeChange(baseline: number | null, later: number | null): Change | null {
  if (baseline === null || later === null) return null;
  if (baseline === 0) return { kind: 'absolute', difference: later - baseline };
  return { kind: 'relative', percent: (100 * (later - baseline)) / baseline };
}

/** The change of a proportion (in percent) in percentage points; null without both. */
export function pointsChange(before: number | null, after: number | null): Change | null {
  if (before === null || after === null) return null;
  return { kind: 'points', difference: after - before };
}

/**
 * McNemar's exact test of paired yes/no answers: `yesToNo` pairs answered yes before and no
 * after, `noToYes` the opposite (the concordant pairs do not enter the test). The two-sided
 * p-value is the exact binomial one (`binomtest(min(b, c), b + c, 0.5)`); null without discordant
 * pairs.
 */
export interface McNemarResult {
  readonly yesToNo: number;
  readonly noToYes: number;
  readonly pValue: number | null;
}

export function mcnemarExact(yesToNo: number, noToYes: number): McNemarResult {
  const n = yesToNo + noToYes;
  if (n === 0) return { yesToNo, noToYes, pValue: null };
  const k = Math.min(yesToNo, noToYes);
  // Sum of C(n, i) / 2^n for i ≤ k, in log space so a large n cannot underflow.
  let logTerm = -n * Math.LN2;
  let tail = Math.exp(logTerm);
  for (let i = 1; i <= k; i++) {
    logTerm += Math.log(n - i + 1) - Math.log(i);
    tail += Math.exp(logTerm);
  }
  return { yesToNo, noToYes, pValue: Math.min(1, 2 * tail) };
}

/**
 * The Wilcoxon signed-rank test of paired differences (after − before). Zero differences are
 * dropped; tied magnitudes get their average rank. The statistic is the smaller of the positive
 * and negative rank sums. The two-sided p-value is exact (the null distribution of the rank sum)
 * when there are no ties and at most 25 non-zero differences; otherwise it is the normal
 * approximation with the tie and continuity corrections.
 */
export interface WilcoxonResult {
  /** Non-zero differences. */
  readonly n: number;
  readonly positiveRankSum: number;
  readonly negativeRankSum: number;
  readonly statistic: number;
  readonly pValue: number | null;
  readonly method: 'exact' | 'normal' | null;
}

const EXACT_MAX_N = 25;

export function wilcoxonSignedRank(differences: readonly number[]): WilcoxonResult {
  const nonZero = differences.filter((d) => d !== 0);
  const n = nonZero.length;
  if (n === 0) {
    return {
      n,
      positiveRankSum: 0,
      negativeRankSum: 0,
      statistic: 0,
      pValue: null,
      method: null,
    };
  }
  const order = nonZero
    .map((d, index) => ({ magnitude: Math.abs(d), index }))
    .sort((a, b) => a.magnitude - b.magnitude);
  const ranks = new Array<number>(n).fill(0);
  const tieSizes: number[] = [];
  for (let start = 0; start < n;) {
    let end = start;
    while (end + 1 < n && order[end + 1]?.magnitude === order[start]?.magnitude) end += 1;
    const averageRank = (start + end + 2) / 2;
    for (let i = start; i <= end; i++) ranks[order[i]?.index ?? 0] = averageRank;
    if (end > start) tieSizes.push(end - start + 1);
    start = end + 1;
  }
  let positiveRankSum = 0;
  let negativeRankSum = 0;
  nonZero.forEach((d, index) => {
    if (d > 0) positiveRankSum += ranks[index] ?? 0;
    else negativeRankSum += ranks[index] ?? 0;
  });
  const statistic = Math.min(positiveRankSum, negativeRankSum);
  if (tieSizes.length === 0 && n <= EXACT_MAX_N) {
    return {
      n,
      positiveRankSum,
      negativeRankSum,
      statistic,
      pValue: Math.min(1, 2 * exactRankSumCdf(n, statistic)),
      method: 'exact',
    };
  }
  const mean = (n * (n + 1)) / 4;
  const tieCorrection = tieSizes.reduce((sum, t) => sum + (t ** 3 - t), 0) / 48;
  const variance = (n * (n + 1) * (2 * n + 1)) / 24 - tieCorrection;
  if (variance <= 0) {
    return { n, positiveRankSum, negativeRankSum, statistic, pValue: null, method: null };
  }
  const z = Math.max(0, Math.abs(statistic - mean) - 0.5) / Math.sqrt(variance);
  return {
    n,
    positiveRankSum,
    negativeRankSum,
    statistic,
    pValue: Math.min(1, 2 * normalUpperTail(z)),
    method: 'normal',
  };
}

/** P(W ≤ w) for the signed-rank sum of n untied ranks, by counting the subsets of 1..n. */
function exactRankSumCdf(n: number, w: number): number {
  const maxSum = (n * (n + 1)) / 2;
  const counts = new Array<number>(maxSum + 1).fill(0);
  counts[0] = 1;
  for (let rank = 1; rank <= n; rank++) {
    for (let sum = maxSum; sum >= rank; sum--)
      counts[sum] = (counts[sum] ?? 0) + (counts[sum - rank] ?? 0);
  }
  let atMost = 0;
  for (let sum = 0; sum <= Math.floor(w); sum++) atMost += counts[sum] ?? 0;
  return atMost / 2 ** n;
}

/** P(Z > z) for a standard normal Z (complementary error function, Numerical Recipes erfc). */
function normalUpperTail(z: number): number {
  const x = z / Math.SQRT2;
  const t = 1 / (1 + 0.5 * Math.abs(x));
  const erfc =
    t *
    Math.exp(
      -x * x -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return (x >= 0 ? erfc : 2 - erfc) / 2;
}
