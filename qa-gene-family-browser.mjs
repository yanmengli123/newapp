import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import pixelmatch from 'pixelmatch';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const root = process.cwd();
const backendBase = 'http://127.0.0.1:8001';
const frontendMarker = '<title>newapp</title>';
const entryId = 'pfam:PF00069';
const encodedEntryId = encodeURIComponent(entryId);
const baselineDir = path.join(root, 'qa', 'baselines', 'gene-family');
const resultDir = path.join(root, 'test-results', 'gene-family');
const updateSnapshots = process.env.UPDATE_GENE_FAMILY_SNAPSHOTS === '1';
const children = [];

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a local frontend port'));
        return;
      }
      const { port } = address;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

const configuredFrontendPort = Number.parseInt(process.env.GENE_FAMILY_FRONTEND_PORT || '', 10);
const frontendPort = Number.isInteger(configuredFrontendPort) && configuredFrontendPort > 0
  ? configuredFrontendPort
  : await getAvailablePort();
const frontendBase = `http://127.0.0.1:${frontendPort}`;

mkdirSync(baselineDir, { recursive: true });
mkdirSync(resultDir, { recursive: true });

function startProcess(command, args, label, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      output.push(chunk);
      if (output.length > 100) output.shift();
    });
  }
  child.testLabel = label;
  child.testOutput = output;
  children.push(child);
  return child;
}

function stopProcess(child) {
  if (child.exitCode != null || child.pid == null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } else {
    child.kill('SIGTERM');
  }
}

async function waitForHttp(url, child, timeoutMs = 45_000, expectedMarker = null) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`${child.testLabel} exited with ${child.exitCode}:\n${child.testOutput.join('')}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        if (!expectedMarker || (await response.text()).includes(expectedMarker)) return response;
        lastError = new Error(`${url} returned another application`);
      } else {
        lastError = new Error(`${url} returned ${response.status}`);
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}\n${child.testOutput.join('')}`);
}

async function httpIsHealthy(url, expectedMarker = null) {
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    return !expectedMarker || (await response.text()).includes(expectedMarker);
  } catch {
    return false;
  }
}

function compareSnapshot(name, actualBuffer) {
  const baselinePath = path.join(baselineDir, `${name}.png`);
  const actualPath = path.join(resultDir, `${name}.actual.png`);
  writeFileSync(actualPath, actualBuffer);
  if (updateSnapshots) {
    writeFileSync(baselinePath, actualBuffer);
    return;
  }
  assert.ok(
    existsSync(baselinePath),
    `Missing ${baselinePath}; run with UPDATE_GENE_FAMILY_SNAPSHOTS=1 after reviewing the image`,
  );
  const baseline = PNG.sync.read(readFileSync(baselinePath));
  const actual = PNG.sync.read(actualBuffer);
  assert.equal(actual.width, baseline.width, `${name} screenshot width changed`);
  assert.equal(actual.height, baseline.height, `${name} screenshot height changed`);
  const diff = new PNG({ width: actual.width, height: actual.height });
  const differentPixels = pixelmatch(
    baseline.data,
    actual.data,
    diff.data,
    actual.width,
    actual.height,
    { threshold: 0.15, includeAA: false },
  );
  const ratio = differentPixels / (actual.width * actual.height);
  if (ratio > 0.0025) {
    writeFileSync(path.join(resultDir, `${name}.diff.png`), PNG.sync.write(diff));
  }
  assert.ok(ratio <= 0.0025, `${name} visual regression ratio ${ratio.toFixed(6)} exceeds 0.0025`);
}

async function stabilize(page) {
  await page.addStyleTag({
    content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
  });
  await page.evaluate(() => document.fonts.ready);
}

async function snapshot(locator, name) {
  await locator.scrollIntoViewIfNeeded();
  const buffer = await locator.screenshot({ animations: 'disabled' });
  compareSnapshot(name, buffer);
}

