import type {NextRequest} from 'next/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'"};
const page=(body:string,status=200)=>new Response('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SignalBrief 이메일 수신 거부</title><main><h1>이메일 수신 거부</h1>'+body+'</main></html>',{status,headers});
const token=(req:NextRequest)=>new URL(req.url).searchParams.get('token')??'';
export async function GET(req:NextRequest){
 if(!/^[a-f0-9]{64}$/.test(token(req)))return page('<p>올바르지 않은 링크입니다.</p>',400);
 return page('<p>일반 알림과 일일 요약 이메일을 모두 중단합니다. 로그인할 필요가 없습니다.</p><form method="post"><button>이메일 수신 중단</button></form>');
}
export async function POST(req:NextRequest){
 const value=token(req);
 if(!/^[a-f0-9]{64}$/.test(value))return page('<p>올바르지 않은 링크입니다.</p>',400);
 try{
  const result=await fetch('https://xabzzhtdmqsaqdauthbu.supabase.co/functions/v1/signalbrief-notifications/unsubscribe?token='+value,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),cache:'no-store'});
  if(result.ok)return page('<p>이메일 수신을 중단했습니다. 다시 받으려면 로그인 후 알림 설정에서 켜 주세요.</p>');
  return result.status===400?page('<p>올바르지 않은 링크입니다. 알림 설정에서도 수신을 중단할 수 있습니다.</p>',400):page('<p>수신 거부를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.</p>',502);
 }catch{return page('<p>연결하지 못했습니다. 잠시 후 다시 시도해 주세요.</p>',502);}
}
