import BillingPage from '@/components/billing-page';
function LegacyPage(){return <BillingPage/>;}

import {redirect} from 'next/navigation';
import {researchMvp} from '@/lib/release-scope';
export default function Page(){if(researchMvp)redirect('/pricing');return <LegacyPage/>;}
