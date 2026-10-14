/** Public messages intentionally omit operational credentials and configuration. */
export function marketStatusText(reason:string,locale:string):string {
 const ko=locale==='ko';
 if(reason==='fmp_display_license_unverified')return ko
  ?'시세 표시 권한을 확인 중입니다. 확인 전에는 주가·차트·평가금액을 표시하지 않습니다. 전체 시세가 없으면 총 평가액을 계산하지 않습니다.'
  :'Quote display permission is pending verification. Prices, charts and valuations remain unavailable until verified.';
 if(reason==='partial_provider_unavailable')return ko
  ?'일부 종목의 시세를 확인할 수 없습니다. 미제공 시세는 —로 표시하며 전체 시세가 없으면 총 평가액을 계산하지 않습니다.'
  :'Some quotes are unavailable. Missing prices display —; the total valuation requires complete quote coverage.';
 if(reason)return ko
  ?'시세를 확인할 수 없습니다. 잠시 후 다시 확인해 주세요. 미제공 시세는 0원으로 계산하지 않습니다. 전체 시세가 없으면 총 평가액을 계산하지 않습니다.'
  :'Quotes are unavailable. Try again later. Missing prices are never treated as zero.';
 return '';
}
