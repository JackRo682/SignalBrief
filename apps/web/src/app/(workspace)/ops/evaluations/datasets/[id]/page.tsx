import {DatasetDetail} from '@/research/evaluations';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <DatasetDetail id={id}/>;}
