import { createClient, type SupabaseClient } from "@supabase/supabase-js";
let client:SupabaseClient|null = null;
export function getSupabase():SupabaseClient {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Google 로그인을 사용하려면 Supabase 공개 URL과 공개 anon/publishable key가 필요합니다.");
  client ??= createClient(url,key,{auth:{flowType:"pkce",autoRefreshToken:true,persistSession:true,detectSessionInUrl:false}});
  return client;
}
