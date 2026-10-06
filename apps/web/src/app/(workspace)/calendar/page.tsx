import ReferenceApp from "@/reference/reference-app";
import ResponsiveScreen from '@/mobile/responsive';
import MobileCalendar from '@/mobile/calendar';
export default function Page(){return <ResponsiveScreen mobile={<MobileCalendar/>} desktop={<ReferenceApp screen="calendar"/>}/>;}
