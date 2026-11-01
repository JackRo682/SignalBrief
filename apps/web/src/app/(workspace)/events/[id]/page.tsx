import {notFound} from 'next/navigation';
import {z} from 'zod';
import EventDetail from '@/redesign/event';
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{panel?:string;kind?:string}>}){const [{id},{panel,kind}]=await Promise.all([params,searchParams]);if(!z.string().uuid().safeParse(id).success)notFound();return <EventDetail id={id} panel={panel} kind={kind==='calendar'?'calendar':'event'}/>;}
