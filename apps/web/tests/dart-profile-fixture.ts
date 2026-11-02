import {directoryZip,projectUrl,zipSha} from './dart-directory-fixture';
import type {ProfileParsePayload} from '../src/server/dart-profile-archive';
export const dartProfileCompany={id:'20000000-0000-4000-8000-000000000008',provider_company_id:'12345678',ticker:'123456'};
export const dartProfileReceipt='20260814000001';
export const dartProfileName='합성연구 주식회사';
export const businessQuote='당사는 합성 연구장비와 실험실 데이터 서비스를 개발하여 연구기관에 제공하고 있습니다. 실험 데이터 기록과 장비 유지보수를 지원하는 사업을 영위하고 있습니다.';
export function profileXML(extra=''){return `<?xml version="1.0" encoding="UTF-8"?><DOCUMENT><DOCUMENT-NAME>반기보고서</DOCUMENT-NAME><COMPANY-NAME AREGCIK="12345678">${dartProfileName}</COMPANY-NAME><BODY><TITLE>II. 사업의 내용</TITLE><TITLE>1. 사업의 개요</TITLE><P>${businessQuote}</P><TITLE>2. 주요 제품 및 서비스</TITLE><TABLE><TR><TD>사업부문</TD><TD>주요 제품</TD><TD>설명</TD></TR><TR><TD>연구장비</TD><TD>합성 장비 A</TD><TD>연구기관용 장비</TD></TR><TR><TD>데이터 서비스</TD><TD>연구 기록 서비스</TD><TD>실험 기록 관리</TD></TR></TABLE><TITLE>III. 재무에 관한 사항</TITLE><P>숫자는 별도의 재무 자료에서 확인합니다.</P>${extra}</BODY></DOCUMENT>`;}
export function profileArchive(xml=profileXML()){
 const bytes=directoryZip(xml,{name:dartProfileReceipt+'.xml'}),sha=zipSha(bytes);
 const payload:ProfileParsePayload={kind:'profile_parse',sha,source_url:`${projectUrl}/storage/v1/object/sign/signalbrief-raw/profiles/dart/${sha}.zip?token=synthetic.signed.token`,nonce:'c'.repeat(64),corp_code:'12345678',ticker:'123456',receipt:dartProfileReceipt,company_name:dartProfileName,report_name:'반기보고서'};
 return {bytes,payload};
}
export function periodicList(overrides:Record<string,unknown>={}){return JSON.stringify({status:'000',page_no:1,page_count:100,total_count:1,total_page:1,list:[{corp_code:'12345678',stock_code:'123456',corp_name:dartProfileName,rcept_no:dartProfileReceipt,rcept_dt:'20260814',report_nm:'반기보고서 (2026.06)'}],...overrides});}
