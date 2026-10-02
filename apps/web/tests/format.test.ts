import { describe,expect,it } from "vitest";
import { pct,dateText,display,score } from "../src/lib/format";
describe("financial display",()=>{
 it.each([["28","+28%"],["-10","-10%"],["0","0%"],[null,"비교 불가"]])("formats %s without inventing values",(input,expected)=>expect(pct(input)).toBe(expected));
 it("does not show unknown cost as zero",()=>expect(display(null)).toBe("미측정"));
 it("does not invent invalid dates",()=>expect(dateText("bad")).toBe("날짜 미상"));
 it("uses Korean time",()=>expect(dateText("2026-01-01T15:00:00Z","date")).toContain("2일"));
 it("renders normalized score",()=>expect(score(.78)).toBe("78"));
});
