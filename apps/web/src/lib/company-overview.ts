import { z } from "zod";

const httpsURL = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
});
const optionalField = z.string().min(1).max(1000).nullable();
export const officialCompanyOverviewSchema = z.object({
  kind: z.enum(["profile", "directory"]),
  provider: z.enum(["OpenDART", "SEC EDGAR"]),
  company_id: z.string().uuid(),
  provider_company_id: z.string(),
  ticker: z.string(),
  name: z.string().min(1).max(500),
  english_name: optionalField,
  industry_description: optionalField,
  industry_code: optionalField,
  established_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  ceo: optionalField,
  website: httpsURL.nullable(),
  source_url: httpsURL,
  source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  fetched_at: z.string().datetime({ offset: true }),
});
export type OfficialCompanyOverview = z.infer<typeof officialCompanyOverviewSchema>;

/** Only formats fields already tied to a verified official issuer snapshot. */
export function companyIntroduction(
  resource: { id: string; ticker: string; official_overview?: OfficialCompanyOverview | null },
  locale: 0 | 1 = 0,
) {
  const data = resource.official_overview;
  if (!data || data.company_id !== resource.id || data.ticker !== resource.ticker) return null;
  const name = data.english_name && data.english_name !== data.name
    ? `${data.name} (${data.english_name})`
    : data.name;
  if (data.kind === "directory") {
    return {
      ...data,
      label: locale ? "Official registry information" : "공식 기업목록 정보",
      text: locale
        ? `${name} is identified in the ${data.provider} company directory under ticker ${data.ticker}.`
        : `${name}은 ${data.provider} 공식 기업목록에서 종목 코드 ${data.ticker}로 확인된 기업입니다.`,
    };
  }
  const facts = [locale
    ? `${name} (ticker ${data.ticker}).`
    : `${name}(종목 코드 ${data.ticker})의 공식 기업 기본정보입니다.`];
  if (data.industry_description) facts.push(locale
    ? `${data.provider} industry classification: ${data.industry_description}.`
    : `${data.provider} 업종 분류는 ${data.industry_description}입니다.`);
  else if (data.industry_code) facts.push(locale
    ? `Official industry code: ${data.industry_code}.`
    : `공시 업종 코드는 ${data.industry_code}입니다.`);
  if (data.established_on) facts.push(locale
    ? `Established on ${data.established_on}.`
    : `설립일은 ${data.established_on}입니다.`);
  if (data.ceo) facts.push(locale
    ? `Registered representative: ${data.ceo}.`
    : `대표자는 ${data.ceo}입니다.`);
  return { ...data, label: locale ? "Official company facts" : "공식 기업 기본정보", text: facts.join(" ") };
}
