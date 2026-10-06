import Screen from "@/workspace/appearance";
import MobileAppearance from "@/mobile/appearance";
import ResponsiveScreen from "@/mobile/responsive";
export default function Page(){return <ResponsiveScreen mobile={<MobileAppearance/>} desktop={<Screen/>}/>;}
