import ReferenceApp from "@/reference/reference-app";
import ResponsiveScreen from '@/mobile/responsive';
import MobilePortfolio from '@/mobile/portfolio';
function LegacyPage(){return <ResponsiveScreen mobile={<MobilePortfolio/>} desktop={<ReferenceApp screen="setup"/>}/>;}

import {redirect} from 'next/navigation';
import {researchMvp} from '@/lib/release-scope';
export default function Page(){if(researchMvp)redirect('/watchlist');return <LegacyPage/>;}
