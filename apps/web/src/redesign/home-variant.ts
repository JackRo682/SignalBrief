/** Immutable assignment contract. Change the ID only when starting a NEW experiment. */
export const HOME_EXPERIMENT_ID = 'home-layout-20261106-v1';
export type HomeVariant = 'A' | 'B';
export type HomeRolloutMode = 'split' | HomeVariant;

/** Build-time emergency override; an absent setting enables the requested 50/50 split. */
export function homeRolloutMode(value: string | undefined): HomeRolloutMode {
  if (value === undefined || value === 'split') return 'split';
  return value === 'B' ? 'B' : 'A';
}

/** Stable across refreshes, sessions and devices for the same authenticated account.
 * This hash is for experiment allocation, NEVER authentication/authorization.
 * No cookie, new persistent identifier, email, token or database write is needed.
 */
export function assignedHomeVariant(userId: string): HomeVariant {
  if (!userId.trim()) return 'A';
  const seed = `${HOME_EXPERIMENT_ID}:${userId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193);
  }
  // Avalanche the bits before bucketing; preserve these constants for this experiment.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) % 100 < 50 ? 'A' : 'B';
}

export function resolveHomeVariant({ userId, isAdmin, preview, mode }: {
  userId: string;
  isAdmin: boolean;
  preview: string | null;
  mode: HomeRolloutMode;
}): { assigned: HomeVariant; variant: HomeVariant; isPreview: boolean } {
  const assigned = assignedHomeVariant(userId);
  if (mode !== 'split') return { assigned, variant: mode, isPreview: false };
  if (isAdmin && (preview === 'A' || preview === 'B')) {
    return { assigned, variant: preview, isPreview: true };
  }
  return { assigned, variant: assigned, isPreview: false };
}
