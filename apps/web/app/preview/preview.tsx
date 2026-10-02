"use client";

import Link from "next/link";
import { type ReactNode, useRef, useState } from "react";
import { companies, events, headings, type Screen, screens } from "./fixtures";
import { useDemo } from "./provider";

type Scenario =
  | "normal"
  | "loading"
  | "empty"
  | "error"
  | "stale"
  | "correction"
  | "conflict"
  | "withdrawn"
  | "unauthorized";
const scenarios: { id: Scenario; label: string }[] = [
  { id: "normal", label: "기본 화면" },
  { id: "loading", label: "불러오는 중" },
  { id: "empty", label: "정보 없음" },
  { id: "error", label: "불러오기 실패" },
  { id: "stale", label: "자료 지연" },
  { id: "correction", label: "정정 안내" },
  { id: "conflict", label: "근거 상충" },
  { id: "withdrawn", label: "철회 안내" },
  { id: "unauthorized", label: "권한 없음" },
];

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}
function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`tag ${tone}`}>{children}</span>;
}
function CompanyMark({ id }: { id: string }) {
  const company = companies.find((item) => item.id === id) ?? companies[0];
  return (
    <span aria-hidden="true" className={`company-mark ${company.color}`}>
      {company.mark}
    </span>
  );
}
function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`panel ${className}`}>{children}</section>;
}
function SectionLabel({
  number,
  children,
}: {
  number: string;
  children: ReactNode;
}) {
  return (
    <div className="section-label">
      <span>{number}</span>
      <h2>{children}</h2>
    </div>
  );
}

