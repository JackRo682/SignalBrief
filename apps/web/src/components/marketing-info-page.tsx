import Link from "next/link";

type MarketingRoute =
  | "/about"
  | "/features"
  | "/sources"
  | "/pricing"
  | "/customers";

type Section = {
  title: string;
  body: string;
  items?: readonly string[];
};

const nav: ReadonlyArray<{ href: MarketingRoute; label: string }> = [
  { href: "/about", label: "서비스 소개" },
  { href: "/features", label: "주요 기능" },
  { href: "/sources", label: "데이터 출처" },
  { href: "/pricing", label: "요금제" },
  { href: "/customers", label: "고객 사례" },
];

export default function MarketingInfoPage({
  current,
  eyebrow,
  title,
  description,
  sections,
}: {
  current: MarketingRoute;
  eyebrow: string;
  title: string;
  description: string;
  sections: readonly Section[];
}) {
  return (
    <main className="info-page">
      <header className="info-header">
        <Link href="/" className="info-logo">
          SignalBrief
        </Link>

        <nav className="info-nav" aria-label="서비스 안내">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.href === current ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="info-actions">
          <Link href="/login" className="button secondary">
            로그인
          </Link>
          <Link href="/signup" className="button primary">
            무료로 시작하기
          </Link>
        </div>
      </header>

      <section className="info-hero">
        <span className="info-kicker">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="info-lead">{description}</p>
      </section>

      <section className="info-sections">
        {sections.map((section) => (
          <article key={section.title} className="info-section">
            <h2>{section.title}</h2>
            <p>{section.body}</p>
            {section.items && (
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </article>
        ))}

        <div className="info-footer-cta">
          <Link href="/signup" className="button primary large">
            내 관심종목으로 시작
          </Link>
          <Link href="/" className="button secondary large">
            메인으로 돌아가기
          </Link>
        </div>
      </section>
    </main>
  );
}
