import ReferenceApp from "@/reference/reference-app";
import ResponsiveScreen from '@/mobile/responsive';
import MobileWatchlist from '@/mobile/watchlist';
export default function Page(){return <ResponsiveScreen mobile={<MobileWatchlist/>} desktop={<ReferenceApp screen="setup"/>}/>;}
