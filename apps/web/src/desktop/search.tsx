'use client';
import {ResearchDirectory,ResearchSearch,type ResearchSearchProps} from '@/workspace/research-search';
import {DesktopExplore as LegacyExplore,DesktopSearchResults as LegacyResults} from './search-legacy';
import {workspaceFeatures} from '@/lib/workspace-features';
export function DesktopExplore(){return workspaceFeatures.advancedFilters?<LegacyExplore/>:<ResearchDirectory/>;}
export function DesktopSearchResults(props:ResearchSearchProps){return workspaceFeatures.advancedFilters?<LegacyResults {...props}/>:<ResearchSearch {...props}/>;}
