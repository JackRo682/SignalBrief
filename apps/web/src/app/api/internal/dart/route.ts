import {createClient} from '@supabase/supabase-js';
import {verifyRelay,dartEndpoint,downloadDart} from '@/server/dart-relay';
import {directorySourceUrl,parseArchivedDartDirectory} from '@/server/dart-directory-archive';
import {profileArchiveURL,parseArchivedDartProfile} from '@/server/dart-profile-archive';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=35;
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const diagnosticCodes=new Set(['directory_invalid_archive','directory_hash_mismatch','directory_invalid_xml','invalid_dart_directory','incomplete_official_directory','directory_response_too_large','directory_download_failed','directory_download_too_large','dart_profile_invalid_archive','dart_profile_hash_mismatch','dart_profile_receipt_member_missing','dart_profile_markup_unsupported','dart_profile_identity_mismatch','dart_profile_encoding_unsupported','dart_profile_archive_unavailable','dart_profile_source_too_large']);
export async function POST(req:Request):Promise<Response>{
 let authorizedOperation:string|undefined;
 try{
  if(Number(req.headers.get('content-length')??0)>4096)return Response.json({error:'body_too_large'},{status:413,headers});
  const reader=req.body?.getReader();let count=0;const chunks:Uint8Array[]=[];
  if(reader)while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>4096){await reader.cancel();return Response.json({error:'body_too_large'},{status:413,headers});}chunks.push(value);}
  const body=Buffer.concat(chunks).toString('utf8'),timestamp=req.headers.get('x-sb-timestamp')??'',signature=req.headers.get('x-sb-signature')??'';
  const payload=verifyRelay(body,timestamp,signature,process.env.DART_RELAY_SECRET??'');
  if(payload.kind==='directory_parse')directorySourceUrl(payload,process.env.NEXT_PUBLIC_SUPABASE_URL??'');
  if(payload.kind==='profile_parse')profileArchiveURL(payload,process.env.NEXT_PUBLIC_SUPABASE_URL??'');
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const claim=await db.rpc('sb_dart_relay_claim',{body_text:body,request_timestamp:timestamp,signature});
  if(claim.error||claim.data!==true)return Response.json({error:'relay_unauthorized'},{status:401,headers});
  authorizedOperation=payload.kind;
  if(payload.kind==='directory_parse')return Response.json(await parseArchivedDartDirectory(payload,process.env.NEXT_PUBLIC_SUPABASE_URL??''),{headers});
  if(payload.kind==='profile_parse')return Response.json(await parseArchivedDartProfile(payload,process.env.NEXT_PUBLIC_SUPABASE_URL??''),{headers});
  const result=await downloadDart(dartEndpoint(payload),payload.kind==='company'?128_000:['list','periodic_list','financials'].includes(payload.kind)?2_000_000:20_000_000);
  return new Response(new Uint8Array(result.bytes),{headers:{...headers,'Content-Type':result.type}});
 }catch(error){
  const code=error instanceof Error?error.message:'';
  if(authorizedOperation)console.error('DART_RELAY_FAILURE',{operation:authorizedOperation,code:diagnosticCodes.has(code)?code:'provider_unavailable'});
  return Response.json({error:code==='relay_unauthorized'?'relay_unauthorized':code==='relay_invalid_request'?'relay_invalid_request':'dart_relay_failed'},{status:code==='relay_unauthorized'?401:code==='relay_invalid_request'?422:502,headers});
 }
}
