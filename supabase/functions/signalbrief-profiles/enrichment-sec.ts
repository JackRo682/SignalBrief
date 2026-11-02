import {ProfileError,type CompanyIdentity} from './core.ts';
import {parseProfileHTML,type ProfileHTML,type ProfileBlock} from './enrichment-html.ts';
import type {ProfileArchivedSource,ProfileBusinessExcerpt,ProfileBusinessItem,ProfileEvidence,ProfileFormation,ProfileLeadership} from './enrichment-types.ts';

export type SecProfileFiling={accession:string;form:string;filed_on:string;report_period:string|null;url:string};
export type ExtractedProfile={business:ProfileBusinessExcerpt[];products:ProfileBusinessItem[];segments:ProfileBusinessItem[];leadership:ProfileLeadership[];formation:ProfileFormation[]};
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const day=(value:unknown):value is `${number}-${number}-${number}`=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const normalizedName=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
const completeHTML=(html:string)=>/<\/html>\s*$/i.test(html)||/^\s*<DOCUMENT>\s*<TYPE>/i.test(html)&&/<\/html>\s*<\/TEXT>\s*<\/DOCUMENT>\s*$/i.test(html);
export const emptyExtracted=():ExtractedProfile=>({business:[],products:[],segments:[],leadership:[],formation:[]});

/** Parse the complete submissions recent array, not the unrelated first-30 display limit. */
export function selectProfileFilings(raw:string,company:CompanyIdentity,today:string):{annual:SecProfileFiling|null;latest:SecProfileFiling|null}{
 let input:unknown;try{input=JSON.parse(raw);}catch{throw new ProfileError('invalid_provider_response');}
 if(!record(input)||String(input.cik??'').padStart(10,'0')!==company.provider_company_id.padStart(10,'0')||!Array.isArray(input.tickers)||!input.tickers.includes(company.ticker))throw new ProfileError('company_identity_mismatch');
 if(!record(input.filings)||!record(input.filings.recent))return {annual:null,latest:null};
 const recent=input.filings.recent,keys=['accessionNumber','form','filingDate','primaryDocument','reportDate'];
 const count=Array.isArray(recent.accessionNumber)?recent.accessionNumber.length:0;
 if(count>2000||keys.some(key=>!Array.isArray(recent[key])||(recent[key] as unknown[]).length!==count))throw new ProfileError('profile_filing_list_incomplete');
 const filings:SecProfileFiling[]=[];
 for(let index=0;index<count;index++){
  const [accession,form,filed,document,report]=keys.map(key=>(recent[key] as unknown[])[index]);
  if(typeof form!=='string'||!['10-K','10-K/A','10-Q','10-Q/A','20-F','20-F/A','40-F','40-F/A'].includes(form))continue;
  if(typeof accession!=='string'||!/^\d{10}-\d{2}-\d{6}$/.test(accession)||typeof document!=='string'||!/^[A-Za-z0-9_.-]+\.html?$/i.test(document)||!day(filed)||filed>today||report!==''&&!day(report))throw new ProfileError('profile_filing_identity_invalid');
  filings.push({accession,form,filed_on:filed,report_period:day(report)?report:null,url:`https://www.sec.gov/Archives/edgar/data/${Number(company.provider_company_id)}/${accession.replaceAll('-','')}/${document}`});
 }
 filings.sort((a,b)=>b.filed_on.localeCompare(a.filed_on)||b.accession.localeCompare(a.accession));
 const earliest=new Date(today+'T00:00:00Z');earliest.setUTCDate(earliest.getUTCDate()-550);
 const fresh=filings.filter(filing=>filing.filed_on>=earliest.toISOString().slice(0,10));
 return {annual:fresh.find(filing=>/^(?:10-K|20-F|40-F)(?:\/A)?$/.test(filing.form))??null,latest:fresh[0]??null};
}

