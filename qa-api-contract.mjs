import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatApi = readFileSync("src/lib/chatApi.ts", "utf8");
const downloadsPage = readFileSync("src/pages/DownloadsPage.tsx", "utf8");
const genomeDownloadsPage = readFileSync("src/pages/GenomeDownloadsPage.tsx", "utf8");
const genePage = readFileSync("src/pages/GenePage.tsx", "utf8");
const pafSynteny = readFileSync("src/lib/pafSynteny.ts", "utf8");

assert.ok(
  !chatApi.includes("apiFetch<ChatResponse>(CHAT_API_URL"),
  "chatApi must pass a relative path to apiFetch, not an API_BASE-prefixed URL",
);

assert.ok(
  !downloadsPage.includes("fetch(`/overview/") && !downloadsPage.includes('fetch(`/overview/'),
  "DownloadsPage CSV downloads must respect API_BASE instead of using a root-relative fetch",
);

assert.ok(
  !genomeDownloadsPage.includes("http://localhost:8000"),
  "GenomeDownloadsPage must not hardcode localhost backend URLs",
);

assert.ok(
  !pafSynteny.includes("fetch(PAF_URL)") && !pafSynteny.includes("fetch(GENE_COLLINEARITY_URL)"),
  "pafSynteny must respect API_BASE when fetching comparative assets",
);

assert.ok(
  !genePage.includes("import.meta.env.VITE_API_BASE"),
  "GenePage must use the shared API_BASE export instead of reading VITE_API_BASE directly",
);

console.log("API contract checks passed.");
