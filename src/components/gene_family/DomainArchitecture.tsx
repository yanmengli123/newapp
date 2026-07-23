import { Alert, Badge, Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import type { DomainHit, ProteinLengthStatus } from '../../lib/geneFamilyApi';
import { domainGeometry, resolveDomainScale } from '../../lib/domainScale';

function domainColor(accession: string): string {
  const palette = ['#0891b2', '#0f766e', '#7c3aed', '#c2410c', '#2563eb', '#be185d', '#4d7c0f'];
  let hash = 0;
  for (const character of accession) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

export default function DomainArchitecture({
  proteinId,
  proteinLength,
  proteinLengthStatus,
  hits,
}: {
  proteinId: string;
  proteinLength: number | null;
  proteinLengthStatus: ProteinLengthStatus;
  hits: DomainHit[];
}) {
  const scale = resolveDomainScale(proteinLengthStatus === 'observed' ? proteinLength : null, hits);
  const coordinateError = ['domain_exceeds_protein_length', 'invalid_domain_coordinates'].includes(scale.validation_status);
  const scaleLabel = scale.scale_mode === 'full_protein'
    ? `${scale.scale_end.toLocaleString()} aa · ${hits.length} domain hits`
    : `Local coordinate window ${scale.scale_start.toLocaleString()}–${scale.scale_end.toLocaleString()} aa`;

  return (
    <Stack
      gap="xs"
      data-domain-architecture
      data-protein-id={proteinId}
      data-protein-length={proteinLength ?? 'unknown'}
      data-protein-length-status={scale.protein_length_status}
      data-scale-mode={scale.scale_mode}
      data-scale-start={scale.scale_start}
      data-scale-end={scale.scale_end}
      data-validation-status={scale.validation_status}
    >
      <Group justify="space-between" gap="xs">
        <Text size="sm" fw={600} ff="monospace">{proteinId}</Text>
        <Group gap="xs">
          {scale.protein_length_status === 'not_reported' && (
            <Badge color="orange" variant="light" size="xs">Protein length not reported</Badge>
          )}
          <Text size="xs" c="dimmed">{scaleLabel}</Text>
        </Group>
      </Group>
      {coordinateError ? (
        <Alert color="red" icon={<IconAlertTriangle size={17} />} title="Domain coordinate validation failed">
          {scale.validation_status === 'domain_exceeds_protein_length'
            ? 'At least one domain extends beyond the reported protein length. The track is withheld instead of clipping the coordinates.'
            : 'At least one domain has missing, non-positive or reversed coordinates. The track is withheld for scientific review.'}
        </Alert>
      ) : (
        <Box
          role="img"
          aria-label={`Pfam domain architecture for ${proteinId}; ${scaleLabel}`}
          pos="relative"
          h={44}
          data-domain-track
          style={{ borderRadius: 8, background: 'var(--mantine-color-gray-0)', overflow: 'hidden' }}
        >
          <Box pos="absolute" left={0} right={0} top={21} h={3} bg="gray.4" style={{ borderRadius: 3 }} />
          {hits.map((hit, index) => {
            const geometry = domainGeometry(scale, hit);
            if (geometry == null) return null;
            const content = `${hit.pfam_accession} · ${hit.pfam_name} · ${geometry.domain_start}–${geometry.domain_end} aa${
              hit.independent_evalue == null ? '' : ` · i-Evalue ${hit.independent_evalue.toExponential(2)}`
            }`;
            return (
              <Tooltip key={`${hit.assertion_id}-${hit.domain_index ?? index}`} label={content} withArrow>
                <Box
                  component={Link}
                  to={`/gene-families/entry/${encodeURIComponent(hit.entry_id)}`}
                  aria-label={content}
                  data-domain-hit
                  data-domain-start={geometry.domain_start}
                  data-domain-end={geometry.domain_end}
                  data-left-fraction={geometry.left_fraction}
                  data-width-fraction={geometry.width_fraction}
                  pos="absolute"
                  top={9}
                  left={`${geometry.left_fraction * 100}%`}
                  w={`${geometry.width_fraction * 100}%`}
                  h={27}
                  style={{
                    borderRadius: 6,
                    background: domainColor(hit.pfam_accession),
                    border: '2px solid white',
                    boxShadow: '0 1px 3px rgba(0,0,0,.18)',
                    minWidth: 1,
                  }}
                />
              </Tooltip>
            );
          })}
        </Box>
      )}
      <Group gap="xs">
        {Array.from(new Map(hits.map((hit) => [hit.pfam_accession, hit])).values()).map((hit) => (
          <Group key={hit.pfam_accession} gap={5}>
            <Box w={9} h={9} style={{ borderRadius: 3, background: domainColor(hit.pfam_accession) }} />
            <Text
              component={Link}
              to={`/gene-families/entry/${encodeURIComponent(hit.entry_id)}`}
              size="xs"
              c="cyan.8"
              style={{ textDecoration: 'none' }}
            >
              {hit.pfam_name} ({hit.pfam_accession})
            </Text>
          </Group>
        ))}
      </Group>
    </Stack>
  );
}
