import {DesktopCompany} from '@/desktop/research';
import ResponsiveScreen from '@/mobile/responsive';
import MobileCompany from '@/mobile/company';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <ResponsiveScreen mobile={<MobileCompany id={id}/>} desktop={<DesktopCompany id={id}/>}/>;}
