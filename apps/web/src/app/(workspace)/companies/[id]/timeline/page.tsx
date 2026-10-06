import ReferenceApp from "@/reference/reference-app";
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <ReferenceApp screen="timeline" id={id}/>;}
