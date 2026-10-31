import ReferenceApp from "@/reference/reference-app";
import ResponsiveScreen from '@/mobile/responsive';
import MobileOnboarding from '@/mobile/onboarding';
import ResearchOnboarding from '@/workspace/research-onboarding';
import {workspaceFeatures} from '@/lib/workspace-features';
export default function Page(){return workspaceFeatures.portfolio?<ResponsiveScreen mobile={<MobileOnboarding/>} desktop={<ReferenceApp screen="onboarding"/>}/>:<ResearchOnboarding/>;}
