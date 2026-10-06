import Screen from "@/workspace/help";
export default async function Page({searchParams}:{searchParams:Promise<{category?:string}>}){const p=await searchParams;return <Screen initialCategory={p.category??""}/>;}
