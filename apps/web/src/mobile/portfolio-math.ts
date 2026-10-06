import {z} from 'zod';
import {portfolioSchema} from '@/lib/contracts';
import {quoteSchema} from '@/workspace/contracts';

export type Holding = z.infer<typeof portfolioSchema>['positions'][number];
export type MarketQuote = z.infer<typeof quoteSchema>;
export const referenceRateSchema = z.object({base:z.literal('USD'),quote:z.literal('KRW'),rate:z.number().finite().positive(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),source:z.string(),kind:z.literal('daily_reference')});
export type ReferenceRate = z.infer<typeof referenceRateSchema>;

// Decimal inputs remain exact through multiplication, FX conversion and addition.
// Only dimensionless percentages and chart weights become binary floating point.
type Decimal = {n:bigint;s:number};
const power = (s:number) => 10n ** BigInt(s);
function decimal(v:string|number):Decimal|null {
 const raw=String(v),match=/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(raw);
 if(!match)return null;
 const fraction=match[3]??'',exponent=Number(match[4]??0);
 if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>100)return null;
 let n=BigInt((match[1]??'')+match[2]+fraction),s=fraction.length-exponent;
 if(s<0){n*=power(-s);s=0;}return {n,s};
}
const plus=(a:Decimal,b:Decimal):Decimal=>{const s=Math.max(a.s,b.s);return {n:a.n*power(s-a.s)+b.n*power(s-b.s),s};};
const minus=(a:Decimal,b:Decimal)=>plus(a,{n:-b.n,s:b.s});
const times=(a:Decimal,b:Decimal):Decimal=>({n:a.n*b.n,s:a.s+b.s});
function divided(a:Decimal,b:Decimal,scale=14):Decimal|null {
 if(b.n===0n)return null;
 const numerator=a.n*power(b.s+scale),denominator=b.n*power(a.s),quotient=numerator/denominator,remainder=numerator%denominator;
 const abs=(v:bigint)=>v<0n?-v:v,round=abs(remainder)*2n>=abs(denominator)?(numerator<0n)!==(denominator<0n)?-1n:1n:0n;
 return {n:quotient+round,s:scale};
}
function stringOf(a:Decimal):string {
 const negative=a.n<0n,absolute=(negative?-a.n:a.n).toString().padStart(a.s+1,'0');
 const value=a.s?`${absolute.slice(0,-a.s)}.${absolute.slice(-a.s)}`.replace(/\.?0+$/,''):absolute;
 return `${negative&&a.n!==0n?'-':''}${value||'0'}`;
}
const total=(xs:Decimal[])=>xs.reduce(plus,{n:0n,s:0});
function ratio(a:Decimal,b:Decimal):number|null {const result=divided(a,b);if(!result)return null;const n=Number(stringOf(result));return Number.isFinite(n)?n:null;}
function percentage(a:Decimal,b:Decimal):number|null {const quotient=ratio(a,b);return quotient!==null&&Number.isFinite(quotient*100)?quotient*100:null;}
function converted(value:Decimal,currency:string,target:string,fx:ReferenceRate|null):Decimal|null {
 if(currency===target)return value;
 if(currency==='USD'&&target==='KRW'&&fx){const rate=decimal(fx.rate);return rate?times(value,rate):null;}
 if(currency==='KRW'&&target==='USD'&&fx){const rate=decimal(fx.rate);return rate?divided(value,rate):null;}
 return null;
}
export function validReferenceRate(fx:ReferenceRate|null,now=Date.now()):ReferenceRate|null {
 if(!fx||!referenceRateSchema.safeParse(fx).success)return null;
 const date=Date.parse(`${fx.date}T00:00:00Z`),today=new Date(now).toISOString().slice(0,10);
 // A daily reference is not a trading quote. Expired/future rates cannot silently value holdings.
 return Number.isFinite(date)&&new Date(date).toISOString().slice(0,10)===fx.date&&fx.date<=today&&now-date<=7*86400000?fx:null;
}
export function compareAmount(a:string|null,b:string|null):number {
 if(a===null)return b===null?0:-1;if(b===null)return 1;
 const x=decimal(a),y=decimal(b);if(!x||!y)return 0;const difference=minus(x,y).n;return difference<0n?-1:difference>0n?1:0;
}
export function amountSign(value:string|null):'positive'|'negative'|'neutral' {return value===null?'neutral':compareAmount(value,'0')>0?'positive':compareAmount(value,'0')<0?'negative':'neutral';}
export function formatExactMoney(value:string|null,currency:string,locale='ko-KR',signed=false):string {
 const d=value===null?null:decimal(value);if(!d)return '—';
 const digits=currency==='KRW'||currency==='JPY'?0:2,absolute=d.n<0n?-d.n:d.n;
 let rounded:bigint;if(d.s<=digits)rounded=absolute*power(digits-d.s);else {const divisor=power(d.s-digits);rounded=absolute/divisor+(absolute%divisor*2n>=divisor?1n:0n);}
 const whole=rounded/power(digits),fraction=digits?`.${(rounded%power(digits)).toString().padStart(digits,'0')}`:'';
 const sign=rounded===0n?'':d.n<0n?'-':signed?'+':'',number=whole.toLocaleString(locale)+fraction;
 if(currency==='KRW')return `${sign}${number}${locale.startsWith('ko')?'원':' KRW'}`;
 if(currency==='USD')return `${sign}$${number}`;return `${sign}${number} ${currency}`;
}
export type ValuedHolding={position:Holding;quote:MarketQuote|null;currency:string;value:string|null;cost:string|null;dailyChange:string|null;gain:string|null;returnPct:number|null;weight:number|null;valuationDate:string|null};
export type PortfolioValue={currency:string|null;rows:ValuedHolding[];value:string|null;cost:string|null;dailyChange:string|null;dailyPct:number|null;gain:string|null;returnPct:number|null;complete:boolean;pricedCount:number;fx:ReferenceRate|null;groups:{currency:string;value:string|null;count:number}[]};

