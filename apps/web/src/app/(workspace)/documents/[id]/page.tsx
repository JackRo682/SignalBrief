import {DocumentView} from "@/workspace/company";
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{kind?:string}>}){const [{id},{kind}]=await Promise.all([params,searchParams]);return <DocumentView id={id} kind={kind==="filing"?"filing":"document"}/>;}
