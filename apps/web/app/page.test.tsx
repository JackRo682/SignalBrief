import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "./page";
import Preview from "./preview/preview";
import { DemoProvider } from "./preview/provider";
import { companies, headings, screens } from "./preview/fixtures";

describe("independent UI preview", () => {
  it("starts with a clearly fictional Korean Today view", () => {
    const html = renderToStaticMarkup(
      <DemoProvider>
        <Home />
      </DemoProvider>,
    );
    expect(html).toContain('id="main-content"');
    expect(html).toContain("UI 미리보기 · 예시 데이터");
    expect(html).toContain("오늘, 무엇이 달라졌나요?");
    expect(html).toContain("실제 서비스 미연결");
    expect(html).not.toMatch(/type="password"|<iframe|https:\/\//);
  });
  it.each(screens)("renders honest screen $screen", ({ screen }) => {
    const html = renderToStaticMarkup(
      <DemoProvider>
        <Preview screen={screen} />
      </DemoProvider>,
    );
    expect(html).toContain(headings[screen].title);
    expect(html).toContain("가상 기업과 합성 자료");
    expect(html).toContain("개인정보 안내");
    expect(html).not.toMatch(/type="password"|<iframe/);
  });
  it("keeps all screen paths and fictional company identities unique", () => {
    expect(new Set(screens.map((s) => s.path)).size).toBe(13);
    expect(new Set(companies.map((c) => c.id)).size).toBe(companies.length);
    expect(companies.every((c) => c.sector.includes("가상"))).toBe(true);
  });
});