async function assertGeometry(architecture, expectedHits = 1) {
  const track = architecture.locator('[data-domain-track]');
  const hits = architecture.locator('[data-domain-hit]');
  await assert.doesNotReject(() => track.waitFor({ state: 'visible' }));
  assert.equal(await hits.count(), expectedHits);
  const trackBox = await track.boundingBox();
  assert.ok(trackBox && trackBox.width > 0, 'Domain track must have measurable width');
  for (let index = 0; index < expectedHits; index += 1) {
    const hit = hits.nth(index);
    const hitBox = await hit.boundingBox();
    assert.ok(hitBox && hitBox.width > 0, `Domain hit ${index + 1} must have measurable width`);
    const expectedLeft = Number(await hit.getAttribute('data-left-fraction'));
    const expectedWidth = Number(await hit.getAttribute('data-width-fraction'));
    const actualLeft = (hitBox.x - trackBox.x) / trackBox.width;
    const actualWidth = hitBox.width / trackBox.width;
    const pixelTolerance = 2 / trackBox.width;
    assert.ok(
      Math.abs(actualLeft - expectedLeft) <= Math.max(0.01, pixelTolerance),
      `Domain hit ${index + 1} left position does not match its validated coordinate`,
    );
    assert.ok(
      Math.abs(actualWidth - expectedWidth) <= Math.max(0.01, pixelTolerance),
      `Domain hit ${index + 1} width does not match its validated coordinate`,
    );
  }
}

