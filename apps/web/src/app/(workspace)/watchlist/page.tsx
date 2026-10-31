import DesktopWatchlist from '@/desktop/watchlist';
import ResponsiveScreen from '@/mobile/responsive';
import MobileWatchlist from '@/mobile/watchlist';
function LegacyPage(){return <ResponsiveScreen mobile={<MobileWatchlist/>} desktop={<DesktopWatchlist/>}/>;}

import {researchMvp} from '@/lib/release-scope';
import {ResearchWatchlist} from '@/mvp/screens';
import {Suspense} from 'react';
export default function Page(){return researchMvp?<Suspense><ResearchWatchlist/></Suspense>:<LegacyPage/>;}
