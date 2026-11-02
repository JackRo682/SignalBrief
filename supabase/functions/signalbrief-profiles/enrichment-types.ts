/** Additive public profile contract. Values are source excerpts, not model-generated claims. */
export type ProfileSource = {
  id: string;
  provider: 'SEC EDGAR' | 'OpenDART' | 'Official company';
  source_url: string;
  source_sha256: string;
  fetched_at: string;
  published_on: string | null;
  publication_precision: 'date' | 'unknown';
  report_period: string | null;
  form_type: string | null;
  title: string;
  /** Normalization is deterministic; offsets below refer to this version's visible text. */
  normalization: 'profile-visible-text-v1' | 'dart-periodic-xml-text-v1' | 'dart-periodic-recovered-text-v1';
  normalized_sha256?: string;
  publication_timezone?: 'Asia/Seoul';
};

export type ProfileEvidence = {
  source_id: string;
  quote: string;
  location: { kind: 'normalized_text'; start: number; end: number; section: string };
};

export type ProfileLeadership = {
  name: string;
  role: string;
  /** Filing date or official-page retrieval date; this is never an assertion of a live appointment. */
  as_of: string;
  basis: 'filing' | 'official_page' | 'official_registry';
  evidence: ProfileEvidence;
};

export type ProfileFormation = {
  kind: 'founded' | 'incorporated' | 'reorganized' | 'established';
  /** ISO date, YYYY-MM, or YYYY, matching precision. Never pad an unknown month/day. */
  date: string;
  precision: 'day' | 'month' | 'year';
  evidence: ProfileEvidence;
};

export type ProfileBusinessExcerpt = { text: string; evidence: ProfileEvidence };
export type ProfileBusinessItem = { name: string; description: string | null; evidence: ProfileEvidence };

export type ProfileEnrichment = {
  schema: 'signalbrief.company-profile.v1';
  company_id: string;
  status: 'ready' | 'partial' | 'not_available' | 'unavailable';
  checked_at: string;
  next_refresh_at: string;
  sources: ProfileSource[];
  leadership: ProfileLeadership[];
  formation: ProfileFormation[];
  business: ProfileBusinessExcerpt[];
  products: ProfileBusinessItem[];
  segments: ProfileBusinessItem[];
  /** Fixed codes only; never raw exceptions, credentials, or credential-bearing URLs. */
  limitations: string[];
  last_error: string | null;
};

/** Private persisted source metadata; object keys are not part of the browser response. */
export type ProfileArchivedSource = ProfileSource & {
  object_key: string;
  provider_company_id: string;
  ticker: string;
  normalized_text: string;
  normalized_object_key?: string;
  filing_id?: string;
};

export type ProfileEnrichmentSnapshot = {
  result: ProfileEnrichment;
  archives: ProfileArchivedSource[];
};
