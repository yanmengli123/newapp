import assert from "node:assert/strict";
import { build } from "esbuild";

async function loadBlastConfigModule() {
  const result = await build({
    entryPoints: ["src/lib/blastConfig.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const {
  BLAST_DEFAULT_BASE,
  getBlastBase,
  getBlastUrl,
  isBlastSelfRoute,
  normalizeBlastBase,
} = await loadBlastConfigModule();

assert.equal(BLAST_DEFAULT_BASE, "http://localhost:4567");
assert.equal(normalizeBlastBase("http://localhost:4567/"), "http://localhost:4567");
assert.equal(normalizeBlastBase(""), "http://localhost:4567");
assert.equal(getBlastBase({ VITE_BLAST_BASE: "http://localhost:4567/" }), "http://localhost:4567");
assert.equal(getBlastBase({}), "http://localhost:4567");
assert.equal(getBlastUrl("searchdata.json", "http://localhost:4567/"), "http://localhost:4567/searchdata.json");
assert.equal(getBlastUrl("/searchdata.json", "http://localhost:4567/"), "http://localhost:4567/searchdata.json");
assert.equal(isBlastSelfRoute("/blast"), true);
assert.equal(isBlastSelfRoute("http://localhost:4567"), false);

console.log("blastConfig regression tests passed");
