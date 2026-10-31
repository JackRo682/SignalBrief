import {KoreanNews} from '@/components/korean-news';
import {DesktopToday} from '@/desktop/today';
import ResponsiveScreen from '@/mobile/responsive';
import MobileToday from '@/mobile/today';
function LegacyPage(){return <><ResponsiveScreen mobile={<MobileToday/>} desktop={<DesktopToday/>}/><KoreanNews/></>;}

import {researchMvp} from '@/lib/release-scope';
import {ResearchHome} from '@/mvp/screens';
import {Suspense} from 'react';
export default function Page(){return researchMvp?<Suspense><ResearchHome/></Suspense>:<LegacyPage/>;}
