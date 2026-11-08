import { describe, expect, it } from "vitest";
import { calendarCategory, documentCategory, documentLabel } from "../src/redesign/home-b-data";

describe("Home B source categories", () => {
  it.each([
    ["Synthetic earnings announcement", "earnings"],
    ["FY26 Q1 Earnings Call and Webcast", "earnings"],
    ["Full-year financial results", "earnings"],
    ["2026년 3분기 경영실적 발표", "earnings"],
    ["Synthetic investor day", "investor"],
    ["Capital Markets Day", "investor"],
    ["Investors’ Conference", "investor"],
    ["투자자의 날", "investor"],
    ["기업설명회", "investor"],
    ["Synthetic shareholders meeting", "corporate"],
    ["Annual Stockholders’ Meeting", "corporate"],
    ["Annual General Meeting", "corporate"],
    ["AGM 2026", "corporate"],
    ["제50기 정기주주총회", "corporate"],
    ["Corporate activities", "corporate"],
    ["Product launch webcast", "other"],
    ["Investor relations webcast", "other"],
    ["General presentation", "other"],
    ["Yearnings for growth", "other"],
    ["AGMatic conference", "other"],
    ["", "other"],
  ] as const)("classifies %s only from its source title", (title, expected) => {
    expect(calendarCategory({ title })).toBe(expected);
  });

  it.each([
    ["10-Q", "Synthetic quarterly report", "filing", "공시"],
    ["10-K", "Presentation included as an exhibit", "filing", "공시"],
    ["press_release", "Synthetic company announcement", "release", "발표자료"],
    ["presentation", "Synthetic investor day materials", "presentation", "프레젠테이션"],
    ["", "Press release: upcoming investor presentation", "release", "발표자료"],
    ["", "News release for quarterly results", "release", "발표자료"],
    ["", "Earnings Release FY26", "release", "발표자료"],
    ["", "신제품 출시 보도자료", "release", "발표자료"],
    ["", "Investor Presentation", "presentation", "프레젠테이션"],
    ["", "Conference slide deck", "presentation", "프레젠테이션"],
    ["", "투자자 데이 발표자료", "presentation", "프레젠테이션"],
    ["", "Form 8-K with earnings release", "filing", "공시"],
    ["", "Form 10-K (FY2026)", "filing", "공시"],
    ["", "Representation agreement", "filing", "공시"],
    ["", "Unclassified source", "filing", "공시"],
    ["", "", "filing", "공시"],
  ] as const)("classifies source category %s and title %s", (category, title, expected, label) => {
    const source = { category, title };
    expect(documentCategory(source)).toBe(expected);
    expect(documentLabel(source)).toBe(label);
  });

  it("does not mutate source metadata while normalizing matching text", () => {
    const source = Object.freeze({ category: "Press_Release", title: "Investor Presentation" });
    expect(documentCategory(source)).toBe("release");
    expect(source).toEqual({ category: "Press_Release", title: "Investor Presentation" });
  });
});
