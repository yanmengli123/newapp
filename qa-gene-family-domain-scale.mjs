import assert from 'node:assert/strict';
import { domainGeometry, resolveDomainScale } from './src/lib/domainScale.ts';

function domain(start, end) {
  return { ali_from: start, ali_to: end, env_from: null, env_to: null };
}

const fullScale = resolveDomainScale(1000, [domain(101, 200)]);
assert.deepEqual(fullScale, {
  scale_mode: 'full_protein',
  scale_start: 1,
  scale_end: 1000,
  protein_length_status: 'observed',
  validation_status: 'valid',
});
assert.deepEqual(domainGeometry(fullScale, domain(101, 200)), {
  left_fraction: 0.1,
  width_fraction: 0.1,
  domain_start: 101,
  domain_end: 200,
});

const localScale = resolveDomainScale(null, [domain(20, 100), domain(200, 250)]);
assert.deepEqual(localScale, {
  scale_mode: 'local_coordinate_window',
  scale_start: 20,
  scale_end: 250,
  protein_length_status: 'not_reported',
  validation_status: 'protein_length_missing',
});
const localGeometry = domainGeometry(localScale, domain(20, 100));
assert.ok(localGeometry);
assert.equal(localGeometry.left_fraction, 0);
assert.equal(localGeometry.width_fraction, 81 / 231);

const exceedsLength = resolveDomainScale(100, [domain(90, 120)]);
assert.equal(exceedsLength.validation_status, 'domain_exceeds_protein_length');
assert.equal(domainGeometry(exceedsLength, domain(90, 120)), null);

const invalidCoordinates = resolveDomainScale(100, [domain(40, 20)]);
assert.equal(invalidCoordinates.validation_status, 'invalid_domain_coordinates');
assert.equal(domainGeometry(invalidCoordinates, domain(40, 20)), null);

console.log('Gene Families domain-scale tests passed.');
