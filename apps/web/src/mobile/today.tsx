'use client';
import {SignedInHome} from '@/components/signed-in-home';
import {workspaceFeatures} from '@/lib/workspace-features';
import LegacyMobileToday from './today-legacy';
export default function MobileToday(){return workspaceFeatures.marketData?<LegacyMobileToday/>:<SignedInHome mobile/>;}
