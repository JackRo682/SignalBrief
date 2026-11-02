import {ProfileError,type CompanyIdentity} from './core.ts';
import {emptyExtracted,parseOfficialLeadership,parseSecProfileCharter,parseSecProfileFiling,profileCharterLink,secProfileURL,selectProfileFilings,type ExtractedProfile,type SecProfileFiling} from './enrichment-sec.ts';
import type {ProfileArchivedSource,ProfileEnrichment,ProfileEnrichmentSnapshot,ProfileSource} from './enrichment-types.ts';

export type OfficialProfileSource={kind:'leadership_q4';source_url:string;issuer_label:string};
export type ProfileTransport={
 fetcher?:typeof fetch;
 archive:(path:string,bytes:Uint8Array,contentType:string)=>Promise<void>;
 reserve:(provider:'sec'|'dart')=>Promise<void>;
 signal:AbortSignal;
 now:()=>Date;
};
const hash=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(value=>value.toString(16).padStart(2,'0')).join('');
export const profileFailureCode=(error:unknown):string=>error instanceof ProfileError?error.code:'profile_source_unavailable';
const identityFailures=new Set(['company_identity_mismatch','profile_source_identity_missing','profile_source_url_invalid','profile_filing_identity_invalid']);

export function publicProfileSource(source:ProfileArchivedSource):ProfileSource{
 const {object_key:_,provider_company_id:__,ticker:___,normalized_text:____,...result}=source;
 void _;void __;void ___;void ____;
 return result;
}

export function emptyEnrichment(companyId:string,now:string,code:string,status:ProfileEnrichment['status']='unavailable'):ProfileEnrichment{
 return {schema:'signalbrief.company-profile.v1',company_id:companyId,status,checked_at:now,next_refresh_at:new Date(Date.parse(now)+300_000).toISOString(),sources:[],leadership:[],formation:[],business:[],products:[],segments:[],limitations:[code],last_error:status==='unavailable'?code:null};
}

/** Fixed official-origin boundary; a database-reviewed URL is still checked before transport. */
export function profileSourceURL(value:string,provider:'sec'|'dart'|'official',company:CompanyIdentity):URL{
 if(provider==='sec')return secProfileURL(value,company.provider_company_id);
 let url:URL;try{url=new URL(value);}catch{throw new ProfileError('profile_source_url_invalid');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)throw new ProfileError('profile_source_url_invalid');
 if(provider==='dart'){
  if(url.hostname!=='dart.fss.or.kr'||!['/dsaf001/main.do','/report/viewer.do'].includes(url.pathname))throw new ProfileError('profile_source_url_invalid');
 }else{
  // Add reviewed origins together with their identity-bound SQL registry rows.
  if(company.provider_company_id.padStart(10,'0')!=='0001403161'||url.href!=='https://investor.visa.com/investor-relations/corporate-governance/board-of-directors/Person-Details/')throw new ProfileError('profile_source_url_invalid');
 }
 return url;
}

export async function fetchProfileSource(url:URL,transport:ProfileTransport,headers:Record<string,string>={},limit=6_000_000):Promise<Uint8Array>{
 let response:Response;
 try{response=await (transport.fetcher??fetch)(url,{headers,redirect:'error',signal:AbortSignal.any([transport.signal,AbortSignal.timeout(10_000)])});}
 catch{throw new ProfileError('profile_source_unavailable');}
 if(!response.ok){await response.body?.cancel();throw new ProfileError(response.status===429?'profile_source_rate_limited':'profile_source_unavailable');}
 if(Number(response.headers.get('content-length')??0)>limit){await response.body?.cancel();throw new ProfileError('profile_source_too_large');}
 const reader=response.body?.getReader();if(!reader)throw new ProfileError('profile_source_empty');
 const chunks:Uint8Array[]=[];let length=0;
 try{
  while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>limit){await reader.cancel();throw new ProfileError('profile_source_too_large');}chunks.push(part.value);}
 }catch(error){if(error instanceof ProfileError)throw error;throw new ProfileError('profile_source_unavailable');}
 if(!length)throw new ProfileError('profile_source_empty');
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return bytes;
}

export async function archiveProfileHTML(bytes:Uint8Array,url:string,company:CompanyIdentity,provider:ProfileSource['provider'],published:string|null,period:string|null,form:string|null,title:string,transport:ProfileTransport):Promise<ProfileArchivedSource>{
 const sha=await hash(bytes),prefix=provider==='SEC EDGAR'?'sec':provider==='OpenDART'?'dart':'official';
 const source:ProfileArchivedSource={id:sha,provider,source_url:url,source_sha256:sha,fetched_at:transport.now().toISOString(),published_on:published,publication_precision:published?'date':'unknown',report_period:period,form_type:form,title,normalization:'profile-visible-text-v1',object_key:`profiles/${prefix}/${sha}.html`,provider_company_id:company.provider_company_id,ticker:company.ticker,normalized_text:''};
 await transport.archive(source.object_key,bytes,'text/html; charset=utf-8');
 return source;
}

function decode(bytes:Uint8Array):string{try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new ProfileError('profile_source_encoding_unsupported');}}

