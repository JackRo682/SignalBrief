/** Select only the evidence already authorized and validated by detail(). */
export function selectEvidence<T extends {quote:unknown;fact_id:unknown}>(question:string,evidence:T[],fields:Map<string,string>){
 const lower=question.toLowerCase();
 const changed=/변화|바뀐|달라|이전|비교|change|previous|compare/i.test(question);
 const sourceRequest=/원문|출처|근거|인용|증거|공시|\bsources?\b|\bcitations?\b|\bevidence\b|\boriginal\b|\bdocuments?\b/i.test(question);
 const topical=/(매출|배당|설비|투자|위험|리스크|경영진|전망|영업|직원|인원|수익|부채|현금|자산|revenue|dividend|capex|risk|management|guidance|operating|employees?|headcount|profit|debt|cash|assets?)/i.test(question);
 const aliases:Record<string,string>={매출:'revenue',배당:'dividend',설비:'capex',투자:'capex',위험:'risk',리스크:'risk',경영진:'management',전망:'guidance',영업:'operating'};
 const words=[...new Set([...(lower.match(/[a-z가-힣]{2,}/g)??[]),...Object.entries(aliases).filter(([key])=>question.includes(key)).map(([,value])=>value)])];
 return {changed,evidence:evidence.filter(item=>changed||sourceRequest&&!topical||words.some(word=>(String(item.quote)+' '+(fields.get(String(item.fact_id))??'')).toLowerCase().includes(word))).slice(0,6)};
}
