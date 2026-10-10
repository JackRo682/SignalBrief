import {EvaluationRun} from '@/research/evaluations';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <EvaluationRun id={id}/>;}
