import Screen from "@/workspace/account";
import ResponsiveScreen from '@/mobile/responsive';
import MobileAccount from '@/mobile/account';
export default function Page(){return <ResponsiveScreen mobile={<MobileAccount/>} desktop={<Screen/>}/>;}