export function secProfileURL(value:string,cik:string):URL{
 let url:URL;try{url=new URL(value);}catch{throw new ProfileError('profile_source_url_invalid');}
 if(url.protocol!=='https:'||url.hostname!=='www.sec.gov'||url.username||url.password||url.port||url.search||url.hash||!new RegExp('^/Archives/edgar/data/'+Number(cik)+'/[0-9]{18}/[A-Za-z0-9_.-]+\\.html?$','i').test(url.pathname))throw new ProfileError('profile_source_url_invalid');
 return url;
}

export function profileEvidence(source:ProfileArchivedSource,start:number,end:number,section:string):ProfileEvidence{
 const quote=source.normalized_text.slice(start,end);
 if(!quote.trim()||quote.length>1600)throw new ProfileError('profile_evidence_invalid');
 // Unicode code-point positions, matching PostgreSQL substring; not UTF-16 indices.
 const offset=Array.from(source.normalized_text.slice(0,start)).length;
 return {source_id:source.id,quote,location:{kind:'normalized_text',start:offset,end:offset+Array.from(quote).length,section}};
}

function evidenceForBlock(source:ProfileArchivedSource,block:ProfileBlock,section:string):ProfileEvidence{
 return profileEvidence(source,block.start,block.end,section);
}

function excerpt(source:ProfileArchivedSource,block:ProfileBlock,section:string):ProfileBusinessExcerpt|null{
 if(block.text.length<65||block.text.length>1600)return null;
 return {text:block.text,evidence:evidenceForBlock(source,block,section)};
}

function paragraphSentence(source:ProfileArchivedSource,block:ProfileBlock,pattern:RegExp,section:string):ProfileEvidence|null{
 const matches=[...block.text.matchAll(/[^.!?]+(?:[.!?](?=\s|$)|$)/g)];
 const sentence=matches.find(match=>pattern.test(match[0]));if(!sentence)return null;
 const left=sentence[0].length-sentence[0].trimStart().length;
 return profileEvidence(source,block.start+(sentence.index??0)+left,block.start+(sentence.index??0)+sentence[0].trimEnd().length,section);
}

function businessBounds(parsed:ProfileHTML):[number,number]|null{
 const starts=parsed.blocks.map((block,index)=>({block,index})).filter(({block})=>/^item\s*1\s*[.:-]?\s*business$/i.test(block.text));
 // A contents entry is not the section itself. Require a substantial section and a following Item boundary.
 for(const {index} of starts.reverse()){
  const end=parsed.blocks.findIndex((block,i)=>i>index&&/^item\s*(?:1a|1b|1c|2)\s*[.:-]?\s*\D/i.test(block.text));
  if(end>index+3&&parsed.blocks[end].start-parsed.blocks[index].end>200)return [index+1,end];
 }
 return null;
}

