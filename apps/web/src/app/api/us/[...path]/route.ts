import type {NextRequest} from "next/server";
import {proxyUS} from "@/server/us-proxy";
export const runtime="nodejs";export const dynamic="force-dynamic";
async function route(req:NextRequest,c:{params:Promise<{path:string[]}>}){const {path}=await c.params;return proxyUS(req,path.join('/'));}
export {route as GET,route as POST};
