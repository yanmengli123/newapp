export type ProteinLengthStatus = 'observed' | 'not_reported';

export type DomainScaleMode = 'full_protein' | 'local_coordinate_window';

export type DomainScaleValidationStatus =
  | 'valid'
  | 'protein_length_missing'
  | 'domain_exceeds_protein_length'
  | 'invalid_domain_coordinates';

export interface DomainCoordinates {
  ali_from: number | null;
  ali_to: number | null;
  env_from: number | null;
  env_to: number | null;
}

export interface DomainScale {
  scale_mode: DomainScaleMode;
  scale_start: number;
  scale_end: number;
  protein_length_status: ProteinLengthStatus;
  validation_status: DomainScaleValidationStatus;
}

export interface DomainGeometry {
  left_fraction: number;
  width_fraction: number;
  domain_start: number;
  domain_end: number;
}

function coordinateRange(domain: DomainCoordinates): { start: number; end: number } | null {
  const start = domain.ali_from ?? domain.env_from;
  const end = domain.ali_to ?? domain.env_to;
  if (start == null || end == null || !Number.isInteger(start) || !Number.isInteger(end)) return null;
  return { start, end };
}

export function resolveDomainScale(
  proteinLength: number | null,
  domains: DomainCoordinates[],
): DomainScale {
  const ranges = domains.map(coordinateRange);
  const validRanges = ranges.filter((item): item is { start: number; end: number } => item !== null);
  const fallbackStart = validRanges.length > 0 ? Math.min(...validRanges.map((item) => item.start)) : 1;
  const fallbackEnd = validRanges.length > 0 ? Math.max(...validRanges.map((item) => item.end)) : 1;
  const proteinLengthStatus: ProteinLengthStatus = proteinLength == null ? 'not_reported' : 'observed';

  if (
    ranges.some((item) => item === null)
    || validRanges.some((item) => item.start < 1 || item.end < item.start)
    || (proteinLength != null && (!Number.isInteger(proteinLength) || proteinLength < 1))
  ) {
    return {
      scale_mode: proteinLengthStatus === 'observed' ? 'full_protein' : 'local_coordinate_window',
      scale_start: proteinLengthStatus === 'observed' ? 1 : fallbackStart,
      scale_end: proteinLengthStatus === 'observed' ? Math.max(proteinLength ?? 1, 1) : fallbackEnd,
      protein_length_status: proteinLengthStatus,
      validation_status: 'invalid_domain_coordinates',
    };
  }

  if (proteinLength != null) {
    if (validRanges.some((item) => item.end > proteinLength)) {
      return {
        scale_mode: 'full_protein',
        scale_start: 1,
        scale_end: proteinLength,
        protein_length_status: 'observed',
        validation_status: 'domain_exceeds_protein_length',
      };
    }
    return {
      scale_mode: 'full_protein',
      scale_start: 1,
      scale_end: proteinLength,
      protein_length_status: 'observed',
      validation_status: 'valid',
    };
  }

  return {
    scale_mode: 'local_coordinate_window',
    scale_start: fallbackStart,
    scale_end: fallbackEnd,
    protein_length_status: 'not_reported',
    validation_status: 'protein_length_missing',
  };
}

export function domainGeometry(
  scale: DomainScale,
  domain: DomainCoordinates,
): DomainGeometry | null {
  if (!['valid', 'protein_length_missing'].includes(scale.validation_status)) return null;
  const coordinates = coordinateRange(domain);
  if (coordinates == null) return null;
  const span = scale.scale_end - scale.scale_start + 1;
  if (span < 1 || coordinates.start < scale.scale_start || coordinates.end > scale.scale_end) return null;
  return {
    left_fraction: (coordinates.start - scale.scale_start) / span,
    width_fraction: (coordinates.end - coordinates.start + 1) / span,
    domain_start: coordinates.start,
    domain_end: coordinates.end,
  };
}
