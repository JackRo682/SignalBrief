'use client';
import Monitoring from '@/workspace/monitoring';
import LegacyWatchlist from './watchlist-legacy';
import {workspaceFeatures} from '@/lib/workspace-features';
export default function MobileWatchlist(){return workspaceFeatures.marketData?<LegacyWatchlist/>:<Monitoring/>;}
