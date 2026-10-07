"use client";
import { usePathname } from "next/navigation";
import { WorkspaceShell } from "@/workspace/ui";
import { AppShell } from "@/components/ui";
import MobileShell from '@/mobile/shell';
import {useMobileViewport} from '@/mobile/responsive';
import {DesktopShell} from '@/desktop/shell';
export default function WorkspaceLayout({children}:{children:React.ReactNode}){
 const path=usePathname();
 const mobile=useMobileViewport();
 if(mobile===null)return null;
 if(mobile&&!path.startsWith('/ops'))return <MobileShell>{children}</MobileShell>;
 const desktop = ["/today","/explore","/search","/watchlist","/timeline","/questions"].includes(path)||/^\/(companies|events|documents)\/[^/]+$/.test(path)||/^\/companies\/[^/]+\/timeline$/.test(path);
 if(desktop)return <DesktopShell>{children}</DesktopShell>;
 const workspace = ["/explore","/search","/saved","/help","/settings"].includes(path)||path.startsWith("/settings/")||/^\/(companies|documents)\/[^/]+$/.test(path);
 if(workspace)return <WorkspaceShell>{children}</WorkspaceShell>;
const reference=["/today","/watchlist","/portfolio","/onboarding","/timeline","/questions","/calendar","/alerts","/ops"].includes(path)||/^\/(companies|events)\/[^/]+$/.test(path);
 return reference||/^\/companies\/[^/]+\/timeline$/.test(path)?<>{children}</>:<AppShell>{children}</AppShell>;
}
