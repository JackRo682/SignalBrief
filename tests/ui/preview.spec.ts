import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const routes = [
  ["today", "/today"],
  ["login", "/login"],
  ["onboarding", "/onboarding"],
  ["watchlist", "/watchlist"],
  ["portfolio", "/portfolio"],
  ["event", "/events/moabit-review"],
  ["evidence", "/events/moabit-review/evidence"],
  ["timeline", "/companies/moabit/timeline"],
  ["question", "/events/moabit-review/question"],
  ["calendar", "/calendar"],
  ["alerts", "/alerts"],
  ["settings", "/settings"],
  ["ops", "/ops"],
] as const;
const evidenceDir =
  process.env.PREVIEW_EVIDENCE_DIR || "test-results/ui-evidence";

for (const [name, path] of routes) {
  test(`${name}: three viewports, honest content, accessibility and screenshots`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const external: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (!request.url().startsWith("http://127.0.0.1:3117/"))
        external.push(request.url());
    });
    await mkdir(evidenceDir, { recursive: true });
    for (const width of [1280, 768, 360]) {
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.locator(".preview-banner")).toContainText(
        "UI 미리보기 · 예시 데이터",
      );
      await expect(page.locator(".preview-banner")).toContainText(
        "연결되지 않았습니다",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
      await page.screenshot({
        path: join(evidenceDir, `${name}-${width}.png`),
        fullPage: true,
      });
    }
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      axe.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });
}

test("all state fixtures preserve honesty; Today notices survive empty/failed states", async ({
  page,
}) => {
  await page.goto("/today");
  for (const value of [
    "loading",
    "empty",
    "error",
    "stale",
    "correction",
    "conflict",
    "withdrawn",
    "unauthorized",
  ]) {
    await page.getByLabel("화면 상태 · 데모 전환").selectOption(value);
    await expect(page.locator(".preview-banner")).toBeVisible();
    await expect(page.locator(".accuracy-notice")).toBeVisible();
    if (value === "withdrawn")
      await expect(page.locator(".event-card")).toHaveCount(0);
    await page.screenshot({
      path: join(evidenceDir, `today-state-${value}.png`),
      fullPage: true,
    });
  }
  await page.getByLabel("화면 상태 · 데모 전환").selectOption("error");
  await page.getByRole("button", { name: "예시 다시 시도" }).click();
  await expect(page.locator(".event-card")).toHaveCount(3);
});

test("watchlist preview selection persists in this-tab navigation, resets on reload", async ({
  page,
}) => {
  await page.goto("/watchlist");
  await page
    .getByRole("button", { name: "달이 연구소 예시 관심 추가" })
    .click();
  await expect(
    page.getByRole("button", { name: "달이 연구소 예시 관심 해제" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "오늘의 변화 예시 보기" }).click();
  await expect(page.locator(".daily-strip")).toContainText("관심 기업 4개");
  await page.goBack();
  await page.getByLabel("가상 기업 이름 검색").fill("없는가상기업");
  await expect(page.getByText("가상 목록에 없는 이름입니다")).toBeVisible();
  await page.getByRole("button", { name: "검색 지우기" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "달이 연구소 예시 관심 추가" }),
  ).toBeVisible();
});

test("detail/evidence/back and other fictional companies keep their identity", async ({
  page,
}) => {
  await page.goto("/today");
  await page
    .getByRole("link", { name: "매출 예시가 늘었지만, 비용도 함께 늘었습니다" })
    .click();
  await page.getByRole("link", { name: "근거 패널 열기" }).click();
  await expect(page.locator("blockquote")).toContainText("135");
  await page
    .getByRole("button", { name: "이전 합성 문서", exact: true })
    .click();
  await expect(page.locator("blockquote")).toContainText("120");
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "숫자 다음의 맥락을 읽습니다" }),
  ).toBeVisible();
  await page.goto("/events/pureun-plan");
  await page.getByRole("link", { name: "근거 패널 열기" }).click();
  await expect(page.locator(".source-metadata")).toContainText("푸른결 에너지");
  await expect(page.locator("blockquote")).toContainText("3분기");
  expect((await page.goto("/events/not-a-fixture"))?.status()).toBe(404);
});

test("portfolio unknown weights and validation preserve invalid inputs", async ({
  page,
}) => {
  await page.goto("/portfolio");
  await expect(page.getByText("비중 모름", { exact: true })).toHaveCount(2);
  await page.getByLabel("예시 비중 (%) · 선택").nth(0).fill("80");
  await page.getByLabel("예시 비중 (%) · 선택").nth(1).fill("30");
  await page
    .getByRole("button", { name: "예시 입력 확인 · 저장 아님" })
    .click();
  await expect(page.locator(".field-error")).toContainText("합계는 100%");
  await expect(page.getByLabel("예시 비중 (%) · 선택").nth(0)).toHaveValue(
    "80",
  );
  await page.getByLabel("예시 비중 (%) · 선택").nth(1).fill("");
  await page
    .getByRole("button", { name: "예시 입력 확인 · 저장 아님" })
    .click();
  await expect(page.locator(".toast")).toContainText("저장 API는 미연결");
});

test("preset-only questions, repeated clicks, alerts and blocked Ops never execute services", async ({
  page,
}) => {
  await page.goto("/events/moabit-review/question");
  await expect(page.getByLabel("입력란 표시 예시 · 편집 불가")).toHaveAttribute(
    "readonly",
    "",
  );
  await page
    .getByLabel("예시 질문 선택")
    .selectOption("매수해야 하나요? · 거절 예시");
  await page
    .getByRole("button", { name: "합성 답변 보기" })
    .click({ clickCount: 2 });
  await expect(page.locator(".answer-box")).toContainText(
    "매수·매도 판단을 제공하지 않습니다",
  );
  await expect(page.locator(".answer-box")).toHaveCount(1);
  await page.goto("/alerts");
  await expect(page.locator(".accuracy-notice")).toBeVisible();
  await page.getByRole("checkbox").check();
  await expect(page.getByText("선택 알림 예시 1건")).toBeVisible();
  await page.goto("/ops");
  await expect(
    page.getByRole("button", { name: "승인 · 데모" }).nth(1),
  ).toBeDisabled();
  await page.getByRole("button", { name: "승인 · 데모" }).first().click();
  await expect(page.locator(".toast")).toContainText(
    "게시 결정을 저장하지 않았습니다",
  );
});

test("keyboard skip/focus, modal Escape/return and 200% layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "본문으로 건너뛰기" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await page.getByRole("button", { name: "삭제 확인 화면 예시" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "삭제 확인 화면 예시" }),
  ).toBeFocused();
  for (const path of ["/today", "/events/moabit-review", "/settings", "/ops"]) {
    await page.goto(path);
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await expect(page.locator(".sidebar")).not.toBeVisible();
    await expect(page.locator(".mobile-nav")).toBeVisible();
    await page.screenshot({
      path: join(
        evidenceDir,
        `${path.split("/").filter(Boolean).join("-")}-200-percent.png`,
      ),
      fullPage: true,
    });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
});
