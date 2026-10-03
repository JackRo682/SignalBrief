// Exact user-entered quantities/costs stay decimal strings; never use binary floats for money.
export function multiplyDecimal(a:string,b:string):string {
 const parse=(v:string)=>{if(!/^\d{1,20}(\.\d{1,8})?$/.test(v))throw new Error("invalid_decimal");const [whole,fraction=""]=v.split(".");return {value:BigInt(whole+fraction),scale:fraction.length};};
 const x=parse(a),y=parse(b),scale=x.scale+y.scale;let digits=(x.value*y.value).toString().padStart(scale+1,"0");if(!scale)return digits;digits=digits.slice(0,-scale)+"."+digits.slice(-scale);return digits.replace(/\.?0+$/,"")||"0";
}
export function decimalDisplay(value:string):string{const [whole,fraction]=value.split(".");return whole.replace(/\B(?=(\d{3})+(?!\d))/g,",")+(fraction?"."+fraction:"");}
export function csvCell(value:string):string{const safe=/^[=+\-@\t\r]/.test(value)?"'"+value:value;return '"'+safe.replace(/"/g,'""')+'"';}
export function parseCSV(input:string):string[][] {
 if(new TextEncoder().encode(input).length>131072)throw new Error("CSV 파일은 128KB 이하로 올려 주세요.");
 const text=input.replace(/^\uFEFF/,"");const result:string[][]=[];let record:string[]=[],field="",quoted=false,closed=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;}
 else if(c==='"'){if(field||closed)throw new Error("CSV 따옴표 형식을 확인해 주세요.");quoted=true;}
 else if(c===","){record.push(field);field="";closed=false;}
 else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;record.push(field);if(record.some(v=>v.trim()))result.push(record);record=[];field="";closed=false;}
 else {if(closed&&!/\s/.test(c))throw new Error("CSV 구분자를 확인해 주세요.");if(!closed)field+=c;}
 if(result.length>201)throw new Error("한 번에 최대 200종목까지 가져올 수 있습니다.");}
 if(quoted)throw new Error("CSV 따옴표가 닫히지 않았습니다.");record.push(field);if(record.some(v=>v.trim()))result.push(record);if(result.length>201)throw new Error("최대 200종목입니다.");return result;
}
export function portfolioCSV(rows:{ticker:string;quantity:string;average_cost:string|null;currency:string}[]):string{return '\uFEFFticker,quantity,average_cost,currency\r\n'+rows.map(r=>[r.ticker,r.quantity,r.average_cost??"",r.currency].map(csvCell).join(",")).join("\r\n");}
export function importPositions(text:string,catalog:{id:string;ticker:string}[]){const parsed=parseCSV(text);if(parsed.length<2)throw new Error("열 이름과 종목 데이터가 필요합니다.");const header=parsed[0].map(x=>x.trim().toLowerCase());if(new Set(header).size!==header.length)throw new Error("열 이름이 중복되었습니다.");for(const key of ["ticker","quantity","average_cost","currency"])if(!header.includes(key))throw new Error(`${key} 열이 필요합니다.`);const seen=new Set<string>();return parsed.slice(1).map((line,index)=>{if(line.length!==header.length)throw new Error(`${index+2}행의 열 개수가 다릅니다.`);const get=(k:string)=>line[header.indexOf(k)].trim();const ticker=get("ticker").toUpperCase(),company=catalog.find(c=>c.ticker.toUpperCase()===ticker);if(!company)throw new Error(`${index+2}행: 연결된 기업 목록에 없는 종목 ${ticker}`);if(seen.has(company.id))throw new Error(`${index+2}행: 중복 종목 ${ticker}`);seen.add(company.id);const quantity=get("quantity"),average_cost=get("average_cost"),currency=get("currency").toUpperCase();if(!/^\d{1,20}(\.\d{1,8})?$/.test(quantity)||!/[1-9]/.test(quantity))throw new Error(`${index+2}행: 수량은 0보다 큰 숫자여야 합니다.`);if(average_cost&&!/^\d{1,20}(\.\d{1,8})?$/.test(average_cost))throw new Error(`${index+2}행: 취득가 형식 오류`);if(!["USD","KRW","EUR","JPY","GBP","AUD","CAD","HKD","CNY","CHF"].includes(currency))throw new Error(`${index+2}행: 지원하지 않는 통화`);return {company_id:company.id,quantity,average_cost:average_cost||null,currency};});}
export function monthDays(year:number,month:number):{date:string;day:number;current:boolean}[]{const first=new Date(Date.UTC(year,month,1)),offset=first.getUTCDay();return Array.from({length:42},(_,i)=>{const date=new Date(Date.UTC(year,month,1-offset+i));return {date:date.toISOString().slice(0,10),day:date.getUTCDate(),current:date.getUTCMonth()===month};});}
export function koreanToday():string{return new Date(Date.now()+9*3600000).toISOString().slice(0,10);}
export function downloadText(text:string,name:string,type="text/plain;charset=utf-8"){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
