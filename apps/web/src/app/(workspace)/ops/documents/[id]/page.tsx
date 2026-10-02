import Screen from "@/screens/ops-document";
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <Screen id={id}/>;}