async function openDomainTab(page) {
  await page.goto(`${frontendBase}/gene-families/entry/${encodedEntryId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Domain positions' }).click();
}

async function mockEntryEvidence(page, responseBody) {
  let matches = 0;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const isEntryEvidence = url.pathname.startsWith('/api/v1/gene-family-catalog/entries/')
      && url.pathname.endsWith('/evidence');
    if (!isEntryEvidence) {
      await route.continue();
      return;
    }
    matches += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responseBody),
    });
  });
  return () => matches;
}

async function run() {
  const python = process.env.GENE_FAMILY_PYTHON || 'D:\\soft\\Python310\\python.exe';
  const backendHealthUrl = `${backendBase}/api/v1/gene-family-catalog/releases/current`;
  const frontendHealthUrl = `${frontendBase}/gene-families`;
  if (!(await httpIsHealthy(backendHealthUrl))) {
    const backend = startProcess(
      python,
      ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8001', '--lifespan', 'off'],
      'Gene Families backend',
      { PYTHONDONTWRITEBYTECODE: '1' },
    );
    await waitForHttp(backendHealthUrl, backend);
  }
  if (!(await httpIsHealthy(frontendHealthUrl, frontendMarker))) {
    const vite = startProcess(
      process.execPath,
      [
        path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
        '--host',
        '127.0.0.1',
        '--port',
        String(frontendPort),
        '--strictPort',
      ],
      'newapp Vite server',
    );
    await waitForHttp(frontendHealthUrl, vite, 45_000, frontendMarker);
  }

  const evidenceResponse = await fetch(
    `${backendBase}/api/v1/gene-family-catalog/entries/${encodedEntryId}/evidence?limit=50`,
  );
  assert.equal(evidenceResponse.status, 200);
  const actualEvidence = await evidenceResponse.json();
  const observedRecord = actualEvidence.data.find(
    (record) => record.protein_length_status === 'observed' && record.protein_length > record.ali_to,
  );
  assert.ok(observedRecord, 'PF00069 must provide at least one observed full-protein record');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });

    const navigationPage = await context.newPage();
    await navigationPage.goto(frontendBase, { waitUntil: 'networkidle' });
    const geneFamiliesTab = navigationPage.getByRole('link', { name: 'Gene Families', exact: true });
    await geneFamiliesTab.waitFor({ state: 'visible' });
    assert.equal(await geneFamiliesTab.getAttribute('href'), '/gene-families');
    await geneFamiliesTab.click();
    await navigationPage.waitForURL(`${frontendBase}/gene-families`);
    await navigationPage.getByRole('heading', {
      name: 'Gene, Protein Family & Domain Annotation Catalog',
    }).waitFor({ state: 'visible' });

    const compactNavigationPage = await context.newPage();
    await compactNavigationPage.setViewportSize({ width: 1024, height: 800 });
    await compactNavigationPage.goto(frontendBase, { waitUntil: 'networkidle' });
    await compactNavigationPage.getByRole('button', { name: 'Navigation' }).click();
    const compactGeneFamiliesLink = compactNavigationPage.getByRole('menuitem', {
      name: 'Gene Families',
      exact: true,
    });
    await compactGeneFamiliesLink.waitFor({ state: 'visible' });
    assert.equal(await compactGeneFamiliesLink.getAttribute('href'), '/gene-families');

    const searchPage = await context.newPage();
    await searchPage.goto(`${frontendBase}/gene-families`, { waitUntil: 'networkidle' });
    await searchPage.getByLabel('Search genes, proteins and catalog entries').fill('KCTD12');
    const sourceAssertions = searchPage.locator('[data-source-assertion]');
    await sourceAssertions.first().waitFor({ state: 'visible' });
    assert.equal(await sourceAssertions.count(), 2, 'KCTD12 must expose exactly two source-level assertions');
    const searchText = await sourceAssertions.allTextContents();
    assert.ok(searchText.some((text) => text.includes('107051871')));
    assert.ok(searchText.some((text) => text.includes('425504')));
    for (const text of searchText) {
      assert.match(text, /accepted/i);
      assert.match(text, /ambiguous/i);
      assert.match(text, /needs.mapping/i);
      assert.match(text, /Internal gene:\s*Not assigned/i);
    }
    const sourceHref = await sourceAssertions.first().getByRole('link').getAttribute('href');
    assert.equal(sourceHref, '/gene-families/entry/ubiquitin_core:E3_CRL_adaptor');
    await stabilize(searchPage);
    await snapshot(searchPage.getByText('Source assertions needing mapping').locator('..'), 'kctd12-source-assertions');

    const knownPage = await context.newPage();
    await openDomainTab(knownPage);
    const known = knownPage.locator(
      '[data-domain-architecture][data-protein-length-status="observed"][data-scale-mode="full_protein"]',
    ).first();
    await known.waitFor({ state: 'visible' });
    assert.equal(await known.getAttribute('data-validation-status'), 'valid');
    assert.equal(await known.getAttribute('data-scale-end'), await known.getAttribute('data-protein-length'));
    await assertGeometry(known, 1);
    await stabilize(knownPage);
    await snapshot(known, 'pf00069-observed-full-protein');

    const unknownPage = await context.newPage();
    const unknownRecord = {
      ...observedRecord,
      protein_accession: 'UNKNOWN_LENGTH_TEST',
      protein_length: null,
      protein_length_status: 'not_reported',
    };
    const unknownMatches = await mockEntryEvidence(unknownPage, {
      ...actualEvidence,
      data: [unknownRecord],
      meta: { ...actualEvidence.meta, total: 1, next_cursor: null },
    });
    await openDomainTab(unknownPage);
    assert.ok(unknownMatches() >= 1, 'Unknown-length fixture must replace the evidence API response');
    const unknown = unknownPage.locator(
      '[data-domain-architecture][data-protein-length-status="not_reported"][data-scale-mode="local_coordinate_window"]',
    );
    await unknown.waitFor({ state: 'visible' });
    assert.equal(await unknown.getAttribute('data-validation-status'), 'protein_length_missing');
    await assertGeometry(unknown, 1);
    await assert.doesNotReject(() => unknown.getByText('Protein length not reported').waitFor());
    await assert.doesNotReject(() => unknown.getByText(/Local coordinate window/).waitFor());
    await stabilize(unknownPage);
    await snapshot(unknown, 'pf00069-unknown-length-local-window');

    const multiPage = await context.newPage();
    const multiBase = {
      ...observedRecord,
      protein_accession: 'LONG_MULTI_DOMAIN_TEST',
      protein_length: 2673,
      protein_length_status: 'observed',
      domain_total: 2,
    };
    const multiData = [
      { ...multiBase, assertion_id: 'TEST_DOMAIN_1', evidence_id: 'TEST_EVIDENCE_1', domain_index: 1, ali_from: 50, ali_to: 250 },
      { ...multiBase, assertion_id: 'TEST_DOMAIN_2', evidence_id: 'TEST_EVIDENCE_2', domain_index: 2, ali_from: 1450, ali_to: 1825 },
    ];
    const multiMatches = await mockEntryEvidence(multiPage, {
      ...actualEvidence,
      data: multiData,
      meta: { ...actualEvidence.meta, total: 2, next_cursor: null },
    });
    await openDomainTab(multiPage);
    assert.ok(multiMatches() >= 1, 'Multi-domain fixture must replace the evidence API response');
    const multi = multiPage.locator('[data-domain-architecture][data-protein-id="LONG_MULTI_DOMAIN_TEST"]');
    await multi.waitFor({ state: 'visible' });
    assert.equal(await multi.getAttribute('data-scale-end'), '2673');
    assert.equal(await multi.getAttribute('data-validation-status'), 'valid');
    await assertGeometry(multi, 2);
    await stabilize(multiPage);
    await snapshot(multi, 'pf00069-long-multi-domain');

    await context.close();
  } finally {
    await browser.close();
  }
}

try {
  await run();
  console.log(updateSnapshots
    ? 'Gene Families browser acceptance passed and visual baselines were updated.'
    : 'Gene Families browser acceptance and visual regression checks passed.');
} finally {
  for (const child of children.reverse()) stopProcess(child);
}
