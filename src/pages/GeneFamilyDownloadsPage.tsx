import { useEffect, useState } from 'react';
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { IconAlertTriangle, IconArrowLeft, IconDatabase, IconDownload, IconFileAnalytics } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../lib/apiClient';
import { getCatalogRelease, getReleaseAssets, type CatalogRelease, type ReleaseAsset } from '../lib/geneFamilyApi';

function bytes(value: number | null): string {
  if (value == null) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

export default function GeneFamilyDownloadsPage() {
  const [release, setRelease] = useState<CatalogRelease | null>(null);
  const [assets, setAssets] = useState<ReleaseAsset[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCatalogRelease()
      .then(async (result) => {
        setRelease(result);
        const downloadResult = await getReleaseAssets(result.release_id);
        setAssets(downloadResult.data);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Release package is unavailable'));
  }, []);

  if (!release && !error) return <Group justify="center" py="xl"><Loader /></Group>;
  if (error) return <Alert color="red" title="Downloads unavailable">{error}</Alert>;
  if (!release) return null;

  return (
    <Stack gap="xl">
      <Anchor component={Link} to="/gene-families" size="sm"><Group gap={6}><IconArrowLeft size={15} /> Back to catalog</Group></Anchor>
      <Group justify="space-between" align="flex-end">
        <Box>
          <Badge color={release.qc_status === 'passed' ? 'teal' : 'orange'}>{release.release_status.replaceAll('_', ' ')}</Badge>
          <Title order={1} mt="sm">Downloads & methods</Title>
          <Text c="dimmed" mt="xs">Immutable catalog release, provenance, mapping exceptions and biological regression results.</Text>
        </Box>
        <Badge variant="outline" size="lg">{release.release_id}</Badge>
      </Group>

      {release.qc_status === 'blocked' && (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="RC1 has open publication blockers">
          This package is suitable for development and scientific review, not yet for citation as a final published release.
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
        <Paper withBorder radius="lg" p="lg">
          <ThemeIcon variant="light" size="xl" radius="md"><IconDatabase size={24} /></ThemeIcon>
          <Text fw={700} mt="md">Assembly</Text>
          <Title order={3}>{release.assembly_name}</Title>
          <Text size="sm" c="dimmed">{release.assembly_accession} · Taxonomy {release.taxon_id}</Text>
        </Paper>
        <Paper withBorder radius="lg" p="lg">
          <ThemeIcon variant="light" size="xl" radius="md" color="teal"><IconFileAnalytics size={24} /></ThemeIcon>
          <Text fw={700} mt="md">Schema</Text>
          <Title order={3}>{release.schema_version}</Title>
          <Text size="sm" c="dimmed">Assertion-centric SQLite publication layer</Text>
        </Paper>
        <Paper withBorder radius="lg" p="lg">
          <ThemeIcon variant="light" size="xl" radius="md" color="orange"><IconAlertTriangle size={24} /></ThemeIcon>
          <Text fw={700} mt="md">QC state</Text>
          <Title order={3}>{release.qc_status}</Title>
          <Text size="sm" c="dimmed">{release.blocking_checks?.length ?? 0} blocking checks retained transparently</Text>
        </Paper>
      </SimpleGrid>

      <Paper withBorder radius="lg" p="lg">
        <Title order={2}>Release assets</Title>
        <Text c="dimmed" size="sm" mt={4} mb="md">
          Large downloads come from the immutable release package, not from the rows currently loaded in the browser.
        </Text>
        <Table.ScrollContainer minWidth={760}>
          <Table striped verticalSpacing="sm">
            <Table.Thead><Table.Tr><Table.Th>Asset</Table.Th><Table.Th>Description</Table.Th><Table.Th>SHA-256</Table.Th><Table.Th ta="right">Size</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {assets.map((asset) => (
                <Table.Tr key={asset.asset_id}>
                  <Table.Td><Text fw={650} ff="monospace" size="sm">{asset.asset_name}</Text></Table.Td>
                  <Table.Td><Text size="sm">{asset.description}</Text></Table.Td>
                  <Table.Td><Text ff="monospace" size="xs" c="dimmed">{asset.sha256 ? `${asset.sha256.slice(0, 12)}…` : 'See checksums.sha256'}</Text></Table.Td>
                  <Table.Td ta="right">{bytes(asset.byte_size)}</Table.Td>
                  <Table.Td ta="right">
                    <Button component="a" href={`${API_BASE}${asset.download_url}`} size="compact-sm" variant="light" leftSection={<IconDownload size={14} />}>
                      Download
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Paper withBorder radius="lg" p="lg">
          <Title order={3}>Publication model</Title>
          <Stack gap="xs" mt="md">
            <Text size="sm"><strong>Source evidence:</strong> immutable rows with checksums and source-record IDs.</Text>
            <Text size="sm"><strong>Assertions:</strong> subject → entry conclusions linked to rules and evidence.</Text>
            <Text size="sm"><strong>Publication views:</strong> accepted, candidate and unresolved results recomputed from assertions.</Text>
            <Text size="sm"><strong>Review history:</strong> append-only events; no in-place edits to a published release.</Text>
          </Stack>
        </Paper>
        <Paper withBorder radius="lg" p="lg">
          <Title order={3}>Open QC gates</Title>
          <Stack gap="sm" mt="md">
            {release.blocking_checks?.map((check) => (
              <Box key={check.check_name}>
                <Group gap="xs"><Badge color="orange" size="xs">Blocked</Badge><Text fw={650} size="sm">{check.check_name.replaceAll('_', ' ')}</Text></Group>
                <Text size="xs" c="dimmed" mt={3}>{check.details}</Text>
              </Box>
            ))}
          </Stack>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