function extractBusiness(parsed:ProfileHTML,source:ProfileArchivedSource,result:ExtractedProfile):void{
 const bounds=businessBounds(parsed);if(!bounds)return;
 const blocks=parsed.blocks.slice(...bounds);
 for(const block of blocks.slice(0,14)){
  if(block.heading||/^(?:table of contents|\d+|overview|general)$/i.test(block.text))continue;
  const item=excerpt(source,block,'Item 1. Business');if(item)result.business.push(item);
  if(result.business.length===2)break;
 }
 let productSection=false;
 for(let index=0;index<blocks.length&&result.products.length<10;index++){
  const block=blocks[index];
  if(block.heading&&/\b(?:products?|services?|solutions?|offerings?)\b/i.test(block.text)&&!/\b(?:revenue|income|expenses?|costs?|risks?|strategy|competition)\b/i.test(block.text)){
   productSection=true;
   const next=blocks.slice(index+1,index+5).find(candidate=>!candidate.heading&&candidate.text.length>=65&&!/^\(?\d+\)?(?:\s|$)/.test(candidate.text));
   if(next&&next.text.length<=1300&&!/^(?:(?:our|core|principal|main|key)\s+)?products?(?:\s+and\s+services?)?$/i.test(block.text)&&block.text.length<=100){
    const quote=source.normalized_text.slice(block.start,next.end);
    if(quote.length<=1600)result.products.push({name:block.text,description:next.text,evidence:profileEvidence(source,block.start,next.end,'Item 1. Business — products/services')});
   }
   continue;
  }
  if(block.heading&&!/^(?:table of contents|\d+)$/i.test(block.text)&&!/^consumer payments$/i.test(block.text))productSection=false;
  if(!productSection||block.text.length>1600)continue;
  const named=block.text.match(/^([\p{L}\p{N}][\p{L}\p{N}\s&+®™(),/-]{1,85}):\s+(.{45,})$/u);
  if(named&&!/^(?:our|we|the company|this|these|such)\b|\b(?:strategy|revenue|income|expenses?|risks?|areas of focus)\b/i.test(named[1])&&!result.products.some(item=>item.name===named[1]))result.products.push({name:named[1],description:named[2],evidence:evidenceForBlock(source,block,'Item 1. Business — products/services')});
 }
}

function extractSegments(parsed:ProfileHTML,source:ProfileArchivedSource,result:ExtractedProfile):void{
 for(let index=0;index<parsed.blocks.length&&result.segments.length<12;index++){
  const block=parsed.blocks[index];
  if(!/\b(?:reportable|operating) segments?\b/i.test(block.text)||block.text.length>1600)continue;
  if(/(?:accounting standards update|disclosure requirements|standard also)/i.test(block.text))continue;
  const single=block.text.match(/\b(?:has|have|operate(?:s)?(?:\s+in|\s+as)?)\s+(?:one|a single|single)\s+(?:reportable|operating)\s+segment\s*[,.:—-]\s*([A-Z][A-Za-z0-9 &/-]{1,80})(?:[.;]|$)/);
  if(single){
   const proof=paragraphSentence(source,block,/\b(?:one|single)\s+(?:reportable|operating)\s+segment\b/i,'Reportable segment disclosure');
   if(proof)result.segments.push({name:single[1].trim(),description:proof.quote,evidence:proof});
   continue;
  }
  const enumerated=block.text.match(/\b(?:reportable|operating)\s+segments?(?:\s+(?:are|include|consist of)\s*[:—-]?\s*|\s*[:—-]\s*)([^.;]{4,250})[.;]/i);
  if(enumerated){
   const names=enumerated[1].split(/,\s*|;\s*|\s+and\s+/).map(value=>value.trim()).filter(Boolean);
   if(names.length<2||names.length>12||names.some(name=>!/^[A-Z][A-Za-z0-9 &()/.-]{1,80}$/.test(name)))continue;
   const proof=paragraphSentence(source,block,/\b(?:reportable|operating)\s+segments?\b/i,'Reportable segment disclosure');
   if(proof)for(const name of names)if(!result.segments.some(item=>item.name===name))result.segments.push({name,description:proof.quote,evidence:proof});
  }
 }
}

