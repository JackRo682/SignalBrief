import {DesktopTimeline} from '@/desktop/research';
import ResponsiveScreen from '@/mobile/responsive';
import MobileTimeline from '@/mobile/timeline';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <ResponsiveScreen mobile={<MobileTimeline id={id}/>} desktop={<DesktopTimeline companyId={id}/>}/>;}
