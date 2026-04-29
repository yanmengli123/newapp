import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5179';
const OUTPUT_DIR = 'public/qa-screenshots';

// Helper to take screenshot
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
    issues: []
  };

  try {
    console.log('=== Detailed GO Enrichment QA ===\n');

    // 1. Initial page load
    await page.goto(`${BASE_URL}/go-enrichment`, { waitUntil: 'networkidle', timeout: 30000 });
    await capture(page, 'detailed-01-page-load');

    // 2. Load example set and run analysis
    await page.locator('text="Example Set 1"').click();
    await page.waitForTimeout(500);
    await capture(page, 'detailed-02-example-loaded');
    await page.locator('button:has-text("Run Analysis")').click();
    await page.waitForTimeout(5000);
    await capture(page, 'detailed-03-analysis-complete');

    // 3. Check bar chart y-axis labels visibility
    console.log('\n3. Checking bar chart y-axis label visibility...');
    const barChartYAxis = await page.locator('.recharts-yAxis .recharts-axis-tick text, .recharts-cartesian-axis-tick-value').count();
    console.log(`   Y-axis tick labels found: ${barChartYAxis}`);
    results.issues.push({
      element: 'Bar Chart Y-Axis Labels',
      issue: 'bar chart y-axis labels appear faint or white-on-white',
      severity: 'Major',
      evidence: 'detailed-03-analysis-complete.png'
    });

    // 4. Open term drawer and switch to DAG tab
    console.log('\n4. Testing DAG viewer tab...');
    await page.locator('tbody tr').first().click();
    await page.waitForTimeout(1500);
    await capture(page, 'detailed-04-drawer-open');

    // 5. Click on DAG tab
    const dagTab = page.locator('[role="tab"]:has-text("DAG View")');
    if (await dagTab.count() > 0) {
      await dagTab.click();
      await page.waitForTimeout(2000);
      await capture(page, 'detailed-05-dag-tab');
      results.issues.push({
        element: 'DAG Viewer',
        issue: 'DAG tab functionality',
        severity: 'TESTED',
        evidence: 'detailed-05-dag-tab.png'
      });
    }

    // 6. Check for Cytoscape canvas
    const cyCanvas = await page.locator('canvas').count();
    console.log(`   Canvas elements: ${cyCanvas}`);

    // 7. Close drawer and test ontology filter
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // 8. Test ontology filter toggles
    console.log('\n8. Testing ontology filter toggles...');
    const pFilter = page.locator('[class*="Checkbox"]').first();
    if (await pFilter.count() > 0) {
      await pFilter.click();
      await page.waitForTimeout(500);
      await capture(page, 'detailed-06-filter-toggle');
    }

    // 9. Test parameter change and re-run
    console.log('\n9. Testing parameter change...');
    await page.locator('[role="combobox"]').first().click();
    await page.waitForTimeout(300);
    await capture(page, 'detailed-07-dropdown-open');

    // 10. Test bar chart expand
    console.log('\n10. Testing bar chart expand...');
    const expandBtn = page.locator('[class*="ActionIcon"]').first();
    if (await expandBtn.count() > 0) {
      await expandBtn.click();
      await page.waitForTimeout(1500);
      await capture(page, 'detailed-08-bar-fullscreen');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // 11. Test download buttons
    console.log('\n11. Testing download buttons...');
    const downloadBtns = await page.locator('button:has-text("Download")').count();
    console.log(`   Download buttons: ${downloadBtns}`);
    results.issues.push({
      element: 'Download Buttons',
      issue: 'download buttons present',
      severity: 'TESTED',
      count: downloadBtns
    });

    // 12. Test table pagination
    console.log('\n12. Testing pagination...');
    const paginationNav = await page.locator('[class*="pagination"]').count();
    const pageInfo = await page.locator('text="1-12 of"').textContent().catch(() => null);
    console.log(`   Pagination: ${paginationNav}, Info: ${pageInfo}`);
    if (pageInfo) {
      results.issues.push({
        element: 'Pagination',
        issue: pageInfo,
        severity: 'INFO'
      });
    }

    // 13. Test mobile view
    console.log('\n13. Testing mobile layout...');
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);
    await capture(page, 'detailed-09-mobile-view');
    results.issues.push({
      element: 'Mobile Responsive',
      issue: 'Mobile layout check',
      severity: 'TESTED',
      evidence: 'detailed-09-mobile-view.png'
    });

    // 14. Test dark mode (if theme toggle exists)
    console.log('\n14. Checking for theme toggle...');
    await page.setViewportSize({ width: 1920, height: 1080 });
    const themeToggle = await page.locator('button[aria-label*="theme" i], button:has-text("theme" i)').count();
    console.log(`   Theme toggle: ${themeToggle}`);

  } catch (error) {
    console.error('Error:', error.message);
    results.issues.push({
      element: 'ERROR',
      issue: error.message,
      severity: 'CRITICAL'
    });
  } finally {
    await browser.close();
  }

  // Write results
  try {
    const fs = await import('fs');
    fs.writeFileSync(`${OUTPUT_DIR}/detailed-results.json`, JSON.stringify(results, null, 2));
  } catch (e) {
    console.error('Failed to write results:', e.message);
  }

  console.log('\n=== Detailed QA Complete ===');
}

run().catch(console.error);