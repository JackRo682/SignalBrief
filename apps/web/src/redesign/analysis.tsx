"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/components/auth";
import { Icon } from "@/components/icons";
import { approvedDartQuotation } from "@/lib/approved-analysis-display";
import { workspace } from "@/workspace/client";
import {
  companyDetailSchema,
  documentDetailSchema,
} from "@/workspace/contracts";
import { usePrefs } from "@/workspace/preferences";
import { DataState, Notice, useData, useMutation } from "@/workspace/ui";
import {
  DetailPanel,
  DetailRows,
  DetailSource,
  exactDetailValue,
} from "./company";
import "./detail.css";

const saveResult = z.object({ saved: z.boolean() });
type SourceSection = z.infer<typeof documentDetailSchema>["sections"][number];
type Detail = z.infer<typeof documentDetailSchema>;

/** Analysis routes reuse canonical filing IDs; a missing approval never becomes a report. */
export default function AnalysisDetail({
  id,
  kind = "document",
  analysis,
}: {
  id: string;
  kind?: string;
  analysis?: string;
}) {
  const documentKind = kind === "filing" ? "filing" : "document";
  return (
    <DocumentContent
      key={`${documentKind}:${id}:${analysis ?? ""}`}
      id={id}
      kind={documentKind}
      analysis={analysis}
    />
  );
}

