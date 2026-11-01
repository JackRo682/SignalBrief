import {notFound} from 'next/navigation';
import {z} from 'zod';
import CompanyDetail from '@/redesign/company';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;if(!z.string().uuid().safeParse(id).success)notFound();return <CompanyDetail id={id}/>;}
