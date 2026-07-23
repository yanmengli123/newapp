import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconBinaryTree,
  IconDatabase,
  IconDna,
  IconDownload,
  IconExternalLink,
  IconFlask,
  IconSearch,
} from '@tabler/icons-react';
import { Link, useParams } from 'react-router-dom';
import CatalogStatusBadge from '../components/gene_family/CatalogStatusBadge';
import DomainArchitecture from '../components/gene_family/DomainArchitecture';
import {
  getEntry,
  getEntryEvidence,
  getEntryMembers,
  type CatalogEntry,
  type CatalogMember,
  type DomainHit,
  type EvidenceListResponse,
  type MemberListResponse,
} from '../lib/geneFamilyApi';

function count(value: number | undefined): string {
  return (value ?? 0).toLocaleString();
}

function scientific(value: number | null): string {
  if (value == null) return '—';
  return value === 0 ? '0' : value.toExponential(2);
}

export default function GeneFamilyEntryPage() {
  const { entryId = '' } = useParams<{ entryId: string }>();
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [members, setMembers] = useState<MemberListResponse | null>(null);
  const [evidence, setEvidence] = useState<EvidenceListResponse | null>(null);
  const [includeCandidates, setIncludeCandidates] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([getEntry(entryId), getEntryEvidence(entryId, null, 50)])
      .then(([entryResult, evidenceResult]) => {
        if (!active) return;
        setEntry(entryResult);
        setEvidence(evidenceResult);
        if ((entryResult.assertion_states.accepted ?? 0) === 0 && (entryResult.assertion_states.candidate ?? 0) > 0) {
          setIncludeCandidates(true);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Catalog entry is unavailable');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [entryId]);

  useEffect(() => {
    let active = true;
    setMembersLoading(true);
    const timer = window.setTimeout(() => {
      getEntryMembers(entryId, { includeCandidates, query: memberQuery || undefined, limit: 50 })
        .then((result) => { if (active) setMembers(result); })
        .catch((reason: unknown) => {
          if (active) setError(reason instanceof Error ? reason.message : 'Members are unavailable');
        })
        .finally(() => { if (active) setMembersLoading(false); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [entryId, includeCandidates, memberQuery]);

  async function loadMoreMembers() {
    const cursor = members?.meta.next_cursor;
    if (!cursor) return;
    setMembersLoading(true);
    try {
      const next = await getEntryMembers(entryId, {
        includeCandidates,
        query: memberQuery || undefined,
        cursor,
        limit: 50,
      });
      setMembers((current) => current ? { ...next, data: [...current.data, ...next.data] } : next);
    } finally {
      setMembersLoading(false);
    }
  }

  async function loadMoreEvidence() {
    const cursor = evidence?.meta.next_cursor;
    if (!cursor) return;
    const next = await getEntryEvidence(entryId, cursor, 50);
    setEvidence((current) => current ? { ...next, data: [...current.data, ...next.data] } : next);
  }

  const proteinTracks = useMemo(() => {
    if (!entry || entry.scheme_id !== 'pfam' || !evidence) return [];
    const grouped = new Map<string, {
      proteinLength: number | null;
      proteinLengthStatus: 'observed' | 'not_reported';
      hits: DomainHit[];
    }>();
    for (const record of evidence.data) {
      if (!record.protein_accession || record.ali_from == null || record.ali_to == null) continue;
      const track = grouped.get(record.protein_accession) ?? {
        proteinLength: record.protein_length,
        proteinLengthStatus: record.protein_length_status,
        hits: [],
      };
      track.hits.push({
        entry_id: entry.entry_id,
        pfam_accession: entry.accession,
        pfam_name: entry.name,
        definition: entry.definition ?? null,
        assertion_id: record.assertion_id,
        domain_index: record.domain_index ?? null,
        domain_total: record.domain_total ?? null,
        ali_from: record.ali_from,
        ali_to: record.ali_to,
        env_from: record.env_from ?? null,
        env_to: record.env_to ?? null,
        independent_evalue: record.domain_ievalue,
        domain_score: record.score,
        accuracy: null,
        threshold_pass: record.threshold_pass,
      });
      grouped.set(record.protein_accession, track);
    }
    return Array.from(grouped, ([proteinId, track]) => ({ proteinId, ...track }));
  }, [entry, evidence]);

  if (loading) return <Group justify="center" py="xl"><Loader /></Group>;
  if (error && !entry) return <Alert color="red" title="Entry unavailable">{error}</Alert>;
  if (!entry) return null;

  return (
    <Stack gap="xl">
      <Anchor component={Link} to="/gene-families" size="sm">
        <Group gap={6}><IconArrowLeft size={15} /> Back to catalog</Group>
      </Anchor>

      <Paper withBorder radius="xl" p="xl">
        <Group justify="space-between" align="flex-start">
          <Box>
            <Group gap="sm">
              <IconBinaryTree size={28} color="var(--mantine-color-cyan-7)" />
              <Title order={1}>{entry.name}</Title>
              <Badge variant="light">{entry.entry_type.replaceAll('_', ' ')}</Badge>
            </Group>
            <Text ff="monospace" c="cyan.8" mt={6}>{entry.accession}</Text>
            <Text c="dimmed" mt="sm" maw={900}>{entry.definition || 'No definition is available for this entry.'}</Text>
          </Box>
          {entry.external_url && (
            <Button component="a" href={entry.external_url} target="_blank" rel="noreferrer" variant="light" rightSection={<IconExternalLink size={15} />}>
              Source entry
            </Button>
          )}
        </Group>
        <Divider my="lg" />
        <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="md">
          <Box><Text size="xs" c="dimmed">Scheme</Text><Text fw={650}>{entry.scheme_name}</Text></Box>
          <Box><Text size="xs" c="dimmed">Accepted genes</Text><Text fw={800} size="xl">{count(entry.accepted_genes)}</Text></Box>
          <Box><Text size="xs" c="dimmed">Candidate genes</Text><Text fw={800} size="xl" c="orange.8">{count(entry.candidate_genes)}</Text></Box>
          <Box><Text size="xs" c="dimmed">Proteins</Text><Text fw={800} size="xl">{count(entry.accepted_proteins)}</Text></Box>
          <Box><Text size="xs" c="dimmed">Evidence coverage</Text><Text fw={800} size="xl">{Math.round((entry.evidence_coverage ?? 0) * 100)}%</Text></Box>
          <Box><Text size="xs" c="dimmed">Mapping coverage</Text><Text fw={800} size="xl">{Math.round((entry.mapping_coverage ?? 0) * 100)}%</Text></Box>
        </SimpleGrid>
      </Paper>

      {error && <Alert color="orange">{error}</Alert>}

      <Tabs defaultValue="overview" variant="outline" radius="md">
        <Tabs.List>
          <Tabs.Tab value="overview" leftSection={<IconDatabase size={15} />}>Overview</Tabs.Tab>
          <Tabs.Tab value="members" leftSection={<IconBinaryTree size={15} />}>Members</Tabs.Tab>
          <Tabs.Tab value="evidence" leftSection={<IconFlask size={15} />}>Evidence & curation</Tabs.Tab>
          {entry.available_sections.domain_architecture && <Tabs.Tab value="domains" leftSection={<IconDna size={15} />}>Domain positions</Tabs.Tab>}
          <Tabs.Tab value="downloads" leftSection={<IconDownload size={15} />}>Downloads & provenance</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="lg">
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
            <Paper withBorder radius="lg" p="lg">
              <Title order={3}>Classification context</Title>
              <Stack gap="sm" mt="md">
                <Group justify="space-between"><Text c="dimmed">Source</Text><Text fw={600}>{entry.source_name} {entry.source_version}</Text></Group>
                <Group justify="space-between"><Text c="dimmed">Subject level</Text><Badge variant="light">{entry.subject_level}</Badge></Group>
                <Group justify="space-between"><Text c="dimmed">Parent</Text><Text>{entry.parent_name || 'Root entry'}</Text></Group>
                <Group justify="space-between"><Text c="dimmed">Entry ID</Text><Text ff="monospace" size="sm">{entry.entry_id}</Text></Group>
              </Stack>
              {entry.children.length > 0 && (
                <>
                  <Divider my="md" />
                  <Text fw={650} mb="xs">Child entries</Text>
                  <Group gap="xs">
                    {entry.children.map((child) => (
                      <Badge
                        key={child.entry_id}
                        component={Link}
                        to={`/gene-families/entry/${encodeURIComponent(child.entry_id)}`}
                        variant="light"
                        style={{ cursor: 'pointer' }}
                      >
                        {child.name}
                      </Badge>
                    ))}
                  </Group>
                </>
              )}
            </Paper>
            <Paper withBorder radius="lg" p="lg">
              <Title order={3}>Assertion profile</Title>
              <Stack gap="sm" mt="md">
                {Object.entries(entry.assertion_states).map(([state, total]) => (
                  <Group key={state} justify="space-between">
                    <CatalogStatusBadge value={state} />
                    <Text fw={700}>{count(total)}</Text>
                  </Group>
                ))}
                <Divider />
                {entry.support_tiers.map((tier) => (
                  <Group key={tier.support_tier} justify="space-between">
                    <CatalogStatusBadge value={tier.support_tier} size="xs" />
                    <Text size="sm">{count(tier.count)}</Text>
                  </Group>
                ))}
              </Stack>
            </Paper>
          </SimpleGrid>
        </Tabs.Panel>

        <Tabs.Panel value="members" pt="lg">
          <Paper withBorder radius="lg" p="lg">
            <Group justify="space-between" align="flex-end" mb="md">
              <TextInput
                label="Search members"
                placeholder="Symbol, gene ID, Ensembl or protein"
                leftSection={<IconSearch size={16} />}
                value={memberQuery}
                onChange={(event) => setMemberQuery(event.currentTarget.value)}
                w={{ base: '100%', sm: 360 }}
              />
              <Switch
                label="Include candidates"
                description={includeCandidates ? 'Candidate assertions visible' : 'Accepted assertions only'}
                checked={includeCandidates}
                onChange={(event) => setIncludeCandidates(event.currentTarget.checked)}
              />
            </Group>
            <Table.ScrollContainer minWidth={1000}>
              <Table striped highlightOnHover verticalSpacing="sm">
                <Table.Thead><Table.Tr>
                  <Table.Th>Gene / protein</Table.Th><Table.Th>Identifiers</Table.Th><Table.Th>State</Table.Th>
                  <Table.Th>Evidence tier</Table.Th><Table.Th>Review</Table.Th><Table.Th>Role</Table.Th><Table.Th ta="right">Evidence</Table.Th>
                </Table.Tr></Table.Thead>
                <Table.Tbody>
                  {members?.data.map((member: CatalogMember) => (
                    <Table.Tr key={member.assertion_id}>
                      <Table.Td>
                        {member.internal_url ? (
                          <Anchor component={Link} to={member.internal_url} fw={650}>{member.gene_symbol || member.internal_gene_id}</Anchor>
                        ) : <Text fw={650}>{member.gene_symbol || member.protein_accession || 'Unmapped subject'}</Text>}
                        {member.protein_accession && <Text size="xs" ff="monospace" c="dimmed">{member.protein_accession}</Text>}
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">ChickenData: {member.internal_gene_id || 'unmapped'}</Text>
                        <Text size="xs" c="dimmed">NCBI: {member.ncbi_gene_id || '—'} · Ensembl: {member.ensembl_gene_id || '—'}</Text>
                      </Table.Td>
                      <Table.Td><CatalogStatusBadge value={member.assertion_state} size="xs" /></Table.Td>
                      <Table.Td><CatalogStatusBadge value={member.support_tier} size="xs" /></Table.Td>
                      <Table.Td><CatalogStatusBadge value={member.review_state} size="xs" /></Table.Td>
                      <Table.Td><CatalogStatusBadge value={member.assignment_role} size="xs" /></Table.Td>
                      <Table.Td ta="right">{member.evidence_count}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {membersLoading && <Group justify="center" py="md"><Loader size="sm" /></Group>}
            {!membersLoading && members?.data.length === 0 && (
              <Alert color="orange" mt="md">No members match the current publication-state filters.</Alert>
            )}
            {members?.meta.next_cursor && <Group justify="center" mt="md"><Button variant="light" onClick={loadMoreMembers}>Load more members</Button></Group>}
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="evidence" pt="lg">
          <Paper withBorder radius="lg" p="lg">
            <Text c="dimmed" size="sm" mb="md">
              Every row links a classification assertion to its source file and immutable source-record identifier.
            </Text>
            <Table.ScrollContainer minWidth={1100}>
              <Table striped verticalSpacing="sm">
                <Table.Thead><Table.Tr>
                  <Table.Th>Subject</Table.Th><Table.Th>Evidence</Table.Th><Table.Th>Source</Table.Th>
                  <Table.Th>Model</Table.Th><Table.Th ta="right">Score</Table.Th><Table.Th ta="right">i-Evalue</Table.Th><Table.Th>Threshold</Table.Th>
                </Table.Tr></Table.Thead>
                <Table.Tbody>
                  {evidence?.data.map((record) => (
                    <Table.Tr key={`${record.evidence_id}-${record.assertion_id}`}>
                      <Table.Td><Text size="sm" fw={600}>{record.gene_symbol || record.protein_accession || record.internal_gene_id}</Text></Table.Td>
                      <Table.Td><Text size="sm">{record.evidence_type.replaceAll('_', ' ')}</Text><CatalogStatusBadge value={record.assertion_state} size="xs" /></Table.Td>
                      <Table.Td><Text size="xs">{record.source_file}</Text><Text size="xs" c="dimmed" ff="monospace">{record.source_record_id}</Text></Table.Td>
                      <Table.Td><Text size="xs" ff="monospace">{record.model_accession || '—'}</Text></Table.Td>
                      <Table.Td ta="right">{record.score?.toFixed(1) ?? '—'}</Table.Td>
                      <Table.Td ta="right">{scientific(record.domain_ievalue)}</Table.Td>
                      <Table.Td>
                        {record.threshold_pass == null ? <Badge color="gray" variant="light" size="xs">Not recorded</Badge> : (
                          <Badge color={record.threshold_pass ? 'teal' : 'orange'} variant="light" size="xs">{record.threshold_pass ? 'Passed' : 'Below policy'}</Badge>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {evidence?.meta.next_cursor && <Group justify="center" mt="md"><Button variant="light" onClick={loadMoreEvidence}>Load more evidence</Button></Group>}
          </Paper>
        </Tabs.Panel>

        {entry.available_sections.domain_architecture && (
          <Tabs.Panel value="domains" pt="lg">
            <Paper withBorder radius="lg" p="lg">
              <Alert color="blue" mb="lg">
                These tracks show positional evidence for this Pfam entry. Open a gene page to view the complete multi-domain architecture for each isoform.
              </Alert>
              <Stack gap="xl">
                {proteinTracks.map((track) => (
                  <DomainArchitecture
                    key={track.proteinId}
                    proteinId={track.proteinId}
                    proteinLength={track.proteinLength}
                    proteinLengthStatus={track.proteinLengthStatus}
                    hits={track.hits}
                  />
                ))}
              </Stack>
            </Paper>
          </Tabs.Panel>
        )}

        <Tabs.Panel value="downloads" pt="lg">
          <Paper withBorder radius="lg" p="lg">
            <Title order={3}>Reproducible release package</Title>
            <Text c="dimmed" mt="xs" maw={800}>
              Entry summaries are recalculated from versioned assertions. Raw source rows, rules, evidence links, mapping outcomes and QC remain traceable in the release package.
            </Text>
            <Button component={Link} to="/gene-families/downloads" mt="lg" leftSection={<IconDownload size={16} />}>
              Open release downloads
            </Button>
          </Paper>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
