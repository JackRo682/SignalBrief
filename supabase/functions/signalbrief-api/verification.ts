/** Resolve the complete plan before executing any provider call. */
export const verificationProviders = ['fx', 'fmp', 'openai', 'resend', 'sec', 'gnews'] as const;
export type VerificationProvider = typeof verificationProviders[number];
export function verificationPlan(value: unknown): VerificationProvider[] {
  if (value === undefined) return [...verificationProviders];
  if (!Array.isArray(value) || value.length === 0 || value.length > verificationProviders.length ||
      value.some(p => typeof p !== 'string' || !verificationProviders.includes(p as VerificationProvider))) {
    throw new Error('invalid_verification_providers');
  }
  return [...new Set(value)] as VerificationProvider[];
}
export async function runVerification<T>(providers: VerificationProvider[], checks: Record<VerificationProvider, () => Promise<T>>) {
  const result: Partial<Record<VerificationProvider, T>> = {};
  for (const provider of providers) result[provider] = await checks[provider]();
  return result;
}
