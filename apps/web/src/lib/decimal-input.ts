/** Expand stored decimal exponent notation for editing, without binary-float rounding. */
export function decimalInput(value: string | null | undefined): string {
  if (value == null) return '';
  const match = /^(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(value);
  if (!match) return value;
  // This bound covers the backend's 20 integer / 8 fraction digits and prevents
  // unexpectedly large strings from malformed responses. Unsupported input stays intact.
  const exponent = Number(match[3]);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return value;
  const whole = match[1], fraction = match[2] ?? '', digits = whole + fraction, point = whole.length + exponent;
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}
