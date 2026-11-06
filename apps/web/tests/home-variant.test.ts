import { describe, expect, it } from 'vitest';
import { HOME_EXPERIMENT_ID, assignedHomeVariant, homeRolloutMode, resolveHomeVariant } from '@/redesign/home-variant';

const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';

describe('home experiment immutable assignment', () => {
  it('locks the experiment identity and representative cohorts', () => {
    expect(HOME_EXPERIMENT_ID).toBe('home-layout-20261106-v1');
    expect(assignedHomeVariant(a)).toBe('A');
    expect(assignedHomeVariant(b)).toBe('B');
    expect(assignedHomeVariant('')).toBe('A');
  });
  it('is stable over repeated calls and balances 10,000 synthetic accounts', () => {
    let groupA = 0;
    for (let i = 0; i < 10_000; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      const value = assignedHomeVariant(id);
      expect(assignedHomeVariant(id)).toBe(value);
      if (value === 'A') groupA++;
    }
    // Exact result is a regression lock, not a claim about production user counts.
    expect(groupA).toBe(5026);
  });
  it.each(['A', 'B', 'invalid', '', null])('ignores ordinary-user preview %s', preview => {
    expect(resolveHomeVariant({ userId: a, isAdmin: false, preview, mode: 'split' }))
      .toEqual({ assigned: 'A', variant: 'A', isPreview: false });
  });
  it('allows an administrator to preview without changing the assigned cohort', () => {
    expect(resolveHomeVariant({ userId: a, isAdmin: true, preview: 'B', mode: 'split' }))
      .toEqual({ assigned: 'A', variant: 'B', isPreview: true });
    expect(resolveHomeVariant({ userId: a, isAdmin: true, preview: null, mode: 'split' }).variant).toBe('A');
  });
  it.each(['A', 'B'] as const)('honors a forced %s mode even during preview', mode => {
    expect(resolveHomeVariant({ userId: a, isAdmin: true, preview: 'B', mode }))
      .toEqual({ assigned: 'A', variant: mode, isPreview: false });
  });
  it('defaults to split and fails closed for misspelled configuration', () => {
    expect(homeRolloutMode(undefined)).toBe('split');
    expect(homeRolloutMode('split')).toBe('split');
    expect(homeRolloutMode('A')).toBe('A');
    expect(homeRolloutMode('B')).toBe('B');
    expect(homeRolloutMode('typo')).toBe('A');
  });
});