export default function Preview({
  screen,
  eventId = "moabit-review",
}: {
  screen: Screen;
  eventId?: string;
}) {
  const demo = useDemo();
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("전체");
  const [sourceSide, setSourceSide] = useState("현재");
  const [question, setQuestion] = useState("어떤 기간을 비교했나요?");
  const [answer, setAnswer] = useState(false);
  const [alerts, setAlerts] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [weights, setWeights] = useState<Record<string, string>>({
    moabit: "",
    pureun: "",
  });
  const [portfolioError, setPortfolioError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const event = events.find((item) => item.id === eventId) ?? events[0];
  const company =
    companies.find((item) => item.id === event.company) ?? companies[0];
  const header = headings[screen];
  const eventPath = `/events/${event.id}`;
  const notify = (text: string) =>
    setMessage(`${text} · 실제 연결·서버 저장은 없습니다.`);

  const nav = (
    <>
      {["살펴보기", "화면 둘러보기", "시작 · 설정"].map((group) => (
        <div className="nav-group" key={group}>
          <p>{group}</p>
          {screens
            .filter((item) => item.group === group)
            .map((item) => (
              <Link
                href={item.path}
                key={item.path}
                aria-current={item.screen === screen ? "page" : undefined}
                className={`nav-link ${item.screen === screen ? "active" : ""}`}
              >
                <span className="nav-dot" aria-hidden="true" />
                {item.label}
                {["portfolio", "calendar", "alerts", "question"].includes(
                  item.screen,
                ) && <small>P1</small>}
              </Link>
            ))}
        </div>
      ))}
    </>
  );
  const notices = (
    <div className="accuracy-notice">
      <span className="notice-symbol" aria-hidden="true">
        !
      </span>
      <div>
        <strong>정확성 안내도 놓치지 않도록</strong>
        <p>
          예시 자료 1건의 표현이 정정되었습니다. 선택 알림을 꺼도 이 안내는
          표시됩니다.
        </p>
        <details>
          <summary>정정 이력 보기 · 예시</summary>
          <p>
            가상 자료 revision 1 → 2 · 예시 기준 1월 15일. 이전 표현은
            재노출하지 않습니다.
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setAcknowledged(true);
              notify("이 탭에서 정정 예시를 확인했습니다");
            }}
          >
            {acknowledged ? "확인한 예시 · 이력은 계속 표시" : "예시 안내 확인"}
          </button>
        </details>
      </div>
      <Tag tone="amber">정정 예시</Tag>
    </div>
  );
  const unavailable = (
    <Panel className="empty-state">
      <span className="empty-symbol" aria-hidden="true">
        ○
      </span>
      <h2>
        {scenario === "loading"
          ? "화면을 불러오는 모습입니다"
          : scenario === "error"
            ? "잠시 멈춘 장면도, 명확하게"
            : scenario === "withdrawn"
              ? "철회된 설명은 표시하지 않습니다"
              : scenario === "unauthorized"
                ? "접근할 수 없는 화면의 예시입니다"
                : "아직 보여드릴 정보가 없습니다"}
      </h2>
      <p>
        {scenario === "loading"
          ? "네트워크 작업 없이 로딩 UI만 보여줍니다. 상태를 바꾸면 다른 화면을 볼 수 있습니다."
          : scenario === "error"
            ? "예시 오류 DEMO-01 · 입력과 선택은 이 화면에서 유지됩니다."
            : scenario === "withdrawn"
              ? "안전하지 않은 이전 설명 대신 철회 안내와 근거 위치만 남기는 장면입니다."
              : scenario === "unauthorized"
                ? "실제 권한 검증이 아닌 403 화면 데모입니다. 운영 화면은 인증 서비스를 대체하지 않습니다."
                : screen === "today"
                  ? "조건에 맞는 변화가 없는 조용한 날의 예시입니다. 회사에 아무 사건도 없었다는 뜻은 아닙니다."
                  : "자료 없음·범위 밖·불러오기 실패를 같은 상태로 취급하지 않습니다."}
      </p>
      {scenario === "loading" && (
        <div className="skeleton-stack" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      )}
      <button
        type="button"
        className="button"
        onClick={() => {
          setScenario("normal");
          notify(
            scenario === "error"
              ? "예시 재시도 화면으로 돌아갑니다"
              : "기본 예시로 돌아갑니다",
          );
        }}
      >
        {scenario === "error" ? "예시 다시 시도" : "기본 화면 보기"}
      </button>
      {scenario === "withdrawn" && (
        <Link className="button secondary" href={`${eventPath}/evidence`}>
          예시 근거 위치 보기
        </Link>
      )}
    </Panel>
  );

  function renderScreen() {
    if (
      ["loading", "empty", "error", "withdrawn", "unauthorized"].includes(
        scenario,
      )
    )
      return unavailable;
    if (screen === "today") {
      const shown = events.filter(
        (item) =>
          demo.followed.includes(item.company) &&
          (filter === "전체" || item.tag === filter),
      );
      return (
        <div className="today-layout">
          <div>
            <div className="section-row">
              <h2>
                먼저 살펴볼 변화 <span className="count">{shown.length}</span>
              </h2>
              <span className="muted">모두 합성 예시</span>
            </div>
            <fieldset className="filters" aria-label="사건 유형 필터">
              {["전체", "실적", "자본 배분", "중요 위험"].map((tag) => (
                <button
                  type="button"
                  key={tag}
                  aria-pressed={filter === tag}
                  className={filter === tag ? "selected" : ""}
                  onClick={() => setFilter(tag)}
                >
                  {tag}
                </button>
              ))}
            </fieldset>
            {shown.length ? (
              shown.map((item, index) => (
                <Panel
                  className={`event-card ${index === 0 ? "featured" : ""}`}
                  key={item.id}
                >
                  <div className="card-top">
                    <div className="company-line">
                      <CompanyMark id={item.company} />
                      <div>
                        <strong>
                          {companies.find((c) => c.id === item.company)?.name}{" "}
                          <small>(가상)</small>
                        </strong>
                        <span>{item.why}</span>
                      </div>
                    </div>
                    <Tag>{item.tag}</Tag>
                  </div>
                  <h3>
                    <Link href={`/events/${item.id}`}>{item.title}</Link>
                  </h3>
                  <p className="event-summary">{item.summary}</p>
                  {index === 0 && (
                    <div className="mini-comparison">
                      <div>
                        <span>이전 예시 · 2025년 3분기</span>
                        <strong>
                          {item.before}
                          <small> {item.unit}</small>
                        </strong>
                      </div>
                      <span aria-hidden="true">→</span>
                      <div>
                        <span>현재 예시 · 2025년 4분기</span>
                        <strong>
                          {item.after}
                          <small> {item.unit}</small>
                        </strong>
                      </div>
                      <Tag tone="mint">변화 예시 {item.delta}</Tag>
                    </div>
                  )}
                  <div className="card-bottom">
                    <span className="meta-line">
                      예시 1월 15일 {item.time} <span>·</span> {item.status}{" "}
                      <span>·</span> 합성 근거 2개
                    </span>
                    <Link href={`/events/${item.id}`} className="text-link">
                      맥락 살펴보기 <Arrow />
                    </Link>
                  </div>
                </Panel>
              ))
            ) : (
              <Panel className="empty-state">
                <h3>선택한 조건의 예시가 없습니다</h3>
                <p>필터를 지우거나 관심 기업을 다시 골라보세요.</p>
                <button
                  type="button"
                  className="button"
                  onClick={() => setFilter("전체")}
                >
                  필터 지우기
                </button>
                <Link className="text-link" href="/watchlist">
                  관심 기업 고르기
                </Link>
              </Panel>
            )}
          </div>
          <aside className="reading-rail">
            <Panel className="dark-panel">
              <div className="rail-icon" aria-hidden="true">
                ↗
              </div>
              <p className="eyebrow">A CALMER WAY TO READ</p>
              <h2>
                정보를 더 많이.
                <br />
                판단은 더 차분하게.
              </h2>
              <p>
                무엇이 바뀌었는지 먼저 읽고,
                <br />그 이유와 한계를 함께 봅니다.
              </p>
              <ol>
                <li>
                  <span>01</span> 바뀐 사실
                </li>
                <li>
                  <span>02</span> 같은 기준의 비교
                </li>
                <li>
                  <span>03</span> 원래 근거와 남은 질문
                </li>
              </ol>
              <Link href="/onboarding">
                읽는 기준 알아보기 <Arrow />
              </Link>
            </Panel>
            <Panel>
              <h3>내 관심 기업</h3>
              <p className="muted">
                이 탭의 예시 선택 · {demo.followed.length}개
              </p>
              <div className="watch-mini">
                {companies
                  .filter((c) => demo.followed.includes(c.id))
                  .map((c) => (
                    <div key={c.id}>
                      <CompanyMark id={c.id} />
                      <span>
                        {c.name}
                        <small>가상 기업</small>
                      </span>
                      <span className="status-dot" aria-hidden="true" />
                    </div>
                  ))}
              </div>
              <Link href="/watchlist" className="text-link">
                예시 목록 편집 <Arrow />
              </Link>
            </Panel>
            <p className="rail-note">
              수익률·주가 영향·매수/매도 판단을 제공하지 않습니다.
            </p>
          </aside>
        </div>
      );
    }
    if (screen === "event")
      return (
        <>
          <Link href="/today" className="back-link">
            ← 오늘의 변화
          </Link>
          <Panel className="detail-hero">
            <div className="company-line">
              <CompanyMark id={company.id} />
              <div>
                <strong>{company.name} (가상)</strong>
                <span>예시 자료 · revision 2 · 2026.01.15</span>
              </div>
            </div>
            <h2>{event.title}</h2>
            <p>{event.summary}</p>
            <div className="tags">
              <Tag tone="mint">합성 자료 · 검증 결과 아님</Tag>
              <Tag>{event.status}</Tag>
            </div>
          </Panel>
          <div className="detail-grid">
            <div>
              <Panel>
                <SectionLabel number="01">무엇이 바뀌었나요?</SectionLabel>
                <table className="comparison-table" aria-label="합성 예시 비교">
                  <thead>
                    <tr className="comparison-head">
                      <th scope="col">비교 기준</th>
                      <th scope="col">이전</th>
                      <th scope="col">현재</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">{event.metric}</th>
                      <td>
                        <small>
                          {event.company === "moabit"
                            ? "2025년 3분기 · 예시"
                            : "이전 합성 자료 · 예시"}
                        </small>
                        {event.before} {event.unit}
                      </td>
                      <td>
                        <small>
                          {event.company === "moabit"
                            ? "2025년 4분기 · 예시"
                            : "현재 합성 자료 · 예시"}
                        </small>
                        {event.after} {event.unit}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="fine-print">
                  기준: 가상 기업 · 연결 기준 · 예시 회계 기준 · 가상 단위. 실제
                  통화·실적이 아닙니다.
                </p>
                <Link className="citation" href={`${eventPath}/evidence`}>
                  [1] 현재 합성 문서 ↗
                </Link>{" "}
                <Link className="citation" href={`${eventPath}/evidence`}>
                  [2] 이전 합성 문서 ↗
                </Link>
              </Panel>
              <Panel>
                <SectionLabel number="02">왜 살펴볼 만한가요?</SectionLabel>
                <Tag tone="blue">해석 예시 · 사실과 구분</Tag>
                <p className="body-copy">{event.explanation}</p>
                <div className="insight-note">
                  <strong>아직 모르는 점</strong>
                  <p>
                    실제 자료가 아니므로 회사의 상황이나 향후 성과를 판단할 수
                    없습니다. 비교 조건이 달라지면 수치 비교도 멈춥니다.
                  </p>
                </div>
              </Panel>
              <Panel>
                <SectionLabel number="03">다음 확인 포인트</SectionLabel>
                <p className="check-point">
                  <span aria-hidden="true">◎</span>
                  {event.next}
                </p>
                <Link href={`${eventPath}/question`} className="text-link">
                  이 사건에 질문해 보는 화면 <Arrow />
                </Link>
              </Panel>
            </div>
            <aside>
              <Panel>
                <h3>근거부터 확인하기</h3>
                <p>표현의 원문과 기간·단위·위치를 함께 봅니다.</p>
                <Link className="button" href={`${eventPath}/evidence`}>
                  근거 패널 열기 <Arrow />
                </Link>
                <Link
                  className="text-link block-link"
                  href={`/companies/${company.id}/timeline`}
                >
                  이전 자료 흐름 보기
                </Link>
              </Panel>
              <Panel>
                <h3>이 설명에 대한 의견</h3>
                <p className="fine-print">
                  기록되지 않는 버튼 반응 예시입니다.
                </p>
                <div className="button-row">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => notify("도움 됨 버튼 반응 예시입니다")}
                  >
                    도움 됨
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      notify("신고 접수는 미연결입니다. 전송하지 않았습니다")
                    }
                  >
                    오류 알리기
                  </button>
                </div>
              </Panel>
            </aside>
          </div>
        </>
      );
    if (screen === "evidence")
      return (
        <>
          <Link className="back-link" href={eventPath}>
            ← 상세로 돌아가기
          </Link>
          <div className="detail-grid">
            <Panel className="evidence-paper">
              <Tag tone="mint">합성 원문 · 실제 출처 아님</Tag>
              <h2>
                {event.metric} 예시 {event.before} → {event.after}의 근거
              </h2>
              <fieldset className="filters" aria-label="이전 현재 근거">
                {["현재", "이전"].map((side) => (
                  <button
                    key={side}
                    type="button"
                    aria-pressed={sourceSide === side}
                    className={sourceSide === side ? "selected" : ""}
                    onClick={() => setSourceSide(side)}
                  >
                    {side} 합성 문서
                  </button>
                ))}
              </fieldset>
              <blockquote>
                <span className="quote-label">
                  가상 문서 {sourceSide === "현재" ? "A" : "B"} · 원문 예시
                </span>
                “모아빛 테크의 {sourceSide === "현재" ? "4" : "3"}분기 매출
                예시는{" "}
                <mark>
                  {sourceSide === "현재" ? event.after : event.before}{" "}
                  {event.unit}
                </mark>
                입니다. 이 문장은 UI 검증을 위해 작성된 합성 자료이며 실제 기업
                공시가 아닙니다.”
              </blockquote>
              <dl className="source-metadata">
                <div>
                  <dt>기업</dt>
                  <dd>{company.name} (가상)</dd>
                </div>
                <div>
                  <dt>자료 위치</dt>
                  <dd>예시 2쪽 · 표 1 · 매출 행</dd>
                </div>
                <div>
                  <dt>보고 기간</dt>
                  <dd>2025년 {sourceSide === "현재" ? "4" : "3"}분기 · 예시</dd>
                </div>
                <div>
                  <dt>기준과 단위</dt>
                  <dd>연결 · 가상 회계 기준 · 가상 단위</dd>
                </div>
                <div>
                  <dt>출처 상태</dt>
                  <dd>합성 자료 · 실제 외부 링크 없음</dd>
                </div>
                <div>
                  <dt>원문 언어</dt>
                  <dd>한국어 · 번역되지 않은 예시</dd>
                </div>
              </dl>
              <button
                className="button secondary"
                type="button"
                onClick={() =>
                  notify(
                    "실제 원문 링크는 없습니다. 합성 문서 화면만 제공합니다",
                  )
                }
              >
                원문 열기 · 미연결 <Arrow />
              </button>
            </Panel>
            <aside>
              <Panel>
                <h3>근거를 읽는 세 가지 기준</h3>
                <ol className="steps">
                  <li>같은 기업인가요?</li>
                  <li>기간과 회계 기준이 같나요?</li>
                  <li>숫자와 문장의 범위가 일치하나요?</li>
                </ol>
                <p className="fine-print">
                  출처가 있다는 것만으로 모든 해석이 참이라는 뜻은 아닙니다.
                </p>
              </Panel>
              <Panel>
                <h3>다른 근거와의 관계</h3>
                <p>
                  {scenario === "conflict"
                    ? "합성 문서 A와 C의 값이 다릅니다. 두 표현을 따로 표시하고 결론을 보류합니다."
                    : "현재와 이전 자료를 나란히 확인합니다. 비교를 위해 양쪽 근거가 필요합니다."}
                </p>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setScenario("conflict")}
                >
                  상충하는 근거 장면 보기
                </button>
              </Panel>
            </aside>
          </div>
        </>
      );
    if (screen === "timeline")
      return (
        <>
          <Panel className="company-summary">
            <CompanyMark id={company.id} />
            <div>
              <h2>
                {company.name} <span className="muted">(가상)</span>
              </h2>
              <p>예시 자료 범위: 2025년 7월부터 · 실제 수집 이력 없음</p>
            </div>
            <Link className="button secondary" href="/watchlist">
              예시 관심 목록
            </Link>
          </Panel>
          <Panel>
            <div className="section-row">
              <h2>자료와 정정의 흐름</h2>
              <Tag>합성 타임라인</Tag>
            </div>
            <div className="timeline">
              {[
                {
                  date: "2026.01.15",
                  title: "정정된 설명 · revision 2",
                  text: "이전 표현을 다시 노출하지 않고 정정 이력을 남기는 예시입니다.",
                  tag: "정정",
                },
                {
                  date: "2026.01.14",
                  title: "4분기 자료 예시 공개",
                  text: "이전 분기와 같은 기준인지 확인하는 장면입니다.",
                  tag: "실적",
                },
                {
                  date: "2025.10.15",
                  title: "3분기 자료 예시",
                  text: "비교의 기준이 되는 합성 자료입니다.",
                  tag: "이전 근거",
                },
                {
                  date: "2025.07.01",
                  title: "예시 자료 범위 시작",
                  text: "더 이전의 정보가 없다는 사실을 명확히 표시합니다.",
                  tag: "범위",
                },
              ].map((item) => (
                <article className="timeline-item" key={item.date}>
                  <time>{item.date}</time>
                  <div>
                    <Tag>{item.tag}</Tag>
                    <h3>{item.title}</h3>
                    <p>{item.text}</p>
                    <Link href={eventPath} className="text-link">
                      예시 내용 보기 <Arrow />
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        </>
      );
    if (screen === "login")
      return (
        <div className="welcome-grid">
          <Panel className="welcome-art dark-panel">
            <p className="eyebrow">LESS NOISE. MORE CONTEXT.</p>
            <h2>
              많은 정보 사이에서,
              <br />
              놓치고 싶지 않은 변화.
            </h2>
            <div className="signal-lines" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <p>
              사실 → 근거 → 비교 → 해석 → 불확실성.
              <br />이 순서로 정보를 읽습니다.
            </p>
          </Panel>
          <Panel className="form-panel">
            <Tag tone="amber">로그인 미연결</Tag>
            <h2>SignalBrief 시작하기</h2>
            <p>
              이 미리보기는 계정 없이 둘러볼 수 있습니다. 실제 Google 로그인이나
              계정 생성은 실행되지 않습니다.
            </p>
            <button
              type="button"
              className="button google-button"
              onClick={() =>
                notify(
                  "Google 로그인은 미연결입니다. 인증 창이나 계정을 만들지 않았습니다",
                )
              }
            >
              <span aria-hidden="true">G</span>Google로 시작 · 화면 예시
            </button>
            <Link className="button" href="/onboarding">
              계정 없이 예시 둘러보기 <Arrow />
            </Link>
            <p className="fine-print">
              비밀번호·개인정보·API key를 입력할 필요가 없습니다.
            </p>
            <Link href="/settings" className="text-link">
              정보 범위와 개인정보 안내
            </Link>
          </Panel>
        </div>
      );
    if (screen === "onboarding")
      return (
        <div className="detail-grid">
          <Panel className="form-panel">
            <Tag tone="mint">이 탭에서만 바뀌는 예시</Tag>
            <h2>어떻게 읽으면 좋을까요?</h2>
            <div className="principles">
              <div>
                <span>01</span>
                <h3>사실과 해석을 나누어</h3>
                <p>공개된 표현과 가능한 해석을 다른 구역에 보여줍니다.</p>
              </div>
              <div>
                <span>02</span>
                <h3>비교가 어려우면, 그대로</h3>
                <p>기간·단위·기준이 다르면 숫자를 억지로 비교하지 않습니다.</p>
              </div>
              <div>
                <span>03</span>
                <h3>모르는 점도 함께</h3>
                <p>
                  자료 지연, 근거 상충, 이전 정보 없음은 각각 다른 상태입니다.
                </p>
              </div>
            </div>
            <label className="field-label" htmlFor="onboard-timezone">
              예시 시간대
            </label>
            <select
              id="onboard-timezone"
              value={demo.timezone}
              onChange={(e) => demo.setTimezone(e.target.value)}
            >
              <option value="Asia/Seoul">서울 · Asia/Seoul</option>
              <option value="Etc/UTC">UTC · Etc/UTC</option>
            </select>
            <label className="check-label">
              <input
                type="checkbox"
                checked={demo.analytics}
                onChange={(e) => demo.setAnalytics(e.target.checked)}
              />
              선택 분석 동의 화면 예시 · 전송 없음
            </label>
            <Link className="button" href="/watchlist">
              가상 관심 기업 고르기 <Arrow />
            </Link>
          </Panel>
          <Panel>
            <h3>이 미리보기의 범위</h3>
            <p>
              13개 화면의 흐름과 상태를 살펴볼 수 있습니다. 실제 기업 정보·투자
              판단·서버 기능은 제공하지 않습니다.
            </p>
            <ul className="plain-list">
              <li>가상 기업과 합성 자료만 사용</li>
              <li>브로커·계좌·실제 보유 정보 미연결</li>
              <li>페이지 새로고침 시 예시 설정 초기화</li>
            </ul>
          </Panel>
        </div>
      );
    if (screen === "watchlist")
      return (
        <div className="detail-grid">
          <Panel>
            <div className="section-row">
              <h2>가상 기업 찾기</h2>
              <Tag>예시 {demo.followed.length} / 30</Tag>
            </div>
            <label className="field-label" htmlFor="company-search">
              가상 기업 이름 검색
            </label>
            <div className="search-field">
              <span aria-hidden="true">⌕</span>
              <input
                id="company-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="모아빛, 푸른결, 온유, 달이"
                maxLength={40}
              />
            </div>
            <p className="fine-print">
              가상 기업 이름으로만 검색하세요. 실제 기업을 저장하거나 수집하지
              않습니다.
            </p>
            <div className="company-list">
              {companies
                .filter((c) => c.name.includes(search.trim()))
                .map((c) => (
                  <article key={c.id}>
                    <CompanyMark id={c.id} />
                    <div>
                      <strong>{c.name} (가상)</strong>
                      <p>{c.sector} · 합성 자료 범위만 제공</p>
                    </div>
                    <button
                      type="button"
                      className={`button ${demo.followed.includes(c.id) ? "secondary" : ""}`}
                      aria-label={`${c.name} ${demo.followed.includes(c.id) ? "예시 관심 해제" : "예시 관심 추가"}`}
                      onClick={() =>
                        demo.setFollowed((ids) =>
                          ids.includes(c.id)
                            ? ids.filter((id) => id !== c.id)
                            : [...ids, c.id],
                        )
                      }
                    >
                      {demo.followed.includes(c.id)
                        ? "선택됨 · 해제"
                        : "+ 예시 추가"}
                    </button>
                  </article>
                ))}
            </div>
            {!companies.some((c) => c.name.includes(search.trim())) && (
              <div className="insight-note">
                <h3>가상 목록에 없는 이름입니다</h3>
                <p>실제 기업 검색과 지원 요청은 미연결입니다.</p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setSearch("")}
                >
                  검색 지우기
                </button>
              </div>
            )}
          </Panel>
          <Panel>
            <h3>선택한 예시 기업</h3>
            <p>{demo.followed.length}개 · 이 탭 메모리에만 유지됩니다.</p>
            <div className="watch-mini">
              {companies
                .filter((c) => demo.followed.includes(c.id))
                .map((c) => (
                  <div key={c.id}>
                    <CompanyMark id={c.id} />
                    <span>
                      {c.name}
                      <small>가상 기업</small>
                    </span>
                  </div>
                ))}
            </div>
            {demo.followed.length ? (
              <Link href="/today" className="button">
                오늘의 변화 예시 보기 <Arrow />
              </Link>
            ) : (
              <p className="insight-note">
                예시 기업을 하나 이상 선택해 주세요.
              </p>
            )}
          </Panel>
        </div>
      );
    if (screen === "portfolio")
      return (
        <Panel>
          <div className="section-row">
            <h2>선택 기능 · 가상 포트폴리오</h2>
            <Tag tone="blue">실제 보유 입력 금지</Tag>
          </div>
          <p>
            계좌 연결·수량·원가·손익 입력 없이 예시 비중 UI만 체험합니다. 빈
            비중은 0이 아닌 ‘모름’입니다.
          </p>
          <div className="portfolio-list">
            {companies.slice(0, 2).map((c) => (
              <div key={c.id}>
                <div className="company-line">
                  <CompanyMark id={c.id} />
                  <strong>{c.name} (가상)</strong>
                </div>
                <div>
                  <label htmlFor={`weight-${c.id}`}>예시 비중 (%) · 선택</label>
                  <div className="weight-field">
                    <input
                      id={`weight-${c.id}`}
                      inputMode="decimal"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={weights[c.id]}
                      onChange={(e) =>
                        setWeights((current) => ({
                          ...current,
                          [c.id]: e.target.value,
                        }))
                      }
                      placeholder="모름"
                    />
                    <span>%</span>
                  </div>
                </div>
                <Tag>
                  {weights[c.id] === "" ? "비중 모름" : "수정 중인 예시"}
                </Tag>
              </div>
            ))}
          </div>
          <div className="insight-note">
            <strong>
              합계 예시:{" "}
              {Object.values(weights).some((v) => v !== "")
                ? Object.values(weights)
                    .reduce((sum, value) => sum + (Number(value) || 0), 0)
                    .toFixed(1)
                : "입력 없음"}
              %
            </strong>
            <p>
              미입력 비중은 추정하거나 정규화하지 않습니다. 실제 계산·저장 API는
              미연결입니다.
            </p>
          </div>
          {portfolioError && (
            <p role="alert" className="field-error">
              {portfolioError}
            </p>
          )}
          <div className="button-row">
            <button
              type="button"
              className="button"
              onClick={() => {
                const values = Object.values(weights)
                  .filter((v) => v !== "")
                  .map(Number);
                if (
                  values.some((v) => !Number.isFinite(v) || v < 0 || v > 100) ||
                  values.reduce((a, b) => a + b, 0) > 100
                ) {
                  setPortfolioError(
                    "예시 비중은 0~100%, 합계는 100% 이하여야 합니다. 입력을 유지했습니다.",
                  );
                  return;
                }
                setPortfolioError("");
                notify(
                  "예시 입력을 이 탭에서 확인했습니다. 저장 API는 미연결입니다",
                );
              }}
            >
              예시 입력 확인 · 저장 아님
            </button>
            <Link className="button secondary" href="/today">
              포트폴리오 없이 계속
            </Link>
          </div>
        </Panel>
      );
    if (screen === "question")
      return (
        <div className="detail-grid">
          <Panel className="form-panel">
            <Tag tone="blue">AI 미연결 · 미리 작성된 답변</Tag>
            <h2>{company.name} (가상) · revision 2 예시</h2>
            <p>
              민감한 질문을 입력받지 않습니다. 준비된 질문과 합성 답변의 표시
              흐름만 보여줍니다.
            </p>
            <label className="field-label" htmlFor="question-preset">
              예시 질문 선택
            </label>
            <select
              id="question-preset"
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
                setAnswer(false);
              }}
            >
              <option>어떤 기간을 비교했나요?</option>
              <option>아직 알 수 없는 점은 무엇인가요?</option>
              <option>매수해야 하나요? · 거절 예시</option>
            </select>
            <label className="field-label" htmlFor="question-text">
              입력란 표시 예시 · 편집 불가
            </label>
            <textarea
              id="question-text"
              readOnly
              value={question}
              rows={3}
              maxLength={1000}
            />
            <div className="section-row">
              <span className="fine-print">
                {question.length} / 1,000 · 실제 할당량 없음
              </span>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setAnswer(true);
                  notify(
                    "준비된 합성 답변을 표시합니다. AI 호출이나 질문 전송은 없습니다",
                  );
                }}
              >
                합성 답변 보기
              </button>
            </div>
            {answer && (
              <div className="answer-box" role="status">
                <Tag tone={question.includes("매수") ? "amber" : "mint"}>
                  {question.includes("매수")
                    ? "거절 상태 예시"
                    : "합성 답변 예시"}
                </Tag>
                <h3>
                  {question.includes("매수")
                    ? "매수·매도 판단을 제공하지 않습니다"
                    : question.includes("기간")
                      ? "2025년 3분기와 4분기를 비교하는 예시입니다"
                      : "실제 비용과 미래 성과는 알 수 없습니다"}
                </h3>
                <p>
                  실제 자료나 AI로 확인한 답변이 아닙니다. 가상 문서의 기간과
                  가상 단위를 보여주는 화면입니다.
                </p>
                <Link className="citation" href={`${eventPath}/evidence`}>
                  [예시 1·2] 근거 위치 보기 ↗
                </Link>
              </div>
            )}
          </Panel>
          <Panel>
            <h3>질문의 범위</h3>
            <p>
              현재 사건의 공개된 근거 안에서만 답할 수 있는 제품을 지향합니다.
            </p>
            <ul className="plain-list">
              <li>근거 부족: 답변 보류</li>
              <li>매수/매도 요청: 거절</li>
              <li>오래된 revision: 정정 안내</li>
              <li>연결 실패: 다시 시도</li>
            </ul>
            <Link href={eventPath} className="text-link">
              상세로 돌아가기
            </Link>
          </Panel>
        </div>
      );
    if (screen === "calendar")
      return (
        <Panel>
          <div className="section-row">
            <h2>1월의 확인 일정 · 2026년 예시</h2>
            <Tag>모두 가상 일정</Tag>
          </div>
          <div className="agenda">
            {[
              {
                day: "20",
                name: "모아빛 테크",
                title: "예시 후속 자료 확인",
                status: "가상 확정일",
              },
              {
                day: "27",
                name: "푸른결 에너지",
                title: "가상 계획 변경 설명",
                status: "예상 날짜 예시",
              },
              {
                day: "?",
                name: "온유 물류",
                title: "예시 운영 공지 후속 확인",
                status: "날짜 미정",
              },
            ].map((item) => (
              <article key={item.name}>
                <div className="date-block">
                  <small>{item.day === "?" ? "미정" : "JAN"}</small>
                  <strong>{item.day}</strong>
                </div>
                <div>
                  <Tag>{item.status}</Tag>
                  <h3>{item.title}</h3>
                  <p>
                    {item.name} (가상) · 날짜만 있는 예시는 시간을 만들지
                    않습니다.
                  </p>
                </div>
                <Link className="text-link" href={`${eventPath}/evidence`}>
                  근거 예시 <Arrow />
                </Link>
              </article>
            ))}
          </div>
          <p className="fine-print">
            실제 기업 일정·이전 연도 날짜 추정·알림 발송은 없습니다.
          </p>
        </Panel>
      );
    if (screen === "alerts")
      return (
        <>
          <Panel>
            <div className="section-row">
              <div>
                <h2>선택 변화 알림</h2>
                <p>
                  처음에는 꺼져 있습니다. 실제 전송이나 알림 권한 요청은
                  없습니다.
                </p>
              </div>
              <label className="check-label toggle-label">
                <input
                  type="checkbox"
                  checked={alerts}
                  onChange={(e) => setAlerts(e.target.checked)}
                />
                예시 알림 {alerts ? "켜짐" : "꺼짐"}
              </label>
            </div>
          </Panel>
          {notices}
          <Panel>
            <h2>
              {alerts ? "선택 알림 예시 1건" : "조용한 상태도 정상입니다"}
            </h2>
            <p>
              {alerts
                ? "모아빛 테크 (가상) · 새로운 예시 변화가 있습니다. 실제 발행이나 알림은 발생하지 않았습니다."
                : "선택 알림을 켜지 않아도 정정·철회와 같은 정확성 안내는 남아 있습니다."}
            </p>
            {alerts && (
              <div className="button-row">
                <Link className="button" href={eventPath}>
                  예시 변화 보기
                </Link>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => notify("읽음 버튼 반응 예시입니다")}
                >
                  읽음 처리 · 예시
                </button>
              </div>
            )}
          </Panel>
        </>
      );
    if (screen === "settings")
      return (
        <div className="detail-grid">
          <Panel className="form-panel">
            <h2>예시 읽기 환경</h2>
            <p className="fine-print">
              계정 없음 · demo@example.invalid는 표시용 합성 주소입니다.
            </p>
            <label className="field-label" htmlFor="settings-timezone">
              예시 시간대
            </label>
            <select
              id="settings-timezone"
              value={demo.timezone}
              onChange={(e) => demo.setTimezone(e.target.value)}
            >
              <option value="Asia/Seoul">서울 · Asia/Seoul</option>
              <option value="Etc/UTC">UTC · Etc/UTC</option>
            </select>
            <label className="check-label">
              <input
                type="checkbox"
                checked={demo.analytics}
                onChange={(e) => demo.setAnalytics(e.target.checked)}
              />
              선택 분석 동의 UI · 실제 수집·전송 없음
            </label>
            <button
              type="button"
              className="button"
              onClick={() => notify("예시 설정은 이 탭 메모리에만 있습니다")}
            >
              예시 설정 확인
            </button>
            <hr />
            <h3>내 데이터 화면 예시</h3>
            <p>실제 계정·개인정보·파일 다운로드는 없습니다.</p>
            <div className="button-row">
              <button
                className="button secondary"
                type="button"
                onClick={() =>
                  notify(
                    "내보낼 실제 데이터가 없습니다. 내보내기 API는 미연결입니다",
                  )
                }
              >
                내보내기 · 미연결
              </button>
              <button
                className="button danger"
                type="button"
                onClick={() => dialog.current?.showModal()}
              >
                삭제 확인 화면 예시
              </button>
            </div>
          </Panel>
          <Panel>
            <h3>서비스의 범위와 한계</h3>
            <p>
              이 화면은 정보 구조와 UI 동작을 보여주는 미리보기입니다. 투자
              자문·확정 전망·실제 금융정보를 제공하지 않습니다.
            </p>
            <ul className="plain-list">
              <li>인증·API·DB·AI 모두 미연결</li>
              <li>서버 저장이나 브라우저 영구 저장 없음</li>
              <li>새로고침하면 예시 설정 초기화</li>
              <li>비밀번호·API key·실제 보유 정보 입력 금지</li>
            </ul>
            <Link className="text-link" href="/login">
              로그인 화면 예시 보기
            </Link>
          </Panel>
          <dialog ref={dialog} aria-labelledby="delete-title">
            <h2 id="delete-title">삭제 확인 화면 예시</h2>
            <p>
              실제 계정은 없으며 삭제 요청을 보내지 않습니다. 계속하면 이 탭의
              예시 설정만 초기화합니다.
            </p>
            <div className="button-row">
              <button
                className="button secondary"
                type="button"
                onClick={() => dialog.current?.close()}
              >
                취소
              </button>
              <button
                className="button danger"
                type="button"
                onClick={() => {
                  demo.setFollowed(["moabit", "pureun", "onyu"]);
                  demo.setAnalytics(false);
                  demo.setTimezone("Asia/Seoul");
                  dialog.current?.close();
                  notify(
                    "이 탭의 예시 설정만 초기화했습니다. 계정 삭제는 하지 않았습니다",
                  );
                }}
              >
                예시만 초기화
              </button>
            </div>
          </dialog>
        </div>
      );
    return (
      <>
        <Panel className="ops-warning">
          <Tag tone="amber">운영 데모 · 관리자 인증 없음</Tag>
          <h2>이 화면의 버튼은 실제 운영 권한이 아닙니다</h2>
          <p>
            모든 행은 합성 자료입니다. 승인·철회·재실행은 서버에 전송되지
            않습니다.
          </p>
        </Panel>
        <div className="metric-grid">
          <Panel>
            <span>가상 검토 대기</span>
            <strong>
              2 <small>예시 건</small>
            </strong>
          </Panel>
          <Panel>
            <span>근거 상충 예시</span>
            <strong>
              1 <small>예시 건</small>
            </strong>
          </Panel>
          <Panel>
            <span>실제 연결 상태</span>
            <strong className="small-metric">미연결</strong>
          </Panel>
        </div>
        <Panel>
          <div className="section-row">
            <h2>발행 전 검토 · 가상 queue</h2>
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                notify(
                  "발행 일시정지 버튼의 데모입니다. 실제 발행 설정을 변경하지 않았습니다",
                )
              }
            >
              발행 일시정지 · 데모
            </button>
          </div>
          <div className="ops-table">
            <div className="ops-row ops-heading">
              <span>예시 사건</span>
              <span>검증 상태</span>
              <span>검토 동작</span>
            </div>
            {[
              { name: "모아빛 테크", status: "검토 예시", pass: true },
              {
                name: "푸른결 에너지",
                status: "근거 상충 · 차단",
                pass: false,
              },
            ].map((row) => (
              <div className="ops-row" key={row.name}>
                <div>
                  <strong>{row.name} (가상)</strong>
                  <small>demo-run · 원문·검증 기록 예시</small>
                </div>
                <Tag tone={row.pass ? "mint" : "amber"}>{row.status}</Tag>
                <div className="button-row">
                  <button
                    className="button secondary"
                    type="button"
                    disabled={!row.pass}
                    onClick={() =>
                      notify(
                        "가상 승인 버튼 반응입니다. 게시 결정을 저장하지 않았습니다",
                      )
                    }
                  >
                    승인 · 데모
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      notify("가상 반려 버튼 반응입니다. 실행하지 않았습니다")
                    }
                  >
                    반려 · 데모
                  </button>
                </div>
              </div>
            ))}
          </div>
          <details className="ops-details">
            <summary>가상 검증 기록 확인</summary>
            <p>
              원문 정체성 / 숫자 / 인용 / 정책 검사의 표시 예시입니다. 실제 검사
              통과를 의미하지 않습니다. 차단된 행은 승인할 수 없습니다.
            </p>
            <Link className="text-link" href={`${eventPath}/evidence`}>
              합성 근거 확인
            </Link>
          </details>
        </Panel>
      </>
    );
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        본문으로 건너뛰기
      </a>
      <aside className="sidebar" aria-label="데스크톱 탐색">
        <Link href="/today" className="brand">
          <span className="brand-symbol" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            SignalBrief<small>변화를 읽는 새로운 기준</small>
          </span>
        </Link>
        <nav aria-label="화면 탐색">{nav}</nav>
        <div className="sidebar-note">
          <Tag tone="mint">UI PREVIEW</Tag>
          <p>
            가상 기업·합성 자료
            <br />
            실제 서비스 미연결
          </p>
          <span>정보 제공 화면 예시 · v0.1</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <Link className="mobile-brand" href="/today">
            SignalBrief<span>UI 미리보기</span>
          </Link>
          <span className="breadcrumb">
            나의 브리프 <span>/</span>{" "}
            {screens.find((s) => s.screen === screen)?.label}
          </span>
          <div className="preview-pill">
            <span className="status-dot" aria-hidden="true" /> UI 미리보기 ·
            예시 데이터
          </div>
          <Link className="topbar-link" href="/onboarding">
            읽는 기준 <Arrow />
          </Link>
        </header>
        <div className="preview-banner" role="note">
          <strong>UI 미리보기 · 예시 데이터</strong>
          <span>
            가상 기업과 합성 자료입니다. 로그인·저장·AI·관리자 권한은 연결되지
            않았습니다.
          </span>
        </div>
        <details className="mobile-nav">
          <summary>
            화면 탐색 · 13개 화면 <span aria-hidden="true">⌄</span>
          </summary>
          <nav aria-label="모바일 화면 탐색">{nav}</nav>
        </details>
        <main id="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">{header.eyebrow}</p>
              <h1>{header.title}</h1>
              <p>{header.subtitle}</p>
            </div>
            <div className="scenario-control">
              <label htmlFor="preview-scenario">화면 상태 · 데모 전환</label>
              <select
                id="preview-scenario"
                value={scenario}
                onChange={(e) => {
                  setScenario(e.target.value as Scenario);
                  setMessage("");
                }}
              >
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {screen === "today" && (
            <div className="daily-strip">
              <span>
                <strong>01.15</strong> 2026년 예시 기준일
              </span>
              <span>가상 자료 · 가격 데이터 없음</span>
              <span>관심 기업 {demo.followed.length}개 · 예시 선택</span>
            </div>
          )}
          {screen === "today" && notices}
          {["stale", "correction", "conflict"].includes(scenario) && (
            <div className="scenario-notice" role="status">
              <strong>
                {scenario === "stale"
                  ? "자료 지연 예시"
                  : scenario === "correction"
                    ? "정정된 revision 예시"
                    : "근거가 상충하는 예시"}
              </strong>
              <p>
                {scenario === "stale"
                  ? "예시 마지막 확인: 2026.01.15 08:00. 현재 수집 성공을 주장하지 않습니다."
                  : scenario === "correction"
                    ? "예전 설명을 반복하지 않고 안전한 정정 안내와 이력을 남깁니다."
                    : "합성 문서 A: 96 / 합성 문서 C: 99. 서로 다른 표현을 따로 표시하고 하나의 결론으로 합치지 않습니다."}
              </p>
            </div>
          )}
          {renderScreen()}
          <footer className="page-footer">
            <span>
              SignalBrief · UI 미리보기 · 모든 기업과 자료는 가상입니다.
            </span>
            <div>
              <Link href="/onboarding">자료 범위</Link>
              <Link href="/settings">개인정보 안내</Link>
              <Link href="/settings">정보 제공 한계</Link>
            </div>
          </footer>
        </main>
      </div>
      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          <button
            type="button"
            aria-label="안내 닫기"
            onClick={() => setMessage("")}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
