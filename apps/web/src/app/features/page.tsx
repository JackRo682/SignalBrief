import {ReferencePage} from '@/components/marketing/reference-pages';
function LegacyPage(){return <ReferencePage kind="features"/>;}

import ResearchLanding from '@/mvp/landing';
import {researchMvp} from '@/lib/release-scope';
export default function Page(){return researchMvp?<ResearchLanding featuresOnly/>:<LegacyPage/>;}
