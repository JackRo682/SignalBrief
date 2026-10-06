import ReferenceApp from "@/reference/reference-app";
import ResponsiveScreen from '@/mobile/responsive';
import MobileAlerts from '@/mobile/alerts';
export default function Page(){return <ResponsiveScreen mobile={<MobileAlerts/>} desktop={<ReferenceApp screen="alerts"/>}/>;}
