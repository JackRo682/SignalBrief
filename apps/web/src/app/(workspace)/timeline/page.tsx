import ReferenceApp from "@/reference/reference-app";
import ResponsiveScreen from '@/mobile/responsive';
import MobileTimeline from '@/mobile/timeline';
export default function Page(){return <ResponsiveScreen mobile={<MobileTimeline/>} desktop={<ReferenceApp screen="timeline"/>}/>;}
