import DesktopQuestions from '@/desktop/questions';
import ResponsiveScreen from '@/mobile/responsive';
import MobileQuestions from '@/mobile/questions';
export default async function Page({searchParams}:{searchParams:Promise<{event?:string}>}){const params=await searchParams;const eventId=typeof params.event==='string'?params.event:'';return <ResponsiveScreen mobile={<MobileQuestions eventId={eventId}/>} desktop={<DesktopQuestions eventId={eventId}/>}/>;}
