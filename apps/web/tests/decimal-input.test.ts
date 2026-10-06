import {describe, expect, it} from 'vitest';
import {decimalInput} from '../src/lib/decimal-input';

describe('existing holding decimal prefill', () => {
  it('expands API-normalized whole quantities and small fractional costs', () => {
    expect(decimalInput('1E+3')).toBe('1000');
    expect(decimalInput('1.25E+2')).toBe('125');
    expect(decimalInput('1E-8')).toBe('0.00000001');
    expect(decimalInput('12.345e-2')).toBe('0.12345');
  });

  it('preserves the full supported precision above the safe integer range', () => {
    expect(decimalInput('9.999999999999999999999999999E+19')).toBe('99999999999999999999.99999999');
    expect(decimalInput('12345678901234567890.12345678')).toBe('12345678901234567890.12345678');
  });

  it('keeps zero, null and optional blank costs distinct', () => {
    expect(decimalInput('0E-8')).toBe('0.00000000');
    expect(decimalInput('0')).toBe('0');
    expect(decimalInput(null)).toBe('');
    expect(decimalInput(undefined)).toBe('');
  });

  it('never silently rounds or truncates unsupported values', () => {
    for (const value of ['-1', 'NaN', '1e1000', '1e-1000', '1.123456789', 'not-a-number']) {
      expect(decimalInput(value)).toBe(value);
    }
  });
});
