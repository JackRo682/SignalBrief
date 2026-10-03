"use client";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/ui";
export default function WorkspaceLayout({children}:{children:React.ReactNode}){
 const path=usePathname();const reference=["/today","/watchlist","/portfolio","/onboarding","/timeline","/questions","/calendar","/alerts","/ops"].includes(path)||/^\/(companies|events)\/[^/]+$/.test(path);
 return reference?<>{children}</>:<AppShell>{children}</AppShell>;
}
