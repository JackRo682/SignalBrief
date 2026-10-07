import {DesktopEvent} from '@/desktop/research';
import ResponsiveScreen from '@/mobile/responsive';
import MobileEvent from '@/mobile/event';
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{panel?:string}>}){const [{id},{panel}]=await Promise.all([params,searchParams]);return <ResponsiveScreen mobile={<MobileEvent id={id}/>} desktop={<DesktopEvent id={id} panel={typeof panel==='string'?panel:undefined}/>}/>;}
