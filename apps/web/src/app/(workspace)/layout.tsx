"use client";
import { usePathname } from "next/navigation";
import { WorkspaceShell } from "@/workspace/ui";
import { AppShell } from "@/components/ui";
export default function WorkspaceLayout({children}:{children:React.ReactNode}){
 const path=usePathname();
 const workspace = ["/explore","/search","/saved","/help","/settings"].includes(path)||path.startsWith("/settings/")||/^\/(companies|documents)\/[^/]+$/.test(path);
 if(workspace)return <WorkspaceShell>{children}</WorkspaceShell>;
const reference=["/today","/watchlist","/portfolio","/onboarding","/timeline","/questions","/calendar","/alerts","/ops"].includes(path)||/^\/(companies|events)\/[^/]+$/.test(path);
 return reference||/^\/companies\/[^/]+\/timeline$/.test(path)?<>{children}</>:<AppShell>{children}</AppShell>;
}
