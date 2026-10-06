import {DocumentView} from "@/workspace/company";
import ResponsiveScreen from '@/mobile/responsive';
import MobileDocument from '@/mobile/document';
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{kind?:string}>}){const [{id},{kind}]=await Promise.all([params,searchParams]);const documentKind=kind==="filing"?"filing":"document";return <ResponsiveScreen mobile={<MobileDocument id={id} kind={documentKind}/>} desktop={<DocumentView id={id} kind={documentKind}/>}/>;}
