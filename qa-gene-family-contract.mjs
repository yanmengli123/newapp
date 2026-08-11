import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const architecture = readFileSync('src/components/gene_family/DomainArchitecture.tsx', 'utf8');
const entryPage = readFileSync('src/pages/GeneFamilyEntryPage.tsx', 'utf8');
const geneSection = readFileSync('src/components/gene_family/GeneFamilySection.tsx', 'utf8');
const genePage = readFileSync('src/pages/GenePage.tsx', 'utf8');
const scale = readFileSync('src/lib/domainScale.ts', 'utf8');
const browserAcceptance = readFileSync('qa-gene-family-browser.mjs', 'utf8');

assert.ok(
  architecture.includes('resolveDomainScale(') && architecture.includes('domainGeometry('),
  'DomainArchitecture must use the shared validated scale and geometry functions',
);
assert.ok(
  architecture.includes("data-protein-length-status={scale.protein_length_status}"),
  'DomainArchitecture must expose the resolved protein-length status for browser verification',
);
assert.ok(
  architecture.includes("scale.scale_mode === 'full_protein'")
    && architecture.includes('Protein length not reported')
    && architecture.includes('Local coordinate window'),
  'Full-protein and local-coordinate modes must be explicitly labelled',
);
assert.ok(
  !architecture.includes('Math.max(...hits.map') && !architecture.includes('Math.max(1, ...hits.map'),
  'DomainArchitecture must not silently infer protein length from the maximum domain endpoint',
);
assert.ok(
  scale.includes("validation_status: 'domain_exceeds_protein_length'")
    && architecture.includes('The track is withheld instead of clipping the coordinates.'),
  'Out-of-bounds domain evidence must be rejected explicitly instead of clipped',
);

for (const [name, source] of [
  ['GeneFamilyEntryPage', entryPage],
  ['GeneFamilySection', geneSection],
]) {
  assert.ok(source.includes('<DomainArchitecture'), `${name} must use the shared DomainArchitecture component`);
  assert.ok(source.includes('proteinLength='), `${name} must pass proteinLength`);
  assert.ok(source.includes('proteinLengthStatus='), `${name} must pass proteinLengthStatus`);
}

assert.ok(
  !entryPage.includes('proteinLength={null}'),
  'The family entry page must not discard observed protein lengths',
);
assert.ok(
  genePage.includes("import GeneFamilySection from \"../components/gene_family/GeneFamilySection\"")
    && genePage.includes('<GeneFamilySection'),
  'GenePage must embed the same GeneFamilySection that uses the shared DomainArchitecture component',
);

assert.ok(
  browserAcceptance.includes("const frontendMarker = '<title>newapp</title>'")
    && browserAcceptance.includes('httpIsHealthy(frontendHealthUrl, frontendMarker)')
    && browserAcceptance.includes('await getAvailablePort()')
    && browserAcceptance.includes("'--port'")
    && browserAcceptance.includes('String(frontendPort)'),
  'Browser acceptance must verify the frontend identity instead of trusting any HTTP 200 response',
);

console.log('Gene Families frontend contract checks passed.');
