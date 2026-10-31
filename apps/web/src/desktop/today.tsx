'use client';
import {SignedInHome} from '@/components/signed-in-home';
import {workspaceFeatures} from '@/lib/workspace-features';
import {DesktopToday as LegacyDesktopToday} from './today-legacy';
export function DesktopToday(){return workspaceFeatures.marketData?<LegacyDesktopToday/>:<SignedInHome/>;}
