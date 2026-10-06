import Screen from "@/workspace/help";
import ResponsiveScreen from '@/mobile/responsive';
import MobileHelp from '@/mobile/help';
export default async function Page({searchParams}:{searchParams:Promise<{category?:string}>}){const p=await searchParams;return <ResponsiveScreen mobile={<MobileHelp initialCategory={p.category??''}/>} desktop={<Screen initialCategory={p.category??''}/>}/>;}
