import ReferenceApp from "@/reference/reference-app";
import ResponsiveScreen from '@/mobile/responsive';
import MobileToday from '@/mobile/today';
export default function Page(){return <ResponsiveScreen mobile={<MobileToday/>} desktop={<ReferenceApp screen="today"/>}/>;}
