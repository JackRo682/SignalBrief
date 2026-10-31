'use client';
import {CompanyWorkspace} from '@/components/company-workspace';
import {workspaceFeatures} from '@/lib/workspace-features';
import LegacyMobileCompany from './company-legacy';
export default function MobileCompany({id}:{id:string}){return workspaceFeatures.marketData?<LegacyMobileCompany id={id}/>:<CompanyWorkspace key={id} id={id}/>;}