function extractLeadership(parsed:ProfileHTML,source:ProfileArchivedSource,result:ExtractedProfile):void{
 if(!source.published_on)return;
 const signatureStart=parsed.blocks.findLastIndex(block=>/^signatures$/i.test(block.text));
 if(signatureStart<0)return;
 const blocks=parsed.blocks.slice(signatureStart+1);
 for(let index=0;index<blocks.length;index++){
  const block=blocks[index];if(!/\bchief executive officer\b/i.test(block.text))continue;
  const roles=block.text.replace(/^Title:\s*/i,'').split(/\s*(?:,|\band\b|&|\(|\))\s*/i).filter(Boolean);
  if(!roles.length||roles.some(role=>!/^(?:chief executive officer|principal executive officer|president|chairman|chairwoman|chairperson|director)$/i.test(role)))continue;
  const region=blocks.slice(Math.max(0,index-3),index+2);
  const person=region.map(candidate=>candidate.text.match(/^(?:By:\s*)?\/s\/\s*([A-Z][A-Za-z .,'’\-]{2,100})$/)?.[1]??candidate.text.match(/^Name:\s*([A-Z][A-Za-z .,'’\-]{2,100})$/)?.[1]).filter((name):name is string=>Boolean(name));
  const unique=[...new Set(person.map(name=>name.trim()))];if(unique.length!==1)continue;
  const start=region[0].start,end=region.at(-1)!.end;if(end-start>1600)continue;
  result.leadership.push({name:unique[0],role:'Chief Executive Officer',as_of:source.published_on,basis:'filing',evidence:profileEvidence(source,start,end,'Signatures')});break;
 }
}

const months:Record<string,string>={january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12'};
export function extractProfileFormation(parsed:ProfileHTML,source:ProfileArchivedSource,issuerNames=parsed.registrants,verifiedCharter=false):ProfileFormation[]{
 const result:ProfileFormation[]=[];
 const month='(January|February|March|April|May|June|July|August|September|October|November|December)';
 for(const block of parsed.blocks){
  if(block.text.length>1600)continue;
  const original=verifiedCharter?block.text.match(new RegExp('original Certificate of Incorporation[^.]{0,180}?(?:filed|incorporated)[^.]{0,120}?\\bon\\s+'+month+'\\s+(\\d{1,2}),?\\s+(\\d{4})','i')):null;
  if(original){
   const date=`${original[3]}-${months[original[1].toLowerCase()]}-${original[2].padStart(2,'0')}`;
   if(day(date))result.push({kind:'incorporated',date,precision:'day',evidence:evidenceForBlock(source,block,'Original certificate of incorporation')});
   continue;
  }
  const direct=block.text.match(new RegExp('^(We|The Company|[A-Z][A-Za-z0-9&., \\-]{1,80})\\s+(?:was|were)\\s+(founded|incorporated|reorganized|established)(?:\\s+in\\s+[^.]{1,65}?)?\\s+(?:on|in)\\s+(?:'+month+'\\s+)?(?:(\\d{1,2}),?\\s+)?(\\d{4})(?:[.,; ]|$)','i'));
  if(!direct)continue;
  if(!/^(?:we|the company)$/i.test(direct[1].trim())&&!issuerNames.some(name=>normalizedName(name)===normalizedName(direct[1])))continue;
  const kind=direct[2].toLowerCase() as ProfileFormation['kind'],m=direct[3],d=direct[4],y=direct[5];
  const date=m?`${y}-${months[m.toLowerCase()]}${d?'-'+d.padStart(2,'0'):''}`:y;
  if(Number(y)<1600||Number(y)>new Date(source.fetched_at).getUTCFullYear()||d&&!day(date))continue;
  result.push({kind,date,precision:d?'day':m?'month':'year',evidence:evidenceForBlock(source,block,'Corporate formation')});
 }
 const byKind=new Map<string,ProfileFormation[]>();for(const item of result)byKind.set(item.kind,[...(byKind.get(item.kind)??[]),item]);
 return [...byKind.values()].flatMap(items=>new Set(items.map(item=>item.date)).size===1?[items[0]]:[]).slice(0,4);
}

/** Inline-XBRL identity is mandatory for periodic SEC reports. URL identity alone is insufficient. */
export function parseSecProfileFiling(html:string,source:ProfileArchivedSource,company:CompanyIdentity):{parsed:ProfileHTML;fields:ExtractedProfile}{
 if(!completeHTML(html))throw new ProfileError('profile_source_incomplete');
 secProfileURL(source.source_url,company.provider_company_id);
 const parsed=parseProfileHTML(html),ciks=new Set(parsed.ciks.map(cik=>cik.padStart(10,'0')));
 if(ciks.size!==1||!ciks.has(company.provider_company_id.padStart(10,'0')))throw new ProfileError('company_identity_mismatch');
 if(!parsed.registrants.length||parsed.registrants.some(name=>!name.trim()))throw new ProfileError('profile_source_identity_missing');
 const form=source.form_type?.replace(/\/A$/,'');
 if(!form||!parsed.document_types.length||parsed.document_types.some(value=>value.replace(/\/A$/,'')!==form))throw new ProfileError('profile_filing_identity_invalid');
 const period=(value:string)=>{if(day(value))return value;const match=value.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);if(!match||!months[match[1].toLowerCase()])return null;const date=`${match[3]}-${months[match[1].toLowerCase()]}-${match[2].padStart(2,'0')}`;return day(date)?date:null;};
 if(!source.report_period||!parsed.report_periods.length||parsed.report_periods.some(value=>period(value)!==source.report_period))throw new ProfileError('profile_filing_identity_invalid');
 if(source.form_type?.endsWith('/A')&&!parsed.amendments.some(value=>/^true$/i.test(value)))throw new ProfileError('profile_filing_identity_invalid');
 source.normalized_text=parsed.text;
 const fields=emptyExtracted();extractBusiness(parsed,source,fields);extractSegments(parsed,source,fields);extractLeadership(parsed,source,fields);fields.formation=extractProfileFormation(parsed,source);
 return {parsed,fields};
}

