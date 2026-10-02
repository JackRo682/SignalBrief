import Screen from "@/screens/timeline";
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <Screen id={id}/>;}
