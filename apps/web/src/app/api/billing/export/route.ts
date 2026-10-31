import {billingFailure,billingHeaders,billingRpc,billingUser,statusSchema,BillingError} from '@/server/billing';
import {companyDetailSchema} from '@/workspace/contracts';
import {z} from 'zod';
export const runtime='nodejs';export const dynamic='force-dynamic';
export function csvCell(value:unknown){const text=String(value??'');return '"'+(/^[\s]*[=+@\-\t\r]/.test(text)?"'"+text:text).replaceAll('"','""')+'"';}
export async function GET(req:Request){try{
 const {db}=await billingUser(req),status=statusSchema.parse(await billingRpc(db,'sb_billing_status'));
 // Test payments never unlock a production export.
 if(!status.active)throw new BillingError(403,'active_pass_required');
 const id=z.string().uuid().safeParse(new URL(req.url).searchParams.get('company_id'));if(!id.success)throw new BillingError(422,'invalid_company');
 const data=companyDetailSchema.parse(await billingRpc(db,'sb_workspace',{action:'company',p:{id:id.data}}));
 const rows=[['company','ticker','kind','title','published_at','source_url'],...data.documents.map(x=>[x.company_name,x.ticker,x.kind,x.title,x.published_at,x.source_url])];
 return new Response('\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'),{headers:{...billingHeaders,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="signalbrief-company-sources.csv"'}});
 }catch(error){return billingFailure(error);}}
