"use client";
import { usePathname } from "next/navigation";
import { WorkspaceShell } from "@/workspace/ui";
import { AppShell } from "@/components/ui";
import MobileShell from '@/mobile/shell';
import {useMobileViewport} from '@/mobile/responsive';
import ResearchShell from '@/research/shell';
import {disabledWorkspaceRoute} from '@/lib/workspace-features';
import WorkspaceUnavailable from '@/workspace/unavailable';
import {DesktopShell} from '@/desktop/shell';
import '@/workspace/monitoring.css';
export default function WorkspaceLayout({children}:{children:React.ReactNode}){
 const path=usePathname();
 const mobile=useMobileViewport();
 if(mobile===null)return null;
 if(path.startsWith('/ops/'))return <ResearchShell>{children}</ResearchShell>;
 if(mobile&&!path.startsWith('/ops'))return <MobileShell>{disabledWorkspaceRoute(path)?<WorkspaceUnavailable/>:children}</MobileShell>;
 const desktop = ["/today","/explore","/search","/watchlist","/timeline","/questions","/more","/calendar","/alerts","/saved","/settings","/help","/portfolio"].includes(path)||/^\/(companies|events|documents)\/[^/]+$/.test(path)||/^\/companies\/[^/]+\/timeline$/.test(path);
 if(desktop||path.startsWith("/settings/"))return <DesktopShell>{disabledWorkspaceRoute(path)?<WorkspaceUnavailable/>:['/saved','/settings','/help'].includes(path)||path.startsWith('/settings/')?<div className="ws pc-workspace-page">{children}</div>:children}</DesktopShell>;
 const workspace = ["/explore","/search","/saved","/help","/settings"].includes(path)||path.startsWith("/settings/")||/^\/(companies|documents)\/[^/]+$/.test(path);
 if(workspace)return <WorkspaceShell>{children}</WorkspaceShell>;
const reference=["/today","/watchlist","/portfolio","/onboarding","/timeline","/questions","/calendar","/alerts","/ops"].includes(path)||/^\/(companies|events)\/[^/]+$/.test(path);
 return reference||/^\/companies\/[^/]+\/timeline$/.test(path)?<>{children}</>:<AppShell>{children}</AppShell>;
}
