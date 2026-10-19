export type CompanyIdentity={id:string;provider_company_id:string;ticker:string};
export class ProfileError extends Error {constructor(public code:string,public status=502){super(code);}}
const field=(value:unknown):string|null=>typeof value==='string'&&value.trim()&&value.trim()!=='-'?value.trim():null;
function date(value:unknown):string|null{
 const v=field(value);if(!v||!/^\d{8}$/.test(v))return null;
 const iso=`${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`;
 const parsed=new Date(`${iso}T00:00:00Z`);return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===iso?iso:null;
}
function website(value:unknown):string|null{
 const v=field(value);if(!v)return null;
 try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
export function parseProfile(raw:string,company:CompanyIdentity,fetchedAt:string,sha:string){
 let data:Record<string,unknown>;try{data=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();}catch{throw new ProfileError('invalid_provider_response');}
 const base={provider:'OpenDART' as const,company_id:company.id,fetched_at:fetchedAt,source_sha256:sha,source_url:'https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019002'};
 if(data.status==='013')return {...base,status:'not_available' as const,profile:null};
 if(data.status!=='000')throw new ProfileError(data.status==='020'?'provider_quota_exceeded':data.status==='010'?'provider_key_invalid':'provider_unavailable',data.status==='020'?429:502);
 if(data.corp_code!==company.provider_company_id||data.stock_code!==company.ticker)throw new ProfileError('company_identity_mismatch');
 const name=field(data.corp_name);if(!name)throw new ProfileError('invalid_provider_response');
 return {...base,status:'verified' as const,profile:{corp_code:company.provider_company_id,ticker:company.ticker,name,english_name:field(data.corp_name_eng),ceo:field(data.ceo_nm),address:field(data.adres),website:website(data.hm_url),established_on:date(data.est_dt),industry_code:field(data.induty_code),fiscal_month:/^(0[1-9]|1[0-2])$/.test(String(data.acc_mt))?String(data.acc_mt):null}};
}

/** SEC submissions is an issuer profile source; absent fields remain null. */
export function parseSecProfile(raw:string,company:CompanyIdentity,fetchedAt:string,sha:string){
 let data:Record<string,unknown>;try{data=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();}catch{throw new ProfileError('invalid_provider_response');}
 const cik=String(data.cik??'');
 if(!/^\d{1,10}$/.test(cik)||cik.padStart(10,'0')!==company.provider_company_id.padStart(10,'0')||!Array.isArray(data.tickers)||!data.tickers.includes(company.ticker))throw new ProfileError('company_identity_mismatch');
 const name=field(data.name);if(!name)throw new ProfileError('invalid_provider_response');
 const addresses=data.addresses as {business?:Record<string,unknown>}|undefined,address=addresses?.business;
 const fiscal=field(data.fiscalYearEnd);
 return {provider:'SEC EDGAR',company_id:company.id,status:'verified' as const,fetched_at:fetchedAt,source_sha256:sha,source_url:`https://www.sec.gov/edgar/browse/?CIK=${cik.padStart(10,'0')}`,
  profile:{corp_code:cik.padStart(10,'0'),ticker:company.ticker,name,english_name:name,ceo:null,established_on:null,
   address:address?[address.street1,address.street2,address.city,address.stateOrCountry,address.zipCode].map(field).filter(Boolean).join(', ')||null:null,
   website:website(data.website),industry_code:field(data.sic),industry_description:field(data.sicDescription),
   fiscal_month:fiscal&&/^(0[1-9]|1[0-2])[0-3]\d$/.test(fiscal)?fiscal.slice(0,2):null}};
}
