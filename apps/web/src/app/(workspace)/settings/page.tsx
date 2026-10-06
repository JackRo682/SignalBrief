import Screen from "@/workspace/account";
import ResponsiveScreen from '@/mobile/responsive';
import MobileSettings from '@/mobile/settings';
export default function Page(){return <ResponsiveScreen mobile={<MobileSettings/>} desktop={<Screen/>}/>;}