/** Follow only an explicit same-issuer SEC exhibit link from the verified annual report. */
export function profileCharterLink(parsed:ProfileHTML,sourceURL:string,cik:string):string|null{
 const links=parsed.links.filter(link=>/certificate of incorporation/i.test(link.text)&&!/amendment to/i.test(link.text));
 const urls=[...new Set(links.flatMap(link=>{try{return [secProfileURL(new URL(link.href,sourceURL).href,cik).href];}catch{return [];}}))];
 return urls.length===1?urls[0]:null;
}

export function parseSecProfileCharter(html:string,source:ProfileArchivedSource,expectedName:string):ProfileFormation[]{
 if(!completeHTML(html))throw new ProfileError('profile_source_incomplete');
 const parsed=parseProfileHTML(html);source.normalized_text=parsed.text;
 const name=normalizedName(expectedName),prefix=normalizedName(parsed.text.slice(0,1800));
 if(!name||!prefix.includes(name)||!/certificate of incorporation/i.test(parsed.text.slice(0,1800)))throw new ProfileError('company_identity_mismatch');
 return extractProfileFormation(parsed,source,[expectedName],true);
}

/** Same Q4 Person Details structure across reviewed official issuer URLs; no CEO name is configured. */
export function parseOfficialLeadership(html:string,source:ProfileArchivedSource,issuerLabel:string):ProfileLeadership[]{
 if(!/<\/html>\s*$/i.test(html))throw new ProfileError('profile_source_incomplete');
 const parsed=parseProfileHTML(html);source.normalized_text=parsed.text;
 if(!parsed.title.toLowerCase().includes(issuerLabel.toLowerCase())||parsed.person_names.length!==1||parsed.person_roles.length!==1||!/^chief executive officer$/i.test(parsed.person_roles[0]))throw new ProfileError('profile_leadership_structure_changed');
 const name=parsed.person_names[0];if(!/^[\p{L}][\p{L}\p{M} .,'’\-]{1,100}$/u.test(name))throw new ProfileError('profile_leadership_structure_changed');
 const block=parsed.blocks.find(block=>block.text.includes(name)&&block.text.includes(parsed.person_roles[0]));
 if(!block||block.text.length>1600)throw new ProfileError('profile_leadership_structure_changed');
 return [{name,role:parsed.person_roles[0],as_of:source.fetched_at.slice(0,10),basis:'official_page',evidence:evidenceForBlock(source,block,'Official leadership — Person Details')}];
}
