import ReferenceApp from "@/reference/reference-app";
import ResponsiveScreen from '@/mobile/responsive';
import MobileAlerts from '@/mobile/alerts';
import ContentAlerts from '@/workspace/content-alerts';
import {workspaceFeatures} from '@/lib/workspace-features';
export default function Page(){return workspaceFeatures.portfolio?<ResponsiveScreen mobile={<MobileAlerts/>} desktop={<ReferenceApp screen="alerts"/>}/>:<ContentAlerts/>;}
