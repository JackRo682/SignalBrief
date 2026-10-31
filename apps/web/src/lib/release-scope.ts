/** Reversible public product scope. Admin routes and all stored data are retained. */
export const researchMvp = process.env.NEXT_PUBLIC_RESEARCH_MVP !== 'false';
export const publicFeatures = {marketData: !researchMvp, portfolio: !researchMvp, comparisons: !researchMvp, subscriptions: !researchMvp} as const;
