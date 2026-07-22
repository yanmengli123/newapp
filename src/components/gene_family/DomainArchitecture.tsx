import { Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Link } from 'react-router-dom';
import type { DomainHit } from '../../lib/geneFamilyApi';

function domainColor(accession: string): string {
  const palette = ['#0891b2', '#0f766e', '#7c3aed', '#c2410c', '#2563eb', '#be185d', '#4d7c0f'];
  let hash = 0;
  for (const character of accession) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

function range(hit: DomainHit, proteinLength: number): { left: number; width: number } {
  const from = hit.ali_from ?? hit.env_from ?? 1;
  const to = hit.ali_to ?? hit.env_to ?? from;
  return {
    left: Math.max(0, Math.min(100, ((from - 1) / proteinLength) * 100)),
    width: Math.max(1.2, Math.min(100, ((to - from + 1) / proteinLength) * 100)),
  };
}

export default function DomainArchitecture({
  proteinId,
  proteinLength,
  hits,
}: {
  proteinId: string;
  proteinLength: number | null;
  hits: DomainHit[];
}) {
  const inferredLength = Math.max(
    1,
    proteinLength ?? Math.max(...hits.map((hit) => hit.ali_to ?? hit.env_to ?? 1), 1),
  );
  return (
    <Stack gap="xs">
      <Group justify="space-between" gap="xs">
        <Text size="sm" fw={600} ff="monospace">{proteinId}</Text>
        <Text size="xs" c="dimmed">{inferredLength.toLocaleString()} aa · {hits.length} domain hits</Text>
      </Group>
      <Box
        role="img"
        aria-label={`Pfam domain architecture for ${proteinId}`}
        pos="relative"
        h={44}
        style={{ borderRadius: 8, background: 'var(--mantine-color-gray-0)', overflow: 'hidden' }}
      >
        <Box pos="absolute" left="2%" right="2%" top={21} h={3} bg="gray.4" style={{ borderRadius: 3 }} />
        {hits.map((hit, index) => {
          const position = range(hit, inferredLength);
          const content = `${hit.pfam_accession} · ${hit.pfam_name} · ${hit.ali_from ?? '?'}–${hit.ali_to ?? '?'} aa${
            hit.independent_evalue == null ? '' : ` · i-Evalue ${hit.independent_evalue.toExponential(2)}`
          }`;
          return (
            <Tooltip key={`${hit.assertion_id}-${hit.domain_index ?? index}`} label={content} withArrow>
              <Box
                component={Link}
                to={`/gene-families/entry/${encodeURIComponent(hit.entry_id)}`}
                aria-label={content}
                pos="absolute"
                top={9}
                left={`${position.left}%`}
                w={`${position.width}%`}
                h={27}
                style={{
                  borderRadius: 6,
                  background: domainColor(hit.pfam_accession),
                  border: '2px solid white',
                  boxShadow: '0 1px 3px rgba(0,0,0,.18)',
                  minWidth: 7,
                }}
              />
            </Tooltip>
          );
        })}
      </Box>
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
