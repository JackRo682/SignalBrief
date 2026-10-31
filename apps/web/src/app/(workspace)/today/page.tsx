import {KoreanNews} from '@/components/korean-news';
import {DesktopToday} from '@/desktop/today';
import ResponsiveScreen from '@/mobile/responsive';
import MobileToday from '@/mobile/today';
import {workspaceFeatures} from '@/lib/workspace-features';
export default function Page(){return <><ResponsiveScreen mobile={<MobileToday/>} desktop={<DesktopToday/>}/>{workspaceFeatures.marketData&&<KoreanNews/>}</>;}
