import ReferenceApp from "@/reference/reference-app";
import ResponsiveScreen from '@/mobile/responsive';
import MobilePortfolio from '@/mobile/portfolio';
export default function Page(){return <ResponsiveScreen mobile={<MobilePortfolio/>} desktop={<ReferenceApp screen="setup"/>}/>;}
