type QuoteState={loading:boolean;reason:string;unavailable?:{symbol:string;reason:string}[]};
type Translate=(ko:string,en:string)=>string;
/** Render known categories only; never reflect provider messages or credentials. */
export function quoteUnavailableText(state:QuoteState,symbol:string,t:Translate):string{
 if(state.loading)return t('시세를 확인하고 있습니다.','Loading quotes.');
 const reason=state.unavailable?.find(item=>item.symbol===symbol.trim().toUpperCase())?.reason||state.reason;
 switch(reason){
  case 'fmp_display_license_unverified':return t('미국 주가의 웹 표시 승인 대기 중입니다.','US price display permission is pending.');
  case 'kis_display_license_unverified':return t('한국 주가의 웹 표시 승인 대기 중입니다.','Korean price display permission is pending.');
  case 'missing_key':case 'missing_credentials':return t('시세 공급자 인증 설정이 필요합니다.','Price provider credentials are required.');
  case 'invalid_key':return t('시세 공급자 인증을 확인해야 합니다.','Price provider authentication needs attention.');
  case 'access_or_plan_denied':return t('계약된 시세 제공 범위를 확인해야 합니다.','Price provider plan access needs attention.');
  case 'quota_exceeded':case 'daily_quota_exceeded':case 'per_request_provider_limit':case 'authentication_busy':return t('시세 조회 한도에 도달했습니다. 잠시 후 다시 확인해 주세요.','The quote request limit was reached. Please try again later.');
  case 'unsupported_company':case 'unsupported_us_symbol':return t('아직 시세를 지원하지 않는 종목입니다.','Quotes are not supported for this company yet.');
  case 'eod_price_unavailable':return t('공급자에서 확인된 일일 종가가 아직 없습니다.','The provider has no verified daily close yet.');
  default:return t('시세를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.','Quotes could not be loaded. Please try again later.');
 }
}
/** Date-only provider observations have no exchange clock time to display. */
export function quoteDatePrecision(asOf:string):'date'|'timestamp'{return /^\d{4}-\d{2}-\d{2}$/.test(asOf)?'date':'timestamp';}
