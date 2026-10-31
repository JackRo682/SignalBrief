import ReferenceApp from "@/reference/reference-app";
import ResponsiveScreen from '@/mobile/responsive';
import MobileCalendar from '@/mobile/calendar';
import ResearchCalendar from '@/workspace/research-calendar';
import {workspaceFeatures} from '@/lib/workspace-features';
export default function Page(){return workspaceFeatures.portfolio?<ResponsiveScreen mobile={<MobileCalendar/>} desktop={<ReferenceApp screen="calendar"/>}/>:<ResearchCalendar/>;}
