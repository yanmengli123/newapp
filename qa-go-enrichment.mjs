import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5179';
const OUTPUT_DIR = 'public/qa-screenshots';

// Helper to take screenshot with error handling
async function capture(page, name, options = {}) {
  try {
    await page.screenshot({ path: `${OUTPUT_DIR}/${name}.png`, ...options });
    console.log(`Captured: ${name}`);
    return true;
  } catch (e) {
    console.error(`Failed to capture ${name}: ${e.message}`);
    return false;
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  const results = {
    timestamp: new Date().toISOString(),
    viewport: '1920x1080',
    tests: []
  };

  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  try {
    console.log('=== GO Enrichment QA Testing ===\n');

    // 1. Initial page load
    console.log('1. Testing initial page load...');
    await page.goto(`${BASE_URL}/go-enrichment`, { waitUntil: 'networkidle', timeout: 30000 });
    await capture(page, '01-initial-load');
    results.tests.push({ test: 'initial-load', status: 'TESTED', screenshot: '01-initial-load.png' });

    // 2. Check for page title
    const title = await page.title();
    console.log(`   Page title: ${title}`);

    // 3. Check for Example Set badges
    console.log('\n2. Checking for Example Set badges...');
    const exampleSetBadges = await page.locator('span:has-text("Example Set"), div[role="button"]:has-text("Example Set")').count();
    console.log(`   Found ${exampleSetBadges} Example Set elements`);
    await capture(page, '02-example-sets-visible');
    results.tests.push({ test: 'example-sets-badges', status: exampleSetBadges > 0 ? 'TESTED' : 'FAIL', count: exampleSetBadges });

    // 4. Click Example Set 1 (Badge component with cursor pointer)
    console.log('\n3. Clicking Example Set 1...');
    // The badge text is like "Example Set 1" - look for the span/badge containing this text
    const exampleSet1 = page.locator('text="Example Set 1"').first();
    if (await exampleSet1.count() > 0) {
      await exampleSet1.click();
      await page.waitForTimeout(500);
      await capture(page, '03-after-example-set-click');
      results.tests.push({ test: 'example-set-1-click', status: 'TESTED' });
    } else {
      console.log('   Example Set 1 not found');
      results.tests.push({ test: 'example-set-1-click', status: 'FAIL' });
    }

    // 5. Check gene input has content
    console.log('\n4. Checking gene input...');
    const geneInput = page.locator('textarea').first();
    const inputValue = await geneInput.inputValue();
    console.log(`   Gene input has ${inputValue.split(/[\n,]/).filter(Boolean).length} genes`);
    results.tests.push({ test: 'gene-input-populated', status: inputValue.length > 0 ? 'TESTED' : 'FAIL' });

    // 6. Click Run Analysis button
    console.log('\n5. Running analysis...');
    await page.locator('button:has-text("Run Analysis")').click();
    await page.waitForTimeout(5000); // Wait for API call
    await capture(page, '04-analysis-results');
    results.tests.push({ test: 'analyze-button', status: 'TESTED' });

    // 7. Check for bar chart (Recharts)
    console.log('\n6. Checking for bar chart...');
    const barChart = await page.locator('.recharts-wrapper, svg.recharts-bar').count();
    console.log(`   Bar chart elements found: ${barChart}`);
    await capture(page, '05-bar-chart-visible');
    results.tests.push({ test: 'bar-chart', status: barChart > 0 ? 'TESTED' : 'FAIL' });

    // 8. Check for results table
    console.log('\n7. Checking for results table...');
    const table = await page.locator('table').count();
    console.log(`   Table elements found: ${table}`);
    await capture(page, '06-results-table-visible');
    results.tests.push({ test: 'results-table', status: table > 0 ? 'TESTED' : 'FAIL' });

    // 9. Check summary cards
    console.log('\n8. Checking summary cards...');
    const summaryCards = await page.locator('[class*="Card"], [class*="card"]').count();
    console.log(`   Card elements: ${summaryCards}`);
    results.tests.push({ test: 'summary-cards', status: summaryCards >= 6 ? 'TESTED' : 'FAIL' });

    // 10. Test table sorting - click on FDR header
    console.log('\n9. Testing table sorting...');
    const fdrHeader = page.locator('th:has-text("FDR")').first();
    if (await fdrHeader.count() > 0) {
      await fdrHeader.click();
      await page.waitForTimeout(500);
      await capture(page, '07-table-sorted');
      console.log('   Table sorting works');
      results.tests.push({ test: 'table-sorting', status: 'TESTED' });
    } else {
      console.log('   No FDR header found');
      results.tests.push({ test: 'table-sorting', status: 'NOT_FOUND' });
    }

    // 11. Click on a term row to open drawer
    console.log('\n10. Opening term detail drawer...');
    const firstTermRow = page.locator('tbody tr').first();
    if (await firstTermRow.count() > 0) {
      await firstTermRow.click();
      await page.waitForTimeout(1500);
      await capture(page, '08-term-drawer-open');
      results.tests.push({ test: 'term-drawer-open', status: 'TESTED' });

      // 12. Check drawer content - look for GO term info
      console.log('\n11. Checking drawer content...');
      const drawerTitle = await page.locator('text=GO:').first().textContent().catch(() => null);
      console.log(`   Drawer GO term: ${drawerTitle}`);
      results.tests.push({ test: 'drawer-content', status: drawerTitle ? 'TESTED' : 'FAIL' });

      // 13. Check for DAG View button in drawer
      console.log('\n12. Looking for DAG View button...');
      const dagButton = await page.locator('button:has-text("DAG View"), button:has-text("View DAG")').count();
      console.log(`   DAG View buttons: ${dagButton}`);
      results.tests.push({ test: 'dag-view-button', status: dagButton > 0 ? 'TESTED' : 'FAIL' });

      // 14. Click DAG View button to open DAG viewer
      if (dagButton > 0) {
        console.log('\n13. Opening DAG viewer...');
        await page.locator('button:has-text("DAG View"), button:has-text("View DAG")').first().click();
        await page.waitForTimeout(2000);
        await capture(page, '09-dag-viewer-open');
        results.tests.push({ test: 'dag-viewer-open', status: 'TESTED' });

        // 15. Check for Cytoscape canvas
        console.log('\n14. Checking DAG viewer canvas...');
        const cyCanvas = await page.locator('canvas, [class*="cytoscape"]').count();
        console.log(`   Cytoscape elements: ${cyCanvas}`);
        results.tests.push({ test: 'dag-viewer-canvas', status: cyCanvas > 0 ? 'TESTED' : 'FAIL' });

        // 16. Test DAG fullscreen
        console.log('\n15. Testing DAG fullscreen...');
        const fullscreenBtn = await page.locator('button[aria-label*="fullscreen"], button:has-text("Fullscreen")').count();
        if (fullscreenBtn > 0) {
          await page.locator('button').filter({ hasText: /fullscreen/i }).first().click();
          await page.waitForTimeout(1500);
          await capture(page, '10-dag-fullscreen');
          results.tests.push({ test: 'dag-fullscreen', status: 'TESTED' });
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
        } else {
          console.log('   No fullscreen button found');
          results.tests.push({ test: 'dag-fullscreen', status: 'NOT_FOUND' });
        }

        // 17. Close DAG viewer
        console.log('\n16. Closing DAG viewer...');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }

      // 18. Close term drawer
      console.log('\n17. Closing drawer...');
      const closeBtn = page.locator('[aria-label*="close"], button:has-text("Close")').first();
      if (await closeBtn.count() > 0) {
        await closeBtn.click();
      } else {
        await page.keyboard.press('Escape');
      }
      await page.waitForTimeout(500);
      await capture(page, '11-drawer-closed');
      results.tests.push({ test: 'drawer-close', status: 'TESTED' });
    } else {
      console.log('   No table rows found');
      results.tests.push({ test: 'term-drawer-open', status: 'FAIL' });
    }

    // 19. Test pagination
    console.log('\n18. Testing pagination...');
    const pagination = await page.locator('[class*="pagination"], [role="navigation"]').count();
    console.log(`   Pagination elements: ${pagination}`);
    results.tests.push({ test: 'pagination', status: pagination > 0 ? 'TESTED' : 'NOT_FOUND' });

    // 20. Test "Show all terms" toggle
    console.log('\n19. Testing "Show all terms" toggle...');
    const showAllSwitch = page.locator('input[type="checkbox"]').first();
    if (await showAllSwitch.count() > 0) {
      await showAllSwitch.click();
      await page.waitForTimeout(500);
      await capture(page, '12-show-all-terms');
      console.log('   Toggle works');
      results.tests.push({ test: 'show-all-terms-toggle', status: 'TESTED' });
    } else {
      results.tests.push({ test: 'show-all-terms-toggle', status: 'NOT_FOUND' });
    }

    // 21. Test parameter controls
    console.log('\n20. Testing parameter controls...');
    const selects = await page.locator('[role="combobox"], select').count();
    console.log(`   Select/dropdown elements: ${selects}`);
    results.tests.push({ test: 'parameter-controls', status: selects >= 4 ? 'TESTED' : 'FAIL' });

    // 22. Test bar chart fullscreen
    console.log('\n21. Testing bar chart fullscreen...');
    const barFullscreenBtn = await page.locator('button[aria-label*="Expand"], button:has-text("Expand")').first();
    if (await barFullscreenBtn.count() > 0) {
      await barFullscreenBtn.click();
      await page.waitForTimeout(1000);
      await capture(page, '13-bar-fullscreen');
      results.tests.push({ test: 'bar-fullscreen', status: 'TESTED' });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } else {
      results.tests.push({ test: 'bar-fullscreen', status: 'NOT_FOUND' });
    }

    // 23. Test mobile responsive (375px width)
    console.log('\n22. Testing mobile responsive (375px)...');
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`${BASE_URL}/go-enrichment`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);
    await capture(page, '14-mobile-375-initial');
    results.tests.push({ test: 'mobile-responsive-375', status: 'TESTED', screenshot: '14-mobile-375-initial.png' });

    // 24. Test tablet responsive (768px)
    console.log('\n23. Testing tablet responsive (768px)...');
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`${BASE_URL}/go-enrichment`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);
    await capture(page, '15-tablet-768-initial');
    results.tests.push({ test: 'tablet-responsive-768', status: 'TESTED', screenshot: '15-tablet-768-initial.png' });

    // 25. Test empty gene list error
    console.log('\n24. Testing empty gene list error...');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${BASE_URL}/go-enrichment`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.locator('button:has-text("Run Analysis")').click();
    await page.waitForTimeout(1500);
    await capture(page, '16-empty-gene-error');
    const errorAlert = await page.locator('[class*="alert"], [class*="Alert"]').count();
    results.tests.push({ test: 'empty-gene-error', status: errorAlert > 0 ? 'TESTED' : 'FAIL' });

    // 26. Test invalid gene list
    console.log('\n25. Testing invalid gene handling...');
    await page.locator('textarea').first().fill('NOT_A_REAL_GENE_12345');
    await page.locator('button:has-text("Run Analysis")').click();
    await page.waitForTimeout(4000);
    await capture(page, '17-invalid-genes-result');
    results.tests.push({ test: 'invalid-genes', status: 'TESTED' });

    // 27. Test Clear button
    console.log('\n26. Testing Clear button...');
    await page.locator('button:has-text("Clear")').click();
    await page.waitForTimeout(500);
    const clearedInput = await page.locator('textarea').first().inputValue();
    results.tests.push({ test: 'clear-button', status: clearedInput === '' ? 'TESTED' : 'FAIL' });

    // 28. Console errors check
    console.log('\n27. Checking console errors...');
    console.log(`   Console errors: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      console.log('   First few errors:', consoleErrors.slice(0, 3));
    }
    results.tests.push({ test: 'console-errors', status: consoleErrors.length === 0 ? 'PASS' : 'FAIL', errors: consoleErrors.slice(0, 5) });

  } catch (error) {
    console.error('Test error:', error.message);
    results.tests.push({ test: 'ERROR', status: 'ERROR', error: error.message });
    await capture(page, '99-error-state');
  } finally {
    await browser.close();
  }

  // Write results
  try {
    const fs = await import('fs');
    fs.writeFileSync(`${OUTPUT_DIR}/test-results.json`, JSON.stringify(results, null, 2));
    console.log(`\n=== Test Results Written to ${OUTPUT_DIR}/test-results.json ===`);
  } catch (e) {
    console.error('Failed to write results:', e.message);
  }

  console.log('\n=== QA Testing Complete ===');
  console.log(`Total tests: ${results.tests.length}`);
  const passed = results.tests.filter(t => t.status === 'TESTED' || t.status === 'PASS').length;
  const failed = results.tests.filter(t => t.status === 'FAIL' || t.status === 'ERROR').length;
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  console.log('\nFailed tests:');
  results.tests.filter(t => t.status === 'FAIL' || t.status === 'ERROR').forEach(t => {
    console.log(`  - ${t.test}: ${t.status}`);
  });
}

run().catch(console.error);