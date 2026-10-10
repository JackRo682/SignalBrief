import Study from '@/research/study';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <Study id={id}/>;}
