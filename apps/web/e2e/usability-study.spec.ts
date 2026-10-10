import { test, expect } from "@playwright/test";

test.skip(process.env.SB_STUDY_TEST !== "1", "Requires the isolated static study server and SB_STUDY_TEST=1");

// Software fixtures only. Never interpret these sessions as participant evidence.
test("study requires review/consent and clears records on withdrawal", async ({ page }) => {
  await page.goto("http://127.0.0.1:8765/tools/usability-study.html");
  await expect(page.locator("#start")).toBeDisabled();
  await page.screenshot({ path: `test-results/usability-study-${test.info().project.name}.png`, fullPage: true });
  const stimulus = {
    version: "signalbrief-usability-v1", human_review_status: "approved",
    reviewer: "SYNTHETIC SOFTWARE FIXTURE", review_date: "2026-01-01",
    model_run_reference: "synthetic-test-not-a-real-model-run",
    trials: ["T1", "T2"].map(id => ({ id, generic: "Synthetic generic text",
      evidence_first: "Synthetic linked text", task: "Synthetic task",
      sources: [{ url: "https://www.sec.gov/Archives/edgar/data/1/test.htm", label: "Synthetic source" }] }))
  };
  await page.locator("#file").setInputFiles({ name: "fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(stimulus)) });
  await expect(page.locator("#start")).toBeDisabled();
  await page.locator("#consent").check();
  await page.locator("#start").click();
  for (let i = 0; i < 2; i++) {
    await page.locator("#direction").selectOption("insufficient");
    await page.locator("#period").selectOption("incomparable");
    await page.locator("#confidence").selectOption("1");
    await page.locator("#complete").click();
  }
  await expect(page.locator("#export")).toBeEnabled();
  await page.locator("#withdraw").click();
  await expect(page.locator("#export")).toBeDisabled();
  await expect(page.locator("#trial")).toBeHidden();
});

test("unreviewed or unsafe stimuli cannot start a session", async ({ page }) => {
  await page.goto("http://127.0.0.1:8765/tools/usability-study.html");
  await page.locator("#file").setInputFiles({ name: "unsafe.json", mimeType: "application/json", buffer: Buffer.from('{"human_review_status":"pending"}') });
  await page.locator("#consent").check();
  await expect(page.locator("#start")).toBeDisabled();
  await expect(page.locator("#status")).toContainText("자료 형식이나 출처가 맞지 않습니다");
});
