'use client';
import {ResearchDirectory,ResearchSearch,type ResearchSearchProps} from '@/workspace/research-search';
import LegacyExplore,{MobileSearchResults as LegacyResults} from './search-legacy';
import {workspaceFeatures} from '@/lib/workspace-features';
export default function MobileExplore(){return workspaceFeatures.advancedFilters?<LegacyExplore/>:<ResearchDirectory/>;}
export function MobileSearchResults(props:ResearchSearchProps){return workspaceFeatures.advancedFilters?<LegacyResults {...props}/>:<ResearchSearch {...props}/>;}
