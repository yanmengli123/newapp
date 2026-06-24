import assert from "node:assert/strict";
import { build } from "esbuild";

async function loadPafSyntenyModule() {
  const result = await build({
    entryPoints: ["src/lib/pafSynteny.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    define: {
      "import.meta.env": "{}",
    },
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const { parsePaf, findMateLocation, loadPafSyntenyFeatures } = await loadPafSyntenyModule();

const chrNamedPaf = [
  "chr1",
  "197608386",
  "303888",
  "418897",
  "+",
  "chr1",
  "196449156",
  "440270",
  "555328",
  "114384",
  "115297",
  "60",
].join("\t");

const refseqNamedPaf = [
  "NC_006088.5",
  "197608386",
  "303888",
  "418897",
  "+",
  "NC_052532.1",
  "196449156",
  "440270",
  "555328",
  "114384",
  "115297",
  "60",
].join("\t");

const chrFeatures = parsePaf(`${chrNamedPaf}\n`);
assert.equal(chrFeatures.length, 1, "chr-named PAF rows should produce one feature");
assert.equal(chrFeatures[0].refName, "chr1");
assert.equal(chrFeatures[0].mate.refName, "chr1");
assert.equal(findMateLocation(chrFeatures, "chr1:303889..418897"), "chr1:440271..555328");

const refseqFeatures = parsePaf(`${refseqNamedPaf}\n`);
assert.equal(refseqFeatures.length, 1, "RefSeq-named PAF rows should still produce one feature");
assert.equal(refseqFeatures[0].refName, "chr1");
assert.equal(refseqFeatures[0].mate.refName, "chr1");

let geneCollinearityRequested = false;
globalThis.fetch = async (url) => {
  const requestUrl = String(url);
  if (requestUrl.includes("/comparative/paf/file")) {
    return new Response(`${chrNamedPaf}\n`, {
      status: 200,
      headers: {
        "X-Synteny-Layer-Status": "primary",
        "X-Synteny-Source-Path": "test-primary.paf",
      },
    });
  }
  if (requestUrl.includes("/comparative/gene-collinearity")) {
    geneCollinearityRequested = true;
    return new Promise(() => {});
  }
  throw new Error(`Unexpected fetch URL: ${requestUrl}`);
};

const loaded = await Promise.race([
  loadPafSyntenyFeatures(),
  new Promise((resolve) => setTimeout(() => resolve("timeout"), 100)),
]);
assert.notEqual(loaded, "timeout", "DNA PAF loading should not wait for gene collinearity");
assert.equal(geneCollinearityRequested, false, "DNA PAF loading should not request gene collinearity");

console.log("pafSynteny parser regression tests passed");
