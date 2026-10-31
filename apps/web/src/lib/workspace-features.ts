import type {IconName} from '@/components/icons';

/** One release policy for the customer workspace. Disabled implementations remain
 * in the repository; enabling a feature requires verified data and its tests. */
export const workspaceFeatures: Readonly<Record<
  'marketData' | 'portfolio' | 'brokerage' | 'widgets' | 'advancedFilters' |
  'competitorComparison' | 'customerExperiments' | 'teamPlans', boolean
>> = Object.freeze({
  marketData: false,
  portfolio: false,
  brokerage: false,
  widgets: false,
  advancedFilters: false,
  competitorComparison: false,
  customerExperiments: false,
  teamPlans: false,
});

export type WorkspaceNavigationItem = readonly [string, string, string, IconName];
export const workspaceNavigation: readonly WorkspaceNavigationItem[] = [
  ['/today', '홈', 'Home', 'home'],
  ['/explore', '기업', 'Companies', 'search'],
  ['/watchlist', '관심 기업', 'Watchlist', 'star'],
  ['/calendar', '캘린더', 'Calendar', 'calendar'],
  ['/saved', '저장', 'Saved', 'file'],
  ...(workspaceFeatures.portfolio ? [['/portfolio', '포트폴리오', 'Portfolio', 'pie'] as const] : []),
];
export const mobileWorkspaceNavigation: readonly WorkspaceNavigationItem[] = [
  ...workspaceNavigation.slice(0, 3),
  ['/more', '더 보기', 'More', 'menu'],
];

export function disabledWorkspaceRoute(path: string): boolean {
  return (!workspaceFeatures.portfolio && /^\/portfolio(?:\/|$)/.test(path)) ||
    (!workspaceFeatures.brokerage && /^\/brokerage(?:\/|$)/.test(path)) ||
    (!workspaceFeatures.competitorComparison && /^\/compare(?:\/|$)/.test(path)) ||
    (!workspaceFeatures.advancedFilters && /^\/screener(?:\/|$)/.test(path)) ||
    (!workspaceFeatures.teamPlans && /^\/teams?(?:\/|$)/.test(path));
}
