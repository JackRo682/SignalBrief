import {DesktopTimeline} from '@/desktop/research';
import ResponsiveScreen from '@/mobile/responsive';
import MobileTimeline from '@/mobile/timeline';
export default function Page(){return <ResponsiveScreen mobile={<MobileTimeline/>} desktop={<DesktopTimeline/>}/>;}
