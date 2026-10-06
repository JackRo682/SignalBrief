import ReferenceApp from "@/reference/reference-app";
import ResponsiveScreen from '@/mobile/responsive';
import MobileEvent from '@/mobile/event';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <ResponsiveScreen mobile={<MobileEvent id={id}/>} desktop={<ReferenceApp screen="detail" id={id}/>}/>;}
