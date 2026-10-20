export const CALIBRATION_BINS = 10;
const Z_95 = 1.96;

export type Scored = { truth: string; options: string[]; probabilities: number[] };

export type Bin = {
  lo: number;
  hi: number;
  n: number;
  correct: number;
  meanConfidence: number;
  accuracy: number | null;
};

function log2(value: number) {
  return Math.log(value) / Math.LN2;
}

export function argmax(values: number[]): number {
  return values.reduce((best, value, index) => (value > (values[best] ?? -Infinity) ? index : best), 0);
}

function klDivergence(p: number[], q: number[]) {
  return p.reduce((sum, value, index) => (value > 0 ? sum + value * log2(value / (q[index] ?? 0)) : sum), 0);
}

export function jsDivergence(p: number[], q: number[]): number {
  const middle = p.map((value, index) => (value + (q[index] ?? 0)) / 2);
  const divergence = 0.5 * klDivergence(p, middle) + 0.5 * klDivergence(q, middle);
  return Math.max(0, Math.min(1, divergence));
}

export function divergenceMatrix(rows: { id: string; probabilities: number[] }[]) {
  let maxPair: { a: string; b: string; value: number } | null = null;
  const values = rows.map((a, i) =>
    rows.map((b, j) => {
      const value = i === j ? 0 : jsDivergence(a.probabilities, b.probabilities);
      if (i < j && (!maxPair || value > maxPair.value)) maxPair = { a: a.id, b: b.id, value };
      return value;
    }),
  );
  return { ids: rows.map((row) => row.id), values, maxPair: maxPair as { a: string; b: string; value: number } | null };
}

export function consensus(answers: string[]) {
  const counts = new Map<string, number>();
  for (const answer of answers) counts.set(answer, (counts.get(answer) ?? 0) + 1);

  let answer = answers[0] ?? '';
  let count = 0;
  for (const [candidate, n] of counts) {
    if (n > count) {
      answer = candidate;
      count = n;
    }
  }
  return { answer, count, total: answers.length, unanimous: count === answers.length };
}

export function expectedValue(options: string[], probabilities: number[]): number {
  return options.reduce((sum, option, index) => sum + Number(option) * (probabilities[index] ?? 0), 0);
}

export function confusionMatrix(options: string[], items: Scored[]): number[][] {
  const matrix = options.map(() => options.map(() => 0));
  for (const item of items) {
    const row = matrix[options.indexOf(item.truth)];
    if (!row) continue;
    const predicted = argmax(item.probabilities);
    row[predicted] = (row[predicted] ?? 0) + 1;
  }
  return matrix;
}

export function accuracyOf(matrix: number[][]): number {
  const total = matrix.flat().reduce((sum, value) => sum + value, 0);
  const right = matrix.reduce((sum, row, index) => sum + (row[index] ?? 0), 0);
  return total ? right / total : 0;
}

export function calibrationBins(items: Scored[], count = CALIBRATION_BINS): Bin[] {
  const bins = Array.from({ length: count }, (_, index) => ({
    lo: index / count,
    hi: (index + 1) / count,
    n: 0,
    correct: 0,
    confidenceSum: 0,
  }));
  for (const item of items) {
    const predicted = argmax(item.probabilities);
    const confidence = item.probabilities[predicted] ?? 0;
    const bin = bins[Math.min(count - 1, Math.floor(confidence * count))];
    if (!bin) continue;
    bin.n++;
    bin.confidenceSum += confidence;
    if (item.options[predicted] === item.truth) bin.correct++;
  }
  return bins.map(({ lo, hi, n, correct, confidenceSum }) => ({
    lo,
    hi,
    n,
    correct,
    meanConfidence: n ? confidenceSum / n : (lo + hi) / 2,
    accuracy: n ? correct / n : null,
  }));
}

export function expectedCalibrationError(bins: Bin[]): number {
  const total = bins.reduce((sum, bin) => sum + bin.n, 0);
  if (!total) return 0;
  const weighted = bins.reduce((sum, bin) => sum + bin.n * Math.abs((bin.accuracy ?? 0) - bin.meanConfidence), 0);
  return weighted / total;
}

export function brierScore(items: Scored[]): number {
  if (!items.length) return 0;
  const total = items.reduce(
    (sum, item) =>
      sum +
      item.options.reduce((inner, option, index) => {
        const target = option === item.truth ? 1 : 0;
        return inner + ((item.probabilities[index] ?? 0) - target) ** 2;
      }, 0),
    0,
  );
  return total / items.length;
}

export function diffHalfWidth(p1: number, p2: number, n: number): number {
  if (!n || !Number.isFinite(n)) return 0;
  const variance = (p1 * (1 - p1)) / n + (p2 * (1 - p2)) / n;
  return Z_95 * Math.sqrt(Math.max(variance, 0.25 / (n * n)));
}

export function marginOfError(n: number): number {
  return n > 0 ? Z_95 * Math.sqrt(0.25 / n) : 0;
}
