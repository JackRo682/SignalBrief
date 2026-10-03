import { describe,it,expect } from "vitest";
import { multiplyDecimal,decimalDisplay,parseCSV,portfolioCSV,importPositions,csvCell,monthDays } from "../src/lib/product";
const catalog=[{id:"apple",ticker:"AAPL"},{id:"samsung",ticker:"005930"}];
describe("exact position arithmetic",()=>{
 it.each([["0.1","0.2","0.02"],["10.25","100.50","1030.125"],["100","10","1000"],["0","25.0","0"],["99999999999999999999","1","99999999999999999999"],["1.00000001","0.00000001","0.0000000100000001"]])("multiplies %s by %s without binary float",(a,b,c)=>expect(multiplyDecimal(a,b)).toBe(c));
 it.each(["NaN","Infinity","1e9","-1","1.123456789", "1;DROP TABLE users"])("rejects invalid decimal %s",x=>expect(()=>multiplyDecimal(x,"1")).toThrow());
 it("formats without rounding",()=>expect(decimalDisplay("1234567890.12345678")).toBe("1,234,567,890.12345678"));
});
describe("CSV privacy and parsing",()=>{
 it("handles BOM, CRLF, quoted commas, escaped quotes and newlines",()=>expect(parseCSV('\uFEFFa,b\r\n"x,y","a""b\nline"\r\n')).toEqual([["a","b"],["x,y",'a"b\nline']]));
 it("round trips portfolio decimal strings and leading zero ticker",()=>{const rows=[{ticker:"005930",quantity:"10.25",average_cost:"100.50",currency:"KRW"}];expect(importPositions(portfolioCSV(rows),catalog)).toEqual([{company_id:"samsung",quantity:"10.25",average_cost:"100.50",currency:"KRW"}]);});
 it.each(["=SUM(1,2)","+x","-x","@x","\tcmd"])("neutralizes spreadsheet formula %s",x=>expect(csvCell(x)).toMatch(/^"'/));
 it("rejects duplicate tickers transactionally before sending",()=>expect(()=>importPositions("ticker,quantity,average_cost,currency\nAAPL,1,,USD\nAAPL,2,,USD",catalog)).toThrow(/중복/));
 it("rejects missing columns",()=>expect(()=>importPositions("ticker,quantity\nAAPL,1",catalog)).toThrow());
 it("rejects repeated headers",()=>expect(()=>importPositions("ticker,quantity,quantity,average_cost,currency\nAAPL,1,1,,USD",catalog)).toThrow());
 it("rejects unknown companies",()=>expect(()=>importPositions("ticker,quantity,average_cost,currency\nFAKE,1,,USD",catalog)).toThrow());
 it("rejects zero positions",()=>expect(()=>importPositions("ticker,quantity,average_cost,currency\nAAPL,0,,USD",catalog)).toThrow());
 it("rejects unclosed quotes",()=>expect(()=>parseCSV('x,"y')).toThrow());
 it("rejects missing delimiter after quote",()=>expect(()=>parseCSV('"a"b,c')).toThrow());
 it("enforces byte limit for Korean and ASCII content",()=>expect(()=>parseCSV("가".repeat(50000))).toThrow());
 it("enforces row cap",()=>expect(()=>parseCSV("a,b\n".repeat(203))).toThrow());
});
describe("UTC calendar layout",()=>{
 it("includes leap day",()=>expect(monthDays(2024,1).filter(d=>d.current)).toHaveLength(29));
 it("includes 42 unique days and crosses year boundaries",()=>{const days=monthDays(2026,0);expect(days).toHaveLength(42);expect(new Set(days.map(d=>d.date)).size).toBe(42);expect(days[0].date).toBe("2025-12-28");});
});
