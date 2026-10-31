import ReferenceApp from "@/reference/reference-app";
import ResponsiveScreen from '@/mobile/responsive';
import MobileOnboarding from '@/mobile/onboarding';
function LegacyPage(){return <ResponsiveScreen mobile={<MobileOnboarding/>} desktop={<ReferenceApp screen="onboarding"/>}/>;}

import {researchMvp} from '@/lib/release-scope';
import ResearchOnboarding from '@/mvp/onboarding';
export default function Page(){return researchMvp?<ResearchOnboarding/>:<LegacyPage/>;}
