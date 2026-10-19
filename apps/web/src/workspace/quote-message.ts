type Translate=(ko:string,en:string)=>string;
export function quoteMessage(reason:string,t:Translate):string {
 if(reason==='kis_display_license_unverified')return t('KIS 시세 공개 표시 권한이 확인되지 않았습니다.','KIS public display permission has not been verified.');
 if(reason==='fmp_display_license_unverified')return t('FMP 시세 공개 표시 권한이 확인되지 않았습니다.','FMP public display permission has not been verified.');
 if(reason==='missing_key')return t('시세 공급자 인증 정보가 설정되지 않았습니다.','Price provider credentials are not configured.');
 if(reason==='partial_provider_unavailable')return t('일부 시세 요청을 완료하지 못했습니다. 다시 시도해 주세요.','Some quote requests failed. Please retry.');
 if(reason==='provider_unavailable')return t('시세 공급자 요청에 실패했습니다. 다시 시도해 주세요.','The price provider request failed. Please retry.');
 return t('연결된 시세가 없습니다.','No licensed quote is available.');
}
