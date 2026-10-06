import Screen from "@/workspace/search";
import ResponsiveScreen from '@/mobile/responsive';
import MobileExplore from '@/mobile/search';
export default function Page(){return <ResponsiveScreen mobile={<MobileExplore/>} desktop={<Screen/>}/>;}
