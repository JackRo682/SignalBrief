import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanyIntroduction } from "../src/components/company-introduction";
import { companyIntroduction, officialCompanyOverviewSchema } from "../src/lib/company-overview";
import { resourceSchema } from "../src/workspace/contracts";

vi.mock("@/workspace/preferences", () => ({
  usePrefs: () => ({ text: (ko: string) => ko, date: (value: string) => value, value: { locale: "ko" } }),
}));
const id = "20000000-0000-4000-8000-000000000001";
const overview = officialCompanyOverviewSchema.parse({
  kind: "profile", provider: "OpenDART", company_id: id, provider_company_id: "12345678",
  ticker: "0068Y0", name: "합성 기업", english_name: "Synthetic issuer",
  industry_description: null, industry_code: "12345", established_on: "2020-02-29",
  ceo: "합성 대표", website: "https://company.example.invalid/",
  source_url: "https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019002",
  source_sha256: "d".repeat(64), fetched_at: "2026-10-18T09:30:00Z",
});
const company = resourceSchema.parse({
  id, company_id: id, kind: "company", title: "합성 기업", company_name: "합성 기업",
  ticker: "0068Y0", summary: "", market: "KOSPI", source_url: null, published_at: null,
  publication_precision: "timestamp", category: "company", is_saved: false, official_overview: overview,
});
afterEach(cleanup);

describe("official company factual introduction", () => {
  it("formats verified profile fields without turning an industry code into a business claim", () => {
    const intro = companyIntroduction(company)!;
    expect(intro.text).toContain("합성 기업 (Synthetic issuer)");
    expect(intro.text).toContain("공시 업종 코드는 12345");
    expect(intro.text).toContain("설립일은 2020-02-29");
    expect(intro.text).toContain("대표자는 합성 대표");
    expect(intro.label).toBe("공식 기업 기본정보");
    expect(intro.source_sha256).toBe("d".repeat(64));
    expect(intro).not.toHaveProperty("products");
  });

  it("uses an official industry description when present while keeping missing SEC fields absent", () => {
    const intro = companyIntroduction({ ...company, official_overview: {
      ...overview, provider: "SEC EDGAR", industry_description: "Synthetic official industry", ceo: null, established_on: null,
    } }, 1)!;
    expect(intro.text).toContain("SEC EDGAR industry classification: Synthetic official industry");
    expect(intro.text).not.toContain("Established");
    expect(intro.text).not.toContain("representative");
    expect(intro.text).not.toContain("12345");
  });

  it("labels pre-hydration directory facts distinctly without claiming a business overview", () => {
    const intro = companyIntroduction({ ...company, official_overview: { ...overview, kind: "directory" } })!;
    expect(intro.label).toBe("공식 기업목록 정보");
    expect(intro.text).toContain("OpenDART 공식 기업목록");
    expect(intro.text).not.toContain("합성 대표");
    expect(intro.text).not.toContain("12345");
  });

  it("never attaches another issuer's source facts to the current company", () => {
    expect(companyIntroduction({ ...company, id: "20000000-0000-4000-8000-000000000099" })).toBeNull();
    expect(companyIntroduction({ ...company, ticker: "0017J0" })).toBeNull();
    expect(companyIntroduction({ ...company, official_overview: null })).toBeNull();
  });

  it.each([
    { source_sha256: "not-a-hash" }, { source_url: "https://user:secret@example.invalid/" },
    { source_url: "javascript:alert(1)" }, { fetched_at: "not-a-date" }, { ceo: { injected: true } },
  ])("rejects invalid source metadata or profile field types", (change) => {
    expect(officialCompanyOverviewSchema.safeParse({ ...overview, ...change }).success).toBe(false);
  });

  it("renders the official source and actual retrieval time without fetching per card", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      render(<CompanyIntroduction company={company} />);
      expect(screen.getByText(/설립일은 2020-02-29/)).toBeVisible();
      expect(screen.getByRole("link", { name: "공식 기업 기본정보 · OpenDART" })).toHaveAttribute("href", overview.source_url);
      expect(screen.getByText(/2026-10-18T09:30:00Z/)).toBeVisible();
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
});
