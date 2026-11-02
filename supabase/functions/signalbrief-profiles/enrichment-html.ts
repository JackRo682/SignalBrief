import {Parser} from 'npm:htmlparser2@10.0.0';
import {ProfileError} from './core.ts';

export type ProfileBlock={text:string;start:number;end:number;heading:boolean};
export type ProfileHTML={text:string;blocks:ProfileBlock[];links:{href:string;text:string}[];ciks:string[];registrants:string[];document_types:string[];report_periods:string[];amendments:string[];title:string;person_names:string[];person_roles:string[]};
const clean=(value:string)=>value.replace(/\s+/g,' ').trim();
const blockTags=new Set(['div','p','li','tr','h1','h2','h3','h4','h5','h6','section','article']);

/** Streaming, bounded visible-text normalization. Scripts/styles/hidden XBRL are never executed or displayed. */
export function parseProfileHTML(html:string):ProfileHTML{
 if(new TextEncoder().encode(html).length>6_000_000)throw new ProfileError('profile_source_too_large');
 const result:ProfileHTML={text:'',blocks:[],links:[],ciks:[],registrants:[],document_types:[],report_periods:[],amendments:[],title:'',person_names:[],person_roles:[]};
 const stack:{name:string;hidden:boolean;bold:boolean;capture?:'cik'|'registrant'|'form'|'period'|'amendment'|'name'|'role'|'title';value:string}[]=[];
 let value='',boldLength=0,nodes=0,visibleLength=0;
 let anchor:{href:string;text:string}|null=null;
 const flush=()=>{
  const text=clean(value);if(text){
   const start=result.text.length;if(start)result.text+='\n';
   const offset=result.text.length;result.text+=text;
   result.blocks.push({text,start:offset,end:result.text.length,heading:text.length<=160&&boldLength>=text.replace(/\s/g,'').length*0.8});
  }
  value='';boldLength=0;
 };
 const parser=new Parser({
  onopentag(name,attrs){
   if(++nodes>200_000||stack.length>=160)throw new ProfileError('profile_source_too_large');
   const parent=stack.at(-1),hidden=Boolean(parent?.hidden)||['head','script','style','noscript','ix:header'].includes(name)||'hidden' in attrs||attrs['aria-hidden']==='true'||/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style??'');
   if(!hidden&&(blockTags.has(name)||name==='br'))flush();
   const classes=(attrs.class??'').split(/\s+/);
   const concept=(attrs.name??'').toLowerCase();
   const capture=name==='ix:nonnumeric'&&concept==='dei:entitycentralindexkey'?'cik':name==='ix:nonnumeric'&&concept==='dei:entityregistrantname'?'registrant':name==='ix:nonnumeric'&&concept==='dei:documenttype'?'form':name==='ix:nonnumeric'&&concept==='dei:documentperiodenddate'?'period':name==='ix:nonnumeric'&&concept==='dei:amendmentflag'?'amendment':classes.includes('PersonName')?'name':classes.includes('PersonTitleText')?'role':name==='title'?'title':undefined;
   stack.push({name,hidden,bold:Boolean(parent?.bold)||['b','strong','h1','h2','h3','h4','h5','h6'].includes(name)||/font-weight\s*:\s*(?:bold|[6-9]00)/i.test(attrs.style??''),capture,value:''});
   if(name==='a'&&!hidden)anchor={href:attrs.href??'',text:''};
   if(!hidden&&['td','th'].includes(name))value+=' ';
  },
  ontext(text){
   for(const entry of stack)if(entry.capture)entry.value+=text;
   if(stack.at(-1)?.hidden)return;
   visibleLength+=text.length;if(visibleLength>2_000_000)throw new ProfileError('profile_source_too_large');
   value+=text;if(stack.at(-1)?.bold)boldLength+=text.replace(/\s/g,'').length;
   if(anchor)anchor.text+=text;
  },
  onclosetag(name){
   const entry=stack.at(-1);
   if(entry?.name!==name)throw new ProfileError('profile_source_format_changed');
   if(!entry.hidden&&(blockTags.has(name)||name==='br'))flush();
   if(name==='a'&&anchor){result.links.push({href:anchor.href,text:clean(anchor.text)});anchor=null;}
   if(entry.capture){
    const text=clean(entry.value);
    if(entry.capture==='cik')result.ciks.push(text);
    if(entry.capture==='registrant')result.registrants.push(text);
    if(entry.capture==='form')result.document_types.push(text);
    if(entry.capture==='period')result.report_periods.push(text);
    if(entry.capture==='amendment')result.amendments.push(text);
    if(entry.capture==='name'&&!entry.hidden)result.person_names.push(text);
    if(entry.capture==='role'&&!entry.hidden)result.person_roles.push(text);
    if(entry.capture==='title')result.title=text;
   }
   if(!entry.hidden&&['td','th'].includes(name))value+=' ';
   stack.pop();
  },
  onerror(){throw new ProfileError('profile_source_format_changed');},
 },{decodeEntities:true});
 parser.write(html);parser.end();flush();
 return result;
}