function DocumentContent({
  id,
  kind,
  analysis,
}: {
  id: string;
  kind: "document" | "filing";
  analysis?: string;
}) {
  const { token } = useAuth();
  const { text: t, date, value } = usePrefs();
  const result = useData(
    { action: "document_detail", p: { id, kind } },
    documentDetailSchema,
  );
  const action = useMutation();
  const data = result.data,
    document = data?.document;
  const company = useData(
    document ? { action: "company", p: { id: document.company_id } } : null,
    companyDetailSchema,
  );
  const requestedKind =
    analysis === "us"
      ? "us_analysis"
      : analysis === "dart"
        ? "dart_analysis"
        : null;
  const selected = requestedKind
    ? data?.approved_analyses.find(
        (entry) =>
          entry.analysis.status === "approved" &&
          entry.resource.kind === requestedKind,
      )
    : undefined;
  const wantsAnalysis = analysis !== undefined;
  const item = wantsAnalysis ? selected?.resource : document;
  const [saved, setSaved] = useState<{
    token: typeof token;
    id: string;
    kind: string;
    value: boolean;
  } | null>(null);
  const [extraSections, setExtraSections] = useState<SourceSection[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null | undefined>();
  const isSaved =
    saved &&
    saved.token === token &&
    saved.id === item?.id &&
    saved.kind === item?.kind
      ? saved.value
      : (item?.is_saved ?? false);
  const sections = [...(data?.sections ?? []), ...extraSections];
  const next =
    nextOffset === undefined ? data?.next_section_offset : nextOffset;
  const claims = selected?.analysis.result.claims ?? [];
  const visitKind = item?.kind,
    visitId = item?.id;

  useEffect(() => {
    if (token && value.history_enabled && visitKind && visitId) {
      void workspace(
        token,
        { action: "visit", p: { kind: visitKind, id: visitId } },
        z.unknown(),
      ).catch(() => {});
    }
  }, [token, value.history_enabled, visitKind, visitId]);

  function save() {
    if (!item || item.kind === "company") return;
    const saveKind = item.kind;
    void action.run(
      async () => {
        const response = await workspace(
          token,
          {
            action: "save",
            p: { kind: saveKind, id: item.id, saved: !isSaved },
          },
          saveResult,
        );
        setSaved({ token, id: item.id, kind: saveKind, value: response.saved });
      },
      isSaved
        ? t("저장을 취소했습니다.", "Item unsaved.")
        : t("저장했습니다.", "Item saved."),
    );
  }

  function moreSections() {
    if (next == null) return;
    void action.run(async () => {
      const response = await workspace(
        token,
        { action: "document_detail", p: { id, kind, section_offset: next } },
        documentDetailSchema,
      );
      setExtraSections((current) => {
        const seen = new Set(
          [...(data?.sections ?? []), ...current].map((section) => section.id),
        );
        return [
          ...current,
          ...response.sections.filter((section) => !seen.has(section.id)),
        ];
      });
      setNextOffset(response.next_section_offset);
    });
  }

  const relatedAnalyses = (company.data?.analyses ?? []).filter(
    (entry) => !item || entry.kind !== item.kind || entry.id !== item.id,
  );
  return (
    <article
      className="rd-analysis-detail"
      data-testid="redesign-analysis-detail"
    >
      <nav
        className="rd-detail-breadcrumbs"
        aria-label={t("현재 위치", "Breadcrumb")}
      >
        <Link href="/today">{t("홈", "Home")}</Link>
        <span>›</span>
        <Link
          href={
            wantsAnalysis ? "/search?kind=analysis" : "/search?kind=document"
          }
        >
          {wantsAnalysis ? t("분석", "Analyses") : t("공시", "Disclosures")}
        </Link>
        <span>›</span>
        <span>{t("상세", "Details")}</span>
      </nav>
      <DataState {...result} retry={result.reload} />
      <Notice action={action} />
      {data && document && wantsAnalysis && !selected && (
        <DetailPanel
          title={t("공개된 분석이 없습니다", "Published analysis unavailable")}
        >
          <p className="rd-detail-prose">
            {t(
              "요청한 분석이 승인되지 않았거나 더 이상 공개되지 않습니다. 공식 공시는 계속 확인할 수 있습니다.",
              "The requested analysis has not been approved or is no longer published. The official disclosure remains available.",
            )}
          </p>
          <Link
            className="rd-detail-primary"
            href={`/documents/${encodeURIComponent(id)}?kind=${kind}`}
          >
            {t("공시 확인", "Read disclosure")}
          </Link>
        </DetailPanel>
      )}
      {data && document && item && (
        <div className="rd-detail-article-grid">
          <div className="rd-detail-article-main">
            <header className="rd-detail-article-hero">
              <div className="rd-detail-article-meta">
                <span className="rd-detail-badge">
                  {selected
                    ? t("공시 발췌 분석", "Disclosure excerpt analysis")
                    : document.category ||
                      t("공식 공시", "Official disclosure")}
                </span>
                {selected && (
                  <span className="rd-detail-badge rd-detail-approved">
                    {t("승인", "Approved")}
                  </span>
                )}
                <time
                  dateTime={
                    selected?.analysis.created_at ??
                    document.published_at ??
                    undefined
                  }
                >
                  {date(
                    selected?.analysis.created_at ?? document.published_at,
                    selected ? "timestamp" : document.publication_precision,
                  )}
                </time>
              </div>
              <h1>{item.title}</h1>
              {item.summary && (
                <p className="rd-detail-article-deck">{item.summary}</p>
              )}
              <div className="rd-detail-article-actions">
                <DetailSource
                  url={
                    selected?.analysis.result.source_url ?? document.source_url
                  }
                >
                  {t("공식 원문 보기", "Open official source")}
                </DetailSource>
                <button
                  type="button"
                  className="rd-detail-save"
                  disabled={action.busy}
                  aria-pressed={isSaved}
                  onClick={save}
                >
                  <Icon name="star" size={17} />
                  {isSaved ? t("저장됨", "Saved") : t("저장하기", "Save")}
                </button>
              </div>
            </header>
            {selected ? (
              <>
                <section className="rd-detail-article-section">
                  <h2>{t("1. 핵심 요약", "1. Key takeaways")}</h2>
                  {claims.length ? (
                    <ul className="rd-detail-takeaways">
                      {claims.map((claim, index) => (
                        <li key={index}>{claim.text}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rd-detail-empty">
                      {t(
                        "공개 가능한 인용 요약이 없습니다. 공식 원문을 확인하세요.",
                        "No publishable quotation summary is available. Read the official source.",
                      )}
                    </p>
                  )}
                  <p className="rd-detail-footnote">
                    {t(
                      "분석 범위: 보관된 원문의 일부. 승인 상태는 전체 문서에 대한 검토를 의미하지 않습니다.",
                      "Coverage: part of the stored source. Approval does not mean that the complete document has been reviewed.",
                    )}
                  </p>
                </section>
                <section className="rd-detail-article-section">
                  <h2>{t("2. 원문 근거", "2. Source evidence")}</h2>
                  {claims.map((claim, index) => (
                    <article className="rd-detail-citation" key={index}>
                      <h3>
                        {index + 1}. {claim.text}
                      </h3>
                      <blockquote>
                        {selected.resource.kind === "dart_analysis"
                          ? approvedDartQuotation(claim.quote)
                          : claim.quote}
                      </blockquote>
                      <DetailSource url={selected.analysis.result.source_url}>
                        {t("원문과 대조하기", "Compare with the original")}
                      </DetailSource>
                    </article>
                  ))}
                </section>
                <section className="rd-detail-article-section">
                  <h2>
                    {t("3. 기록된 한계와 확인 사항", "3. Recorded limitations")}
                  </h2>
                  <div className="rd-detail-limitations">
                    {selected.analysis.result.uncertainty ? (
                      <p>{selected.analysis.result.uncertainty}</p>
                    ) : (
                      <p>
                        {t(
                          "추가 한계가 기록되지 않았습니다. 해석과 조건은 연결된 원문에서 확인하세요.",
                          "No additional limitation was recorded. Check interpretations and conditions in the linked source.",
                        )}
                      </p>
                    )}
                    {Boolean(selected.analysis.result.omitted_claim_count) && (
                      <p>
                        {t(
                          "수치 근거가 확인되지 않아 제외된 후보",
                          "Candidates omitted because numerical support could not be verified",
                        )}
                        : {selected.analysis.result.omitted_claim_count}
                      </p>
                    )}
                  </div>
                </section>
              </>
            ) : (
              <>
                <section className="rd-detail-article-section">
                  <h2>{t("게시된 요약", "Published summaries")}</h2>
                  {data.summaries.length ? (
                    <ul className="rd-detail-takeaways">
                      {data.summaries.map((summary) => (
                        <li key={`${summary.event_id}:${summary.title}`}>
                          <Link
                            href={`/events/${encodeURIComponent(summary.event_id)}`}
                          >
                            <strong>{summary.title}</strong>
                          </Link>
                          <p>{summary.text}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rd-detail-empty">
                      {t(
                        "게시된 요약이 없습니다.",
                        "No published summary is available.",
                      )}
                    </p>
                  )}
                  {data.approved_analyses.filter(
                    (entry) => entry.analysis.status === "approved",
                  ).length > 0 && (
                    <DetailRows
                      items={data.approved_analyses
                        .filter((entry) => entry.analysis.status === "approved")
                        .map((entry) => entry.resource)}
                      empty=""
                    />
                  )}
                </section>
                <section className="rd-detail-article-section">
                  <h2>
                    {t("원문 근거 구간", "Source evidence sections")}{" "}
                    <small>
                      {sections.length} / {data.sections_total}
                    </small>
                  </h2>
                  {sections.length ? (
                    sections.map((section) => (
                      <details
                        className="rd-detail-source-section"
                        key={section.id}
                      >
                        <summary>
                          <span>{section.title || section.location}</span>
                          <small>
                            {section.location}
                            {section.page_start
                              ? ` · ${t("페이지", "page")} ${section.page_start}${section.page_end && section.page_end !== section.page_start ? `–${section.page_end}` : ""}`
                              : ""}
                          </small>
                        </summary>
                        <div>{section.content}</div>
                      </details>
                    ))
                  ) : (
                    <p className="rd-detail-empty">
                      {t(
                        "공개된 근거 구간이 없습니다. 전체 문서는 공식 원문에서 확인하세요.",
                        "No public evidence sections are available. Read the full document at its official source.",
                      )}
                    </p>
                  )}
                  {next != null && (
                    <button
                      type="button"
                      className="rd-detail-save"
                      disabled={action.busy}
                      onClick={moreSections}
                    >
                      {t("근거 구간 더 보기", "Load more source sections")}
                    </button>
                  )}
                </section>
                {data.facts.length > 0 && (
                  <section className="rd-detail-article-section">
                    <h2>{t("출처에 연결된 수치", "Source-linked figures")}</h2>
                    <div className="rd-detail-source-facts">
                      {data.facts.map((fact) => (
                        <article key={fact.id}>
                          <h3>{fact.field}</h3>
                          <strong>
                            {fact.value_raw === null
                              ? t("수치 미제공", "Value not provided")
                              : exactDetailValue(fact.value_raw)}{" "}
                            {fact.unit}
                          </strong>
                          <p>
                            {[fact.period, fact.basis, fact.location]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          <blockquote>{fact.quote}</blockquote>
                          <DetailSource url={fact.source_url}>
                            {t("원문 확인", "Read source")}
                          </DetailSource>
                        </article>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
          <aside className="rd-detail-article-aside">
            <DetailPanel title={t("빠른 정보", "Quick information")}>
              <dl className="rd-detail-meta-table">
                <div>
                  <dt>{t("기업명", "Company")}</dt>
                  <dd>
                    <Link
                      href={`/companies/${encodeURIComponent(document.company_id)}`}
                    >
                      {document.company_name} ({document.ticker})
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt>{t("문서 유형", "Document type")}</dt>
                  <dd>
                    {selected
                      ? t("공시 발췌 분석", "Disclosure excerpt analysis")
                      : document.category}
                  </dd>
                </div>
                <div>
                  <dt>{t("원문 발행일", "Source published")}</dt>
                  <dd>
                    {date(
                      document.published_at,
                      document.publication_precision,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t("원문 제공자", "Source provider")}</dt>
                  <dd>{data.metadata.provider.toUpperCase()}</dd>
                </div>
                {selected && (
                  <>
                    <div>
                      <dt>{t("분석 생성일", "Analysis created")}</dt>
                      <dd>{date(selected.analysis.created_at)}</dd>
                    </div>
                    <div>
                      <dt>{t("승인 상태", "Review status")}</dt>
                      <dd>
                        <span className="rd-detail-badge rd-detail-approved">
                          {t("승인", "Approved")}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>{t("승인일", "Reviewed")}</dt>
                      <dd>{date(selected.analysis.reviewed_at)}</dd>
                    </div>
                    <div>
                      <dt>{t("분석 범위", "Coverage")}</dt>
                      <dd>{t("원문 일부", "Source excerpt")}</dd>
                    </div>
                  </>
                )}
                {!selected && (
                  <>
                    <div>
                      <dt>{t("파일 형식", "File format")}</dt>
                      <dd>
                        {data.metadata.mime_type ?? t("미제공", "Not provided")}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("페이지 수", "Pages")}</dt>
                      <dd>
                        {data.metadata.page_count ??
                          t("미제공", "Not provided")}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              <Provenance data={data} kind={kind} />
            </DetailPanel>
            <DetailPanel
              title={t("관련 공시", "Related disclosures")}
              action={
                <Link
                  href={`/search?kind=document&company_id=${encodeURIComponent(document.company_id)}`}
                >
                  {t("더보기", "View all")} ›
                </Link>
              }
            >
              <DetailRows
                items={data.related.slice(0, 5)}
                empty={t(
                  "연결된 관련 공시가 없습니다.",
                  "No related disclosures are available.",
                )}
              />
            </DetailPanel>
            <DetailPanel
              title={t("관련 분석", "Related analyses")}
              action={
                <Link
                  href={`/search?kind=analysis&company_id=${encodeURIComponent(document.company_id)}`}
                >
                  {t("더보기", "View all")} ›
                </Link>
              }
            >
              <DataState {...company} retry={company.reload} />
              {company.data && (
                <DetailRows
                  items={relatedAnalyses.slice(0, 5)}
                  empty={t(
                    "다른 승인 분석이 아직 없습니다.",
                    "No other approved analyses are available yet.",
                  )}
                />
              )}
            </DetailPanel>
          </aside>
        </div>
      )}
    </article>
  );
}

function Provenance({
  data,
  kind,
}: {
  data: Detail;
  kind: "document" | "filing";
}) {
  const { text: t, date } = usePrefs();
  return (
    <details className="rd-detail-provenance">
      <summary>{t("출처 및 수집 정보", "Source provenance")}</summary>
      <dl>
        <dt>{t("수집 시각", "Ingested at")}</dt>
        <dd>{date(data.metadata.ingested_at)}</dd>
        <dt>{t("발행 시간대", "Publication timezone")}</dt>
        <dd>
          {data.metadata.publication_timezone ?? t("미제공", "Not provided")}
        </dd>
        {data.metadata.raw_sha256 && (
          <>
            <dt>
              {kind === "filing"
                ? t("제출 목록 SHA-256", "Submission-list SHA-256")
                : t("원문 SHA-256", "Document SHA-256")}
            </dt>
            <dd>{data.metadata.raw_sha256}</dd>
          </>
        )}
      </dl>
    </details>
  );
}
