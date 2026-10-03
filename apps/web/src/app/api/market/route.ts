import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
export const dynamic="force-dynamic";
const quote=z.object({symbol:z.string().max(32),price:z.number().finite().nonnegative(),currency:z.string().regex(/^[A-Z]{3}$/),change_pct:z.number().finite().nullable().optional(),as_of:z.string().datetime(),source:z.string().min(1).max(200),history:z.array(z.union([z.number().finite(),z.object({close:z.number().finite()})])).max(4000).optional()});
const output=z.object({quotes:z.array(quote).max(40)});
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
export async function GET(req:NextRequest){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,token=req.headers.get("authorization")?.replace(/^Bearer /,"");
 if(!url||!key)return reply({error:{code:"supabase_configuration_missing"}},503);
 if(!token)return reply({error:{code:"authentication_required"}},401);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
 const verified=await db.auth.getUser();if(verified.error||!verified.data.user)return reply({error:{code:"invalid_session"}},401);
 const symbols=(req.nextUrl.searchParams.get("symbols")??"").split(",").filter(Boolean),period=req.nextUrl.searchParams.get("period")??"6m";
 if(symbols.length>40||symbols.some(s=>! /^[A-Za-z0-9.:-]{1,32}$/.test(s))||!["1d","1w","1m","3m","6m","1y","3y","all"].includes(period))return reply({error:{code:"invalid_market_query"}},422);
 const gateway=process.env.SIGNALBRIEF_MARKET_API_URL;
 if(!gateway)return reply({quotes:[],available:false,reason:"licensed_market_provider_not_configured"});
 try{
  const endpoint=new URL(gateway);if(endpoint.protocol!=="https:"||endpoint.username||endpoint.password||endpoint.port)throw new Error("invalid_gateway");
  endpoint.searchParams.set("symbols",symbols.join(","));endpoint.searchParams.set("period",period);
  const response=await fetch(endpoint,{redirect:"error",cache:"no-store",headers:{Accept:"application/json",...(process.env.SIGNALBRIEF_MARKET_API_KEY?{Authorization:`Bearer ${process.env.SIGNALBRIEF_MARKET_API_KEY}`}:{})},signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error("provider_error");
  if(Number(response.headers.get("content-length")??0)>1_000_000)throw new Error("response_too_large");
  const text=await response.text();if(text.length>1_000_000)throw new Error("response_too_large");
  const parsed=output.parse(JSON.parse(text));return reply({...parsed,quotes:parsed.quotes.filter(q=>symbols.includes(q.symbol)),available:true});
 }catch{return reply({quotes:[],available:false,reason:"market_provider_unavailable"});}
}
