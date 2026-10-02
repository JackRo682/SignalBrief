import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "signalbrief-contracts-"));
try {
  const destination = join(dir, "generated.ts");
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/openapi-typescript/bin/cli.js",
      "packages/contracts/openapi.json",
      "-o",
      destination,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  if (
    readFileSync(destination, "utf8") !==
    readFileSync("packages/contracts/generated.ts", "utf8")
  ) {
    throw new Error("generated TypeScript contract drift");
  }
  console.log("generated TypeScript contracts match");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
