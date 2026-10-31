import {ReferencePage} from '@/components/marketing/reference-pages';
function LegacyPage(){return <ReferencePage kind="home"/>;}

import ResearchLanding from '@/mvp/landing';
import {researchMvp} from '@/lib/release-scope';
export default function Page(){return researchMvp?<ResearchLanding />:<LegacyPage/>;}
