import DesktopWatchlist from '@/desktop/watchlist';
import ResponsiveScreen from '@/mobile/responsive';
import MobileWatchlist from '@/mobile/watchlist';
export default function Page(){return <ResponsiveScreen mobile={<MobileWatchlist/>} desktop={<DesktopWatchlist/>}/>;}
