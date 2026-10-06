import ReferenceApp from "@/reference/reference-app";
import ResponsiveScreen from '@/mobile/responsive';
import MobileOnboarding from '@/mobile/onboarding';
export default function Page(){return <ResponsiveScreen mobile={<MobileOnboarding/>} desktop={<ReferenceApp screen="onboarding"/>}/>;}
