import ReferenceApp from "@/reference/reference-app";
import ResponsiveScreen from '@/mobile/responsive';
import MobilePortfolio from '@/mobile/portfolio';
import {workspaceFeatures} from '@/lib/workspace-features';
import WorkspaceUnavailable from '@/workspace/unavailable';
export default function Page(){return workspaceFeatures.portfolio?<ResponsiveScreen mobile={<MobilePortfolio/>} desktop={<ReferenceApp screen="setup"/>}/>:<WorkspaceUnavailable/>;}