export function valuePortfolio(positions:Holding[],quotes:MarketQuote[],referenceRate:ReferenceRate|null,now=Date.now()):PortfolioValue {
 const fx=validReferenceRate(referenceRate,now),quoteMap=new Map(quotes.map(q=>[q.symbol.toUpperCase(),q]));
 const currencies=new Set(positions.map(p=>quoteMap.get(p.company.ticker.toUpperCase())?.currency||p.currency));
 const currency=currencies.size===0?'KRW':fx&&[...currencies].every(c=>c==='USD'||c==='KRW')?'KRW':currencies.size===1?[...currencies][0]:null;
 const rows=positions.map(position=>{
  const quote=quoteMap.get(position.company.ticker.toUpperCase())??null,quantity=decimal(position.quantity),price=quote?.price===null||quote?.price===undefined?null:decimal(quote.price),target=currency??quote?.currency??position.currency;
  const quoteTime=quote?Date.parse(quote.as_of):NaN;
  const trustedQuote=!!quote&&Number.isFinite(quoteTime)&&quoteTime<=now+300000&&now-quoteTime<=7*86400000&&!!price&&price.n>=0n;
  const rawValue=trustedQuote&&quantity&&quantity.n>0n&&price?times(quantity,price):null;
  const value=rawValue&&quote?converted(rawValue,quote.currency,target,fx):null;
  const unitCost=position.average_cost===null?null:decimal(position.average_cost);
  // Different cost and quote currencies require the actual acquisition FX, which is not stored.
  // Do not invent lifetime returns by converting historical cost at today's exchange rate.
  const rawCost=quantity&&unitCost&&unitCost.n>=0n?times(quantity,unitCost):null;
  const cost=rawCost&&(!quote||position.currency===quote.currency)?converted(rawCost,position.currency,target,fx):null;
  const changePct=quote?.change_pct??null,percent=changePct!==null&&Number.isFinite(changePct)&&changePct>-100?decimal(changePct):null;
  const previous=rawValue&&percent?divided(times(rawValue,{n:100n,s:0}),plus({n:100n,s:0},percent)):null;
  const daily=previous&&rawValue&&quote?converted(minus(rawValue,previous),quote.currency,target,fx):null;
  const gain=value&&cost?minus(value,cost):null;
  return {position,quote:trustedQuote?quote:null,currency:target,value:value?stringOf(value):null,cost:cost?stringOf(cost):null,dailyChange:daily?stringOf(daily):null,gain:gain?stringOf(gain):null,returnPct:gain&&cost&&cost.n>0n?percentage(gain,cost):null,weight:null as number|null,valuationDate:trustedQuote?quote?.as_of??null:null};
 });
 const complete=positions.length>0&&currency!==null&&rows.every(r=>r.value!==null);
 const sum=(key:'value'|'cost'|'dailyChange'|'gain')=>complete&&rows.every(r=>r[key]!==null)?total(rows.map(r=>decimal(r[key]!)!)):null;
 const value=sum('value'),cost=sum('cost'),daily=sum('dailyChange'),gain=sum('gain');
 const previous=value&&daily?minus(value,daily):null;
 if(value&&value.n>0n)for(const row of rows)row.weight=percentage(decimal(row.value!)!,value);
 const groups=[...currencies].map(c=>{const members=rows.filter(r=>(r.quote?.currency??r.position.currency)===c),values=members.map(r=>{if(r.value===null)return null;return converted(decimal(r.value)!,r.currency,c,fx);});return {currency:c,value:values.length&&values.every(v=>v!==null)?stringOf(total(values as Decimal[])):null,count:members.length};});
 return {currency,rows,value:value?stringOf(value):null,cost:cost?stringOf(cost):null,dailyChange:daily?stringOf(daily):null,dailyPct:daily&&previous&&previous.n>0n?percentage(daily,previous):null,gain:gain?stringOf(gain):null,returnPct:gain&&cost&&cost.n>0n?percentage(gain,cost):null,complete,pricedCount:rows.filter(r=>r.value!==null).length,fx,groups};
}
