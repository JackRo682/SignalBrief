import {SearchResults} from "@/workspace/search";
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const p=await searchParams;const s=(key:string)=>typeof p[key]==='string'?p[key] as string:'';const n=(key:string,max:number)=>Math.max(0,Math.min(max,Math.floor(Number(s(key))||0)));
 return <SearchResults initial={s('q').slice(0,100)} initialKind={s('kind')} initialMarket={s('market').slice(0,32)} initialDays={n('days',3650)} initialOffset={n('offset',1000)} initialSort={s('sort')==='newest'?'newest':'relevance'}/>;
}
