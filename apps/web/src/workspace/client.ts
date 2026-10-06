import {z} from 'zod';
import {type WorkspaceRequest,workspaceRequest} from './contracts';
export async function workspace<T>(token:string|null,req:WorkspaceRequest,schema:z.ZodType<T>,signal?:AbortSignal):Promise<T>{
 if(!token)throw new Error('로그인이 필요합니다.');
 const valid=workspaceRequest.parse(req);
 const response=await fetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(valid),cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});
 const data:unknown=await response.json().catch(()=>null);
 if(!response.ok){if(response.status===401)window.dispatchEvent(new Event('signalbrief:unauthorized'));
  const code=z.object({error:z.object({code:z.string()})}).safeParse(data);const key=code.success?code.data.error.code:'';
  if(response.status===403&&key==='mfa_required')window.dispatchEvent(new Event('signalbrief:mfa-required'));
  throw new Error(key==='version_conflict'?'다른 화면에서 설정이 변경되었습니다. 새로고침 후 다시 시도해 주세요.':key==='resource_not_available'?'이 자료는 더 이상 공개되지 않습니다.':response.status===401?'로그인이 만료되었습니다. 다시 로그인해 주세요.':response.status===429?'요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.':response.status===503?'서비스 업데이트를 준비 중입니다. 잠시 후 다시 시도해 주세요.':'요청을 완료하지 못했습니다. 다시 시도해 주세요.');}
 return schema.parse(data);
}
export function downloadJSON(data:unknown,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function validateAttachment(file:File){
 if(file.size<1||file.size>5*1024*1024)throw new Error('첨부파일은 5MB 이하로 선택해 주세요.');
 const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());
 const type=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'?'image/webp':String.fromCharCode(...bytes.slice(0,5))==='%PDF-'?'application/pdf':null;
 if(!type||file.type!==type)throw new Error('PNG, JPEG, WebP, PDF 파일만 첨부할 수 있습니다.');return {mime:type as 'image/png'|'image/jpeg'|'image/webp'|'application/pdf',extension:{'image/png':'png','image/jpeg':'jpg','image/webp':'webp','application/pdf':'pdf'}[type]};
}
