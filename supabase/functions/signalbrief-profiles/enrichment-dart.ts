import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {dartRelay} from '../signalbrief-collector/dart-relay.ts';
import {koreaDate} from '../signalbrief-collector/core.ts';
import {ProfileError,type CompanyIdentity} from './core.ts';
import {dartProfileFilings,dartPublicSource,validateDartProfileResult} from './enrichment-dart-core.ts';
import {emptyEnrichment,type ProfileTransport} from './enrichment-service.ts';
import type {ProfileArchivedSource,ProfileEnrichmentSnapshot} from './enrichment-types.ts';

type Secrets={DART_API_KEY?:string;DART_RELAY_SECRET?:string};
const digest=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const decode=(bytes:Uint8Array)=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new ProfileError('profile_source_encoding_unsupported');}};

/** Issuer-scoped official retrieval. ZIP/XML CPU work stays in the bounded Node relay. */
export async function collectDartProfileEnrichment(db:SupabaseClient,company:CompanyIdentity,legalName:string,secrets:Secrets,transport:ProfileTransport):Promise<ProfileEnrichmentSnapshot>{
 if(!/^\d{8}$/.test(company.provider_company_id)||!/^[A-Z0-9]{6}$/.test(company.ticker)||!legalName.trim())throw new ProfileError('company_identity_mismatch');
 if(!/^[a-f0-9]{40}$/i.test(secrets.DART_API_KEY??'')||!/^[a-f0-9]{64}$/.test(secrets.DART_RELAY_SECRET??''))throw new ProfileError('profile_source_unavailable');
 const now=transport.now(),today=koreaDate(now),start=koreaDate(new Date(now.getTime()-550*86400_000));
 await transport.reserve('dart');
 const list=await dartRelay({kind:'periodic_list',key:secrets.DART_API_KEY,corp_code:company.provider_company_id,bgn_de:start,end_de:today},secrets.DART_RELAY_SECRET!,10_000,transport.signal);
 const listHash=await digest(list),listPath=`dart/lists/${listHash}.json`;
 await transport.archive(listPath,list,'application/json');
 const filings=dartProfileFilings(decode(list),company,`${today.slice(0,4)}-${today.slice(4,6)}-${today.slice(6,8)}`),filing=filings[0];
 if(!filing)return {result:emptyEnrichment(company.id,now.toISOString(),'periodic_report_not_found','not_available'),archives:[]};
 const stored=await db.from('dart_filings').upsert({company_id:company.id,receipt:filing.receipt,title:filing.title,filing_date:filing.filing_date,source_url:filing.source_url,source_sha256:listHash,source_object_key:listPath,publication_precision:'date',publication_timezone:'Asia/Seoul'},{onConflict:'company_id,receipt'}).select('id').single();
 if(stored.error||typeof stored.data?.id!=='string')throw new ProfileError('profile_persistence_unavailable');
 await transport.reserve('dart');
 const bytes=await dartRelay({kind:'document',key:secrets.DART_API_KEY,receipt:filing.receipt},secrets.DART_RELAY_SECRET!,12_000,transport.signal);
 const rawHash=await digest(bytes),rawPath=`profiles/dart/${rawHash}.zip`;
 await transport.archive(rawPath,bytes,'application/zip');
 if(transport.signal.aborted)throw new ProfileError('profile_source_unavailable');
 const signed=await db.storage.from('signalbrief-raw').createSignedUrl(rawPath,60);
 if(signed.error||!signed.data?.signedUrl)throw new ProfileError('profile_archive_failed');
 const response=await dartRelay({kind:'profile_parse',source_url:signed.data.signedUrl,sha:rawHash,corp_code:company.provider_company_id,ticker:company.ticker,receipt:filing.receipt,company_name:legalName,report_name:filing.form},secrets.DART_RELAY_SECRET!,12_000,transport.signal);
 const parsed=validateDartProfileResult(decode(response),rawHash),normalized=new TextEncoder().encode(parsed.normalized_text);
 if(await digest(normalized)!==parsed.normalized_sha256)throw new ProfileError('dart_profile_parse_invalid');
 const normalizedPath=`profiles/dart/normalized/${parsed.normalized_sha256}.txt`;
 await transport.archive(normalizedPath,normalized,'text/plain; charset=utf-8');
 const source:ProfileArchivedSource={id:rawHash,provider:'OpenDART',source_url:filing.source_url,source_sha256:rawHash,fetched_at:transport.now().toISOString(),published_on:filing.filing_date,publication_precision:'date',publication_timezone:'Asia/Seoul',report_period:filing.period,form_type:filing.form,title:filing.title,normalization:parsed.normalization,normalized_sha256:parsed.normalized_sha256,object_key:rawPath,normalized_object_key:normalizedPath,filing_id:stored.data.id,provider_company_id:company.provider_company_id,ticker:company.ticker,normalized_text:parsed.normalized_text};
 const result=emptyEnrichment(company.id,transport.now().toISOString(),'business_section_unavailable','not_available');
 Object.assign(result,{business:parsed.business,products:parsed.products,segments:parsed.segments,limitations:[],last_error:null});
 if(!result.business.length)result.limitations.push('business_section_unavailable');
 if(!result.products.length)result.limitations.push('products_not_explicitly_identified');
 if(!result.segments.length)result.limitations.push('segments_not_explicitly_identified');
 if(parsed.normalization==='dart-periodic-recovered-text-v1')result.limitations.push('source_markup_recovery_requires_review');
 const used=result.business.length+result.products.length+result.segments.length>0;
 result.sources=used?[dartPublicSource(source)]:[];result.status=used?'partial':'not_available';
 result.next_refresh_at=new Date(transport.now().getTime()+(used?86400_000:3600_000)).toISOString();
 return {result,archives:used?[source]:[]};
}
