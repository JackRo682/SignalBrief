import Screen from "@/workspace/saved";
import ResponsiveScreen from '@/mobile/responsive';
import MobileSaved from '@/mobile/saved';
export default function Page(){return <ResponsiveScreen mobile={<MobileSaved/>} desktop={<Screen/>}/>;}
