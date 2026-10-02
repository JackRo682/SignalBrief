import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "./page";

describe("foundation page", () => {
  it("renders a semantic, honest empty scaffold without an auth action", () => {
    const html = renderToStaticMarkup(<Home />);
    expect(html).toContain("<main>");
    expect(html).toContain("<h1>SignalBrief</h1>");
    expect(html).toContain(
      "현재 기업 정보, 분석 또는 인증 기능은 제공하지 않습니다.",
    );
    expect(html).not.toMatch(/<button|<form|<script|<iframe/);
  });
});
