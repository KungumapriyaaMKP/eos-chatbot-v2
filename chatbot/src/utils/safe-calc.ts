/**
 * FIX #3: Safe arithmetic operations
 * Prevents NaN, Infinity, and division by zero crashes
 */

export function safePercentage(numerator: number, denominator: number, decimals: number = 2): number {
  if (!denominator || isNaN(denominator) || !isFinite(denominator)) {
    return 0;
  }
  if (!numerator || isNaN(numerator)) {
    return 0;
  }
  const result = (numerator / denominator) * 100;
  return Math.round(result * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export function safeDivide(numerator: number | null | undefined, denominator: number | null | undefined, fallback: number = 0): number {
  const n = Number(numerator);
  const d = Number(denominator);

  if (isNaN(n) || isNaN(d) || d === 0 || !isFinite(d)) {
    return fallback;
  }

  return n / d;
}

export function safeSum(values: (number | null | undefined)[]): number {
  return values.reduce((sum: number, v) => {
    const num = Number(v) || 0;
    return (sum || 0) + num;
  }, 0);
}
