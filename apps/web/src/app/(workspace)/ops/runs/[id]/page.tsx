import OpsRun from '@/screens/ops-run';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <OpsRun id={id}/>;}
