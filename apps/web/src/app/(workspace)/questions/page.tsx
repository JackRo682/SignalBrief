import ReferenceApp from "@/reference/reference-app";
import ResponsiveScreen from '@/mobile/responsive';
import MobileQuestions from '@/mobile/questions';
export default async function Page({searchParams}:{searchParams:Promise<{event?:string}>}){const params=await searchParams;const eventId=typeof params.event==='string'?params.event:'';return <ResponsiveScreen mobile={<MobileQuestions eventId={eventId}/>} desktop={<ReferenceApp screen="chat"/>}/>;}
