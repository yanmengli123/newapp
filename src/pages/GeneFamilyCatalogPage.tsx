import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconBinaryTree,
  IconDatabase,
  IconDna,
  IconDownload,
  IconFlask,
  IconSearch,
  IconShieldCheck,
} from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import CatalogStatusBadge from '../components/gene_family/CatalogStatusBadge';
import {
  getCatalogSummary,
  getEntries,
  searchCatalog,
  type CatalogEntrySummary,
  type CatalogSearchResponse,
  type CatalogSummary,
  type EntryListResponse,
} from '../lib/geneFamilyApi';

function count(value: number | undefined): string {
  return (value ?? 0).toLocaleString();
}

function pct(value: number | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function moduleCard(
  title: string,
  subtitle: string,
  color: string,
  icon: ReactNode,
  metrics: Array<[string, number | string]>,
  onClick: () => void,
) {
  return (
    <Card withBorder radius="lg" p="lg" key={title}>
      <Group justify="space-between" align="flex-start">
        <ThemeIcon color={color} variant="light" radius="md" size="lg">{icon}</ThemeIcon>
        <Button variant="subtle" color={color} size="compact-sm" onClick={onClick}>Browse</Button>
      </Group>
      <Title order={4} mt="md">{title}</Title>
      <Text size="sm" c="dimmed" mih={42}>{subtitle}</Text>
      <Divider my="sm" />
      <SimpleGrid cols={2} spacing="xs">
        {metrics.map(([label, value]) => (
          <Box key={label}>
            <Text fw={750} size="lg">{typeof value === 'number' ? count(value) : value}</Text>
            <Text size="xs" c="dimmed">{label}</Text>
          </Box>
        ))}
      </SimpleGrid>
    </Card>
  );
}

export default function GeneFamilyCatalogPage() {
  const [summary, setSummary] = useState<CatalogSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [scheme, setScheme] = useState<string | null>(null);
  const [entryQuery, setEntryQuery] = useState('');
  const [includeCandidates, setIncludeCandidates] = useState(false);
  const [sort, setSort] = useState<'accepted_genes' | 'candidate_genes' | 'name'>('accepted_genes');
  const [entryResult, setEntryResult] = useState<EntryListResponse | null>(null);
  const [entryLoading, setEntryLoading] = useState(true);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [globalQuery, setGlobalQuery] = useState('');
  const [searchResult, setSearchResult] = useState<CatalogSearchResponse | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    getCatalogSummary().then(setSummary).catch((reason: unknown) => {
      setSummaryError(reason instanceof Error ? reason.message : 'Catalog summary is unavailable');
    });
  }, []);

  useEffect(() => {
    let active = true;
    setEntryLoading(true);
    setEntryError(null);
    const timer = window.setTimeout(() => {
      getEntries({
        scheme: scheme ?? undefined,
        query: entryQuery || undefined,
        includeCandidates,
        sort,
        limit: 50,
      })
        .then((result) => { if (active) setEntryResult(result); })
        .catch((reason: unknown) => {
          if (active) setEntryError(reason instanceof Error ? reason.message : 'Catalog entries are unavailable');
        })
        .finally(() => { if (active) setEntryLoading(false); });
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [scheme, entryQuery, includeCandidates, sort]);

  useEffect(() => {
    let active = true;
    if (globalQuery.trim().length < 2) {
      setSearchResult(null);
      setSearching(false);
      return () => { active = false; };
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchCatalog(globalQuery.trim())
        .then((result) => { if (active) setSearchResult(result); })
        .catch(() => { if (active) setSearchResult(null); })
        .finally(() => { if (active) setSearching(false); });
    }, 280);
    return () => { active = false; window.clearTimeout(timer); };
  }, [globalQuery]);

  const schemes = useMemo(
    () => new Map(summary?.schemes.map((item) => [item.scheme_id, item]) ?? []),
    [summary],
  );
  const pfam = schemes.get('pfam');
  const tf = schemes.get('animaltfdb_tf');
  const cofactor = schemes.get('animaltfdb_cofactor');
  const kinase = schemes.get('kinomer');
  const ubiquitin = schemes.get('ubiquitin_core');
  const related = schemes.get('ubiquitin_related_domain');

  function chooseScheme(next: string) {
    setScheme(next);
    window.setTimeout(() => document.getElementById('catalog-directory')?.scrollIntoView({ behavior: 'smooth' }), 0);
  }

  async function loadMore() {
    const cursor = entryResult?.meta.next_cursor;
    if (!cursor) return;
    setEntryLoading(true);
    try {
      const next = await getEntries({
        scheme: scheme ?? undefined,
        query: entryQuery || undefined,
        includeCandidates,
        sort,
        cursor,
        limit: 50,
      });
      setEntryResult((current) => current ? { ...next, data: [...current.data, ...next.data] } : next);
    } catch (reason) {
      setEntryError(reason instanceof Error ? reason.message : 'Could not load more entries');
    } finally {
      setEntryLoading(false);
    }
  }

  const schemeOptions = summary?.schemes.map((item) => ({ value: item.scheme_id, label: item.scheme_name })) ?? [];
  const topMax = Math.max(1, ...(summary?.top_entries.map((entry) => entry.accepted_genes) ?? [1]));

  return (
    <Stack gap="xl">
      <Paper
        radius="xl"
        p={{ base: 'lg', md: 'xl' }}
        style={{ background: 'linear-gradient(135deg, var(--mantine-color-cyan-9), var(--mantine-color-teal-7))', color: 'white' }}
      >
        <Badge color="white" c="cyan.9" variant="filled">Gallus gallus · Taxonomy 9031</Badge>
        <Title order={1} mt="md" maw={920}>Gene, Protein Family & Domain Annotation Catalog</Title>
        <Text mt="sm" maw={850} c="cyan.0">
          Traceable AnimalTFDB, Kinomer, ubiquitin-system and Pfam-HMMER assertions, with protein isoforms,
          source evidence and candidate records kept scientifically distinct.
        </Text>
        <Group mt="lg" gap="sm">
          <Badge variant="outline" color="white">Assembly GRCg6a · GCF_000002315.6</Badge>
          {summary && <Badge variant="outline" color="white">{summary.release.release_id}</Badge>}
          {summary && <Badge color={summary.release.qc_status === 'passed' ? 'teal' : 'orange'}>{summary.release.qc_status} QC</Badge>}
        </Group>
        <TextInput
          mt="xl"
          size="md"
          radius="md"
          aria-label="Search genes, proteins and catalog entries"
          placeholder="Search gene symbol, ChickenData ID, NCBI, Ensembl, RefSeq protein or PF00069"
          leftSection={<IconSearch size={18} />}
          rightSection={searching ? <Loader size={15} /> : undefined}
          value={globalQuery}
          onChange={(event) => setGlobalQuery(event.currentTarget.value)}
        />
        {searchResult && (
          searchResult.entries.length > 0
          || searchResult.genes.length > 0
          || searchResult.proteins.length > 0
          || searchResult.source_assertions.length > 0
        ) && (
          <Paper mt="xs" p="md" radius="md" c="dark" bg="white">
            <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }} spacing="lg">
              <Box>
                <Text fw={700} size="sm" mb="xs">Catalog entries</Text>
                <Stack gap={5}>
                  {searchResult.entries.slice(0, 5).map((entry) => (
                    <Anchor key={entry.entry_id} component={Link} to={`/gene-families/entry/${encodeURIComponent(entry.entry_id)}`} size="sm">
                      {entry.name} <Text component="span" size="xs" c="dimmed">({entry.accession})</Text>
                    </Anchor>
                  ))}
                </Stack>
              </Box>
              <Box>
                <Text fw={700} size="sm" mb="xs">Genes</Text>
                <Stack gap={5}>
                  {searchResult.genes.slice(0, 5).map((gene) => (
                    <Anchor key={gene.internal_gene_id} component={Link} to={gene.internal_url} size="sm">
                      {gene.gene_symbol || gene.internal_gene_id} <Text component="span" size="xs" c="dimmed">{gene.ncbi_gene_id}</Text>
                    </Anchor>
                  ))}
                </Stack>
              </Box>
              <Box>
                <Text fw={700} size="sm" mb="xs">Proteins</Text>
                <Stack gap={5}>
                  {searchResult.proteins.slice(0, 5).map((protein) => (
                    <Text key={protein.protein_accession} size="sm" ff="monospace">
                      {protein.protein_accession} <Text component="span" size="xs" c="dimmed">{protein.gene_symbol}</Text>
                    </Text>
                  ))}
                </Stack>
              </Box>
              <Box>
                <Text fw={700} size="sm" mb="xs">Source assertions needing mapping</Text>
                <Stack gap="sm">
                  {searchResult.source_assertions.slice(0, 5).map((assertion) => (
                    <Box key={assertion.assertion_id} data-source-assertion={assertion.assertion_id}>
                      <Anchor component={Link} to={assertion.entry_url} size="sm" fw={650}>
                        {assertion.gene_symbol || assertion.source_accession}
                      </Anchor>
                      <Text size="xs" c="dimmed">{assertion.entry_name} · {assertion.ncbi_gene_id || assertion.source_accession}</Text>
                      <Group gap={5} mt={3}>
                        <CatalogStatusBadge value={assertion.assertion_state} size="xs" />
                        <CatalogStatusBadge value={assertion.mapping_state} size="xs" />
                        <CatalogStatusBadge value={assertion.review_state} size="xs" />
                      </Group>
                      <Text size="xs" c="dimmed" mt={3}>Internal gene: Not assigned</Text>
                    </Box>
                  ))}
                </Stack>
              </Box>
            </SimpleGrid>
          </Paper>
        )}
        {searchResult
          && searchResult.entries.length === 0
          && searchResult.genes.length === 0
          && searchResult.proteins.length === 0
          && searchResult.source_assertions.length === 0
          && <Text size="sm" mt="xs" c="cyan.0">No catalog records match this search.</Text>}
      </Paper>

      {summaryError && <Alert color="red" title="Catalog unavailable">{summaryError}</Alert>}
      {!summary && !summaryError && <Group justify="center"><Loader /></Group>}
      {summary && summary.release.qc_status === 'blocked' && (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="Release candidate — not a final published release">
          The catalog is usable for review, but {summary.release.blocking_checks?.length ?? 'several'} source/provenance QC gates remain open.
          Accepted and candidate records are kept separate throughout this preview.
        </Alert>
      )}

      {summary && (
        <>
          <Group justify="space-between" align="flex-end">
            <Box>
              <Title order={2}>Four evidence-aware modules</Title>
              <Text c="dimmed">Each card uses its biologically correct counting unit; module totals are never added together.</Text>
            </Box>
            <Paper withBorder radius="md" px="md" py="xs">
              <Text size="xs" c="dimmed">Unique mapped genes with ≥1 annotation</Text>
              <Text fw={800} size="xl">{count(summary.unique_annotated_genes)}</Text>
            </Paper>
          </Group>
          <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }} spacing="md">
            {moduleCard(
              'Pfam entries & domains',
              'Protein-level profile-HMM hits with every domain coordinate retained.',
              'cyan',
              <IconDna size={20} />,
              [['Domain hits', pfam?.domain_hits ?? 0], ['Proteins', pfam?.annotated_proteins ?? 0], ['Mapped genes', pfam?.accepted_genes ?? 0], ['Entries', pfam?.entry_count ?? 0]],
              () => chooseScheme('pfam'),
            )}
            {moduleCard(
              'Transcription regulators',
              'AnimalTFDB TF and cofactor classifications with local support kept orthogonal.',
              'blue',
              <IconBinaryTree size={20} />,
              [['TF records', tf?.accepted_assertions ?? 0], ['Cofactor records', cofactor?.accepted_assertions ?? 0], ['TF families', tf?.entry_count ?? 0], ['Unresolved mappings', (tf?.mapping_unresolved ?? 0) + (cofactor?.mapping_unresolved ?? 0)]],
              () => chooseScheme('animaltfdb_tf'),
            )}
            {moduleCard(
              'Protein kinases',
              'Kinomer protein classifications with explicit gene rollups and isoform conflicts.',
              'violet',
              <IconFlask size={20} />,
              [['Accepted genes', kinase?.accepted_genes ?? 0], ['Candidate genes', kinase?.candidate_genes ?? 0], ['Kinase proteins', kinase?.annotated_proteins ?? 0], ['Unresolved genes', kinase?.unresolved_genes ?? 0]],
              () => chooseScheme('kinomer'),
            )}
            {moduleCard(
              'Ubiquitin system',
              'Core E1/E2/E3/DUB assertions separated from UBD and ULD supplementary domains.',
              'orange',
              <IconShieldCheck size={20} />,
              [['Accepted assertions', ubiquitin?.accepted_assertions ?? 0], ['Mapped accepted genes', ubiquitin?.accepted_genes ?? 0], ['Candidates', ubiquitin?.candidate_assertions ?? 0], ['Supplementary genes', related?.accepted_genes ?? 0]],
              () => chooseScheme('ubiquitin_core'),
            )}
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="xl">
            <Paper withBorder radius="lg" p="lg" style={{ gridColumn: 'span 2' }}>
              <Group justify="space-between" mb="md">
                <Box>
                  <Title order={3}>Largest mapped entries</Title>
                  <Text size="sm" c="dimmed">Top entries by distinct accepted mapped genes.</Text>
                </Box>
                <Badge variant="light">Gene-level comparison</Badge>
              </Group>
              <Stack gap="sm">
                {summary.top_entries.slice(0, 8).map((entry) => (
                  <Box key={entry.entry_id}>
                    <Group justify="space-between" gap="sm" wrap="nowrap">
                      <Anchor component={Link} to={`/gene-families/entry/${encodeURIComponent(entry.entry_id)}`} size="sm" fw={600} truncate>
                        {entry.name} <Text component="span" size="xs" c="dimmed">{entry.accession}</Text>
                      </Anchor>
                      <Text size="sm" fw={700}>{count(entry.accepted_genes)}</Text>
                    </Group>
                    <Progress value={(entry.accepted_genes / topMax) * 100} color="cyan" size="sm" mt={4} />
                  </Box>
                ))}
              </Stack>
            </Paper>
            <Paper withBorder radius="lg" p="lg">
              <ThemeIcon size="xl" radius="md" variant="light"><IconDatabase size={24} /></ThemeIcon>
              <Title order={3} mt="md">Release & provenance</Title>
              <Text size="sm" c="dimmed" mt="xs">
                Download the immutable SQLite release, source inventory, mappings, conflicts and biological regression results.
              </Text>
              <Button component={Link} to="/gene-families/downloads" mt="lg" leftSection={<IconDownload size={16} />} fullWidth>
                Downloads & methods
              </Button>
            </Paper>
          </SimpleGrid>
        </>
      )}

      <Box id="catalog-directory" style={{ scrollMarginTop: 90 }}>
        <Group justify="space-between" align="flex-end" mb="md">
          <Box>
            <Title order={2}>Catalog entry directory</Title>
            <Text c="dimmed">Domain, TF family, cofactor class, kinase group and functional-role entries.</Text>
          </Box>
          <Badge variant="outline">{count(entryResult?.meta.total)} entries</Badge>
        </Group>
        <Paper withBorder radius="lg" p="md">
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
            <TextInput
              label="Entry search"
              placeholder="Name, accession or definition"
              leftSection={<IconSearch size={16} />}
              value={entryQuery}
              onChange={(event) => setEntryQuery(event.currentTarget.value)}
            />
            <Select
              label="Classification scheme"
              placeholder="All schemes"
              clearable
              searchable
              value={scheme}
              onChange={setScheme}
              data={schemeOptions}
            />
            <Select
              label="Sort"
              value={sort}
              onChange={(value) => setSort((value as typeof sort) ?? 'accepted_genes')}
              data={[
                { value: 'accepted_genes', label: 'Accepted genes' },
                { value: 'candidate_genes', label: 'Candidate genes' },
                { value: 'name', label: 'Entry name' },
              ]}
            />
            <Switch
              mt={28}
              label="Show candidate-only entries"
              description={includeCandidates ? 'Candidates included' : 'Candidates remain searchable but hidden'}
              checked={includeCandidates}
              onChange={(event) => setIncludeCandidates(event.currentTarget.checked)}
            />
          </SimpleGrid>
          {entryError && <Alert color="red" mt="md">{entryError}</Alert>}
          <Table.ScrollContainer minWidth={980} mt="md">
            <Table striped highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Entry</Table.Th>
                  <Table.Th>Scheme / type</Table.Th>
                  <Table.Th ta="right">Accepted genes</Table.Th>
                  <Table.Th ta="right">Candidates</Table.Th>
                  <Table.Th ta="right">Proteins</Table.Th>
                  <Table.Th>Evidence</Table.Th>
                  <Table.Th>Mapping</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {entryResult?.data.map((entry: CatalogEntrySummary) => (
                  <Table.Tr key={entry.entry_id}>
                    <Table.Td>
                      <Anchor component={Link} to={`/gene-families/entry/${encodeURIComponent(entry.entry_id)}`} fw={650}>
                        {entry.name}
                      </Anchor>
                      <Text size="xs" c="dimmed" ff="monospace">{entry.accession}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{entry.scheme_name}</Text>
                      <Badge size="xs" variant="light">{entry.entry_type.replaceAll('_', ' ')}</Badge>
                    </Table.Td>
                    <Table.Td ta="right">{count(entry.accepted_genes)}</Table.Td>
                    <Table.Td ta="right">
                      <Text c={(entry.candidate_genes ?? 0) > 0 ? 'orange.8' : 'dimmed'}>{count(entry.candidate_genes)}</Text>
                    </Table.Td>
                    <Table.Td ta="right">{count(entry.accepted_proteins)}</Table.Td>
                    <Table.Td>{pct(entry.evidence_coverage)}</Table.Td>
                    <Table.Td>{pct(entry.mapping_coverage)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {entryLoading && <Group justify="center" py="md"><Loader size="sm" /></Group>}
          {!entryLoading && entryResult?.data.length === 0 && <Text ta="center" c="dimmed" py="xl">No entries match these filters.</Text>}
          {entryResult?.meta.next_cursor && (
            <Group justify="center" mt="md">
              <Button variant="light" onClick={loadMore} loading={entryLoading}>Load more entries</Button>
            </Group>
          )}
        </Paper>
      </Box>
    </Stack>
  );
}
