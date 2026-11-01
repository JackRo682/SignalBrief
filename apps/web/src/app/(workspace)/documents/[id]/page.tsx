import {notFound} from 'next/navigation';
import {z} from 'zod';
import AnalysisDetail from '@/redesign/analysis';
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{kind?:string;analysis?:string}>}){const [{id},{kind,analysis}]=await Promise.all([params,searchParams]);if(!z.string().uuid().safeParse(id).success)notFound();return <AnalysisDetail id={id} kind={kind==='filing'?'filing':'document'} analysis={analysis}/>;}
