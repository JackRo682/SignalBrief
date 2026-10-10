import {DesktopSearchResults} from '@/desktop/search';
import ResponsiveScreen from '@/mobile/responsive';
import {MobileSearchResults} from '@/mobile/search';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const p=await searchParams;const s=(key:string)=>typeof p[key]==='string'?p[key] as string:'';const n=(key:string,max:number)=>Math.max(0,Math.min(max,Math.floor(Number(s(key))||0)));
 const props={initial:s('q').slice(0,100),initialKind:s('kind'),initialMarket:s('market').slice(0,32),initialDays:n('days',3650),initialOffset:n('offset',1000),initialSort:s('sort')==='newest'?'newest' as const:'relevance' as const};
 return <ResponsiveScreen mobile={<MobileSearchResults {...props}/>} desktop={<DesktopSearchResults {...props}/>}/>;
}
