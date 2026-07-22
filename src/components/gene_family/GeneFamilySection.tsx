import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Divider,
  Group,
  Loader,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertTriangle, IconBinaryTree, IconExternalLink } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { getGeneFamilyAnnotations, type GeneFamilyAnnotations } from '../../lib/geneFamilyApi';
import CatalogStatusBadge from './CatalogStatusBadge';
import DomainArchitecture from './DomainArchitecture';

export default function GeneFamilySection({ internalGeneId }: { internalGeneId: string }) {
  const [data, setData] = useState<GeneFamilyAnnotations | null>(null);
  const [error, setError] = useState<{ geneId: string; message: string } | null>(null);
  const [proteinId, setProteinId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getGeneFamilyAnnotations(internalGeneId)
      .then((result) => {
        if (!active) return;
        setData(result);
        setError(null);
        setProteinId(result.proteins[0]?.protein_id ?? null);
      })
      .catch((reason: unknown) => {
        if (active) setError({
          geneId: internalGeneId,
          message: reason instanceof Error ? reason.message : 'Family annotations are unavailable',
        });
      });
    return () => { active = false; };
  }, [internalGeneId]);

  const selectedProtein = useMemo(
    () => data?.proteins.find((protein) => protein.protein_id === proteinId) ?? data?.proteins[0] ?? null,
    [data, proteinId],
  );
  const currentError = error?.geneId === internalGeneId ? error.message : null;
  const loading = data?.internal_gene_id !== internalGeneId && currentError === null;

  return (
    <Paper withBorder radius="xl" p="xl">
      <Group justify="space-between" align="flex-start" mb="md">
        <Box>
          <Group gap="sm">
            <IconBinaryTree size={22} color="var(--mantine-color-cyan-7)" />
            <Title order={4}>Families & Domains</Title>
            {data && (
              <Badge variant="light" color="cyan">
                {data.summary.classification_count} assignments · {data.summary.domain_hit_count} domain hits
              </Badge>
            )}
          </Group>
          <Text size="sm" c="dimmed" mt={4}>
            Versioned classifications and protein-level evidence; candidates are shown separately from accepted assertions.
          </Text>
        </Box>
        {data && <Badge variant="outline">{data.release_id}</Badge>}
      </Group>

      {loading && <Group justify="center" py="lg"><Loader size="sm" /></Group>}
      {currentError && (
        <Alert color="orange" icon={<IconAlertTriangle size={16} />} title="Catalog temporarily unavailable">
          {currentError}
        </Alert>
      )}
      {!loading && !currentError && data && data.classifications.length === 0 && data.proteins.length === 0 && (
        <Text c="dimmed" size="sm">No family or Pfam domain annotations are available for this gene in the active release.</Text>
      )}

      {!loading && !currentError && data && (data.classifications.length > 0 || data.proteins.length > 0) && (
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="xl">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={700}>Classification assignments</Text>
              {data.summary.candidate_count > 0 && (
                <Badge color="orange" variant="light">{data.summary.candidate_count} candidates</Badge>
              )}
            </Group>
            {data.classifications.length === 0 ? (
              <Text c="dimmed" size="sm">No TF, kinase or ubiquitin-role assignment.</Text>
            ) : data.classifications.map((item) => (
              <Paper key={item.assertion_id} withBorder radius="md" p="sm">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Box>
                    <Text
                      component={Link}
                      to={`/gene-families/entry/${encodeURIComponent(item.entry_id)}`}
                      fw={650}
                      c="cyan.8"
                      style={{ textDecoration: 'none' }}
                    >
                      {item.entry_name} <IconExternalLink size={12} style={{ verticalAlign: -1 }} />
                    </Text>
                    <Text size="xs" c="dimmed">{item.scheme_name} · {item.entry_type.replaceAll('_', ' ')}</Text>
                  </Box>
                  <CatalogStatusBadge value={item.assertion_state} />
                </Group>
                <Group gap="xs" mt="xs">
                  <CatalogStatusBadge value={item.support_tier} size="xs" />
                  <CatalogStatusBadge value={item.review_state} size="xs" />
                  <CatalogStatusBadge value={item.assignment_role} size="xs" />
                  <Text size="xs" c="dimmed">{item.evidence_count} evidence records</Text>
                </Group>
              </Paper>
            ))}
          </Stack>

          <Stack gap="sm">
            <Group justify="space-between" align="flex-end">
              <Box>
                <Text fw={700}>Protein domains</Text>
                <Text size="xs" c="dimmed">Each isoform is displayed on its own coordinate track.</Text>
              </Box>
              {data.proteins.length > 1 && (
                <Select
                  aria-label="Select protein isoform"
                  size="xs"
                  w={210}
                  value={selectedProtein?.protein_id ?? null}
                  onChange={setProteinId}
                  data={data.proteins.map((protein) => ({ value: protein.protein_id, label: protein.protein_id }))}
                />
              )}
            </Group>
            <Divider />
            {selectedProtein ? (
              <DomainArchitecture
                proteinId={selectedProtein.protein_id}
                proteinLength={selectedProtein.protein_length}
                hits={selectedProtein.domain_hits}
              />
            ) : (
              <Text c="dimmed" size="sm">No mapped protein-domain architecture.</Text>
            )}
          </Stack>
        </SimpleGrid>
      )}
    </Paper>
  );
}
