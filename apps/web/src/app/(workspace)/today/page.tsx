import {DesktopToday} from '@/desktop/today';
import ResponsiveScreen from '@/mobile/responsive';
import MobileToday from '@/mobile/today';
export default function Page(){return <ResponsiveScreen mobile={<MobileToday/>} desktop={<DesktopToday/>}/>;}
