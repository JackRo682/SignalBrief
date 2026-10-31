import {DesktopExplore} from '@/desktop/search';
import ResponsiveScreen from '@/mobile/responsive';
import MobileExplore from '@/mobile/search';
function LegacyPage(){return <ResponsiveScreen mobile={<MobileExplore/>} desktop={<DesktopExplore/>}/>;}

import {researchMvp} from '@/lib/release-scope';
import {ResearchExplore} from '@/mvp/screens';
import {Suspense} from 'react';
export default function Page(){return researchMvp?<Suspense><ResearchExplore/></Suspense>:<LegacyPage/>;}