export async function collectSecProfileEnrichment(company:CompanyIdentity,submissions:string,legalName:string,contact:string,officialSources:OfficialProfileSource[],transport:ProfileTransport):Promise<ProfileEnrichmentSnapshot>{
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))throw new ProfileError('sec_contact_required');
 const now=transport.now().toISOString(),selected=selectProfileFilings(submissions,company,now.slice(0,10));
 const result=emptyEnrichment(company.id,now,'annual_report_unavailable','not_available');result.last_error=null;result.limitations=[];
 const archives:ProfileArchivedSource[]=[];
 const headers={'User-Agent':`SignalBrief profile/1.0 ${contact}`,Accept:'text/html'};
 const filing=async(meta:SecProfileFiling)=>{
  const url=profileSourceURL(meta.url,'sec',company);await transport.reserve('sec');
  const bytes=await fetchProfileSource(url,transport,headers),source=await archiveProfileHTML(bytes,url.href,company,'SEC EDGAR',meta.filed_on,meta.report_period,meta.form,`${meta.form} · ${meta.report_period??meta.filed_on}`,transport);
  const parsed=parseSecProfileFiling(decode(bytes),source,company);return {source,...parsed};
 };
 const annualTask=selected.annual?filing(selected.annual):Promise.resolve(null);
 const latestTask=selected.latest&&selected.latest.url!==selected.annual?.url?filing(selected.latest):Promise.resolve(null);
 const leadershipConfig=officialSources.find(source=>source.kind==='leadership_q4');
 const officialTask=leadershipConfig?(async()=>{
  const url=profileSourceURL(leadershipConfig.source_url,'official',company);
  const bytes=await fetchProfileSource(url,transport,{},500_000),source=await archiveProfileHTML(bytes,url.href,company,'Official company',null,null,null,'Official leadership',transport);
  const leadership=parseOfficialLeadership(decode(bytes),source,leadershipConfig.issuer_label);return {source,leadership};
 })():Promise.resolve(null);
 const [annual,latest,official]=await Promise.allSettled([annualTask,latestTask,officialTask]);
 for(const outcome of [annual,latest,official])if(outcome.status==='rejected'&&identityFailures.has(profileFailureCode(outcome.reason)))throw outcome.reason;
 let fields:ExtractedProfile=emptyExtracted();
 if(annual.status==='fulfilled'&&annual.value){
  archives.push(annual.value.source);fields=annual.value.fields;
  const charter=profileCharterLink(annual.value.parsed,annual.value.source.source_url,company.provider_company_id);
  if(charter){
   try{
    await transport.reserve('sec');const bytes=await fetchProfileSource(profileSourceURL(charter,'sec',company),transport,headers,1_000_000);
    const source=await archiveProfileHTML(bytes,charter,company,'SEC EDGAR',null,null,'EX-3','Certificate of incorporation',transport);
    const formation=parseSecProfileCharter(decode(bytes),source,legalName);
    if(formation.length){archives.push(source);fields.formation=formation;}
   }catch(error){if(identityFailures.has(profileFailureCode(error)))throw error;result.limitations.push('formation_source_unavailable');}
  }
 }else result.limitations.push(annual.status==='rejected'?'annual_report_unavailable':'annual_report_not_found');
 if(latest.status==='fulfilled'&&latest.value){
  archives.push(latest.value.source);
  if(latest.value.fields.leadership.length)fields.leadership=latest.value.fields.leadership;
  if(latest.value.fields.segments.length)fields.segments=latest.value.fields.segments;
 }else if(latest.status==='rejected')result.limitations.push('latest_report_unavailable');
 if(official.status==='fulfilled'&&official.value){
  archives.push(official.value.source);fields.leadership=official.value.leadership;
 }else if(official.status==='rejected')result.limitations.push('leadership_page_unavailable');
 Object.assign(result,fields);
 if(!result.business.length)result.limitations.push('business_section_unavailable');
 if(!result.products.length)result.limitations.push('products_not_explicitly_identified');
 if(!result.segments.length)result.limitations.push('segments_not_explicitly_identified');
 if(!result.leadership.length)result.limitations.push('leadership_not_verified');
 else if(result.leadership.some(leader=>leader.basis==='filing'))result.limitations.push('leadership_as_of_filing');
 if(!result.formation.length)result.limitations.push('formation_date_not_verified');
 const used=new Set([...result.business,...result.products,...result.segments,...result.leadership,...result.formation].map(item=>item.evidence.source_id));
 const relevant=archives.filter(source=>used.has(source.id));
 result.sources=relevant.map(publicProfileSource);
 if(!relevant.length&&[annual,latest,official].some(outcome=>outcome.status==='rejected'))throw new ProfileError('profile_source_unavailable');
 result.status=!relevant.length?'not_available':result.business.length&&result.products.length&&result.segments.length&&result.leadership.length&&result.formation.length?'ready':'partial';
 result.next_refresh_at=new Date(Date.parse(now)+(result.status==='not_available'?3600_000:86400_000)).toISOString();
 result.limitations=[...new Set(result.limitations)];
 return {result,archives:relevant};
}
