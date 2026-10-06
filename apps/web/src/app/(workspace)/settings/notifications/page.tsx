import Screen from '@/workspace/notifications';
import ResponsiveScreen from '@/mobile/responsive';
import MobileNotifications from '@/mobile/notifications';
export default function Page(){return <ResponsiveScreen mobile={<MobileNotifications/>} desktop={<Screen/>}/>;}
