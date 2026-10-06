import Screen from "@/workspace/security";
import ResponsiveScreen from '@/mobile/responsive';
import MobileSecurity from '@/mobile/security';
export default function Page(){return <ResponsiveScreen mobile={<MobileSecurity/>} desktop={<Screen/>}/>;}
