import { useState } from 'react';
import {
  Container,
  Title,
  Text,
  TextInput,
  Button,
  Group,
  Stack,
  Card,
  Badge,
  Table,
  Tabs,
  Alert,
  Box,
  Loader,
  CopyButton,
  ActionIcon,
  Tooltip,
} from '@mantine/core';
import { IconSearch, IconDna, IconBox, IconCopy, IconCheck, IconAlertCircle } from '@tabler/icons-react';
import { designPrimers, searchDomains } from '../lib/geneApi';
import type { Primer3Result, DomainSearchResult } from '../lib/geneApi';

export default function ToolsPage() {
  const [geneId, setGeneId] = useState('');
  const [activeTab, setActiveTab] = useState<string | null>('primer3');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Primer3 state
  const [primer3Result, setPrimer3Result] = useState<Primer3Result | null>(null);

  // Domain Search state
  const [domainResult, setDomainResult] = useState<DomainSearchResult | null>(null);

  const handleSearch = async () => {
    if (!geneId.trim()) return;

    setLoading(true);
    setError(null);
    setPrimer3Result(null);
    setDomainResult(null);

    try {
      if (activeTab === 'primer3') {
        const result = await designPrimers(geneId);
        setPrimer3Result(result);
        if (!result.success) {
          setError(result.error || 'Failed to design primers');
        }
      } else if (activeTab === 'domain') {
        const result = await searchDomains(geneId);
        setDomainResult(result);
        if (!result.success) {
          setError(result.error || 'No domains found');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <Container size="lg" py="xl">
      <Title order={2} mb="xs">Bioinformatics Tools</Title>
      <Text c="dimmed" mb="xl">
        Design PCR primers and search protein domains using local chicken genome data
      </Text>

      <Group mb="xl">
        <TextInput
          placeholder="Enter gene ID (e.g., gene-A4GALT)"
          value={geneId}
          onChange={(e) => setGeneId(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{ flex: 1 }}
          leftSection={<IconSearch size={16} />}
          size="md"
        />
        <Button
          onClick={handleSearch}
          loading={loading}
          size="md"
          leftSection={activeTab === 'primer3' ? <IconDna size={16} /> : <IconBox size={16} />}
        >
          Run
        </Button>
      </Group>

      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List>
          <Tabs.Tab value="primer3" leftSection={<IconDna size={16} />}>
            Primer3 Design
          </Tabs.Tab>
          <Tabs.Tab value="domain" leftSection={<IconBox size={16} />}>
            Domain Search
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="primer3" pt="md">
          {error && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" mb="md">
              {error}
            </Alert>
          )}

          {loading && (
            <Box ta="center" py="xl">
              <Loader size="lg" />
              <Text mt="md" c="dimmed">Designing primers...</Text>
            </Box>
          )}

          {primer3Result && primer3Result.success && (
            <Stack>
              <Card withBorder>
                <Group justify="space-between">
                  <div>
                    <Text fw={500}>Gene: {primer3Result.gene_id}</Text>
                    <Text size="sm" c="dimmed">
                      Region: {primer3Result.gene_info?.seqid} ({primer3Result.gene_info?.region_start} - {primer3Result.gene_info?.region_end})
                    </Text>
                  </div>
                  <Badge size="lg" color="cyan">
                    {primer3Result.num_primers_found} primers found
                  </Badge>
                </Group>
              </Card>

              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>#</Table.Th>
                    <Table.Th>Forward Primer (5'→3')</Table.Th>
                    <Table.Th>Reverse Primer (5'→3')</Table.Th>
                    <Table.Th>Forward TM</Table.Th>
                    <Table.Th>Reverse TM</Table.Th>
                    <Table.Th>Product Size</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {primer3Result.primers?.map((primer) => (
                    <Table.Tr key={primer.primer_num}>
                      <Table.Td>{primer.primer_num}</Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          <Text size="sm" ff="monospace">{primer.forward_seq}</Text>
                          <CopyButton value={primer.forward_seq}>
                            {({ copied, copy }) => (
                              <Tooltip label={copied ? 'Copied' : 'Copy'}>
                                <ActionIcon size="sm" variant="subtle" onClick={copy}>
                                  {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </CopyButton>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          <Text size="sm" ff="monospace">{primer.reverse_seq}</Text>
                          <CopyButton value={primer.reverse_seq}>
                            {({ copied, copy }) => (
                              <Tooltip label={copied ? 'Copied' : 'Copy'}>
                                <ActionIcon size="sm" variant="subtle" onClick={copy}>
                                  {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </CopyButton>
                        </Group>
                      </Table.Td>
                      <Table.Td>{primer.forward_tm.toFixed(2)}°C</Table.Td>
                      <Table.Td>{primer.reverse_tm.toFixed(2)}°C</Table.Td>
                      <Table.Td>{primer.product_size} bp</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="domain" pt="md">
          {error && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" mb="md">
              {error}
            </Alert>
          )}

          {loading && (
            <Box ta="center" py="xl">
              <Loader size="lg" />
              <Text mt="md" c="dimmed">Searching domains...</Text>
            </Box>
          )}

          {domainResult && (
            <Stack>
              <Card withBorder>
                <Group justify="space-between">
                  <div>
                    <Text fw={500}>Gene: {domainResult.gene_id}</Text>
                    <Text size="sm" c="dimmed">
                      Protein: {domainResult.protein_id} | Length: {domainResult.protein_length} aa
                    </Text>
                  </div>
                  <Badge size="lg" color="violet">
                    {domainResult.domains.length} domains found
                  </Badge>
                </Group>
              </Card>

              {domainResult.domains.length > 0 && (
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Accession</Table.Th>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Position</Table.Th>
                      <Table.Th>E-value</Table.Th>
                      <Table.Th>Score</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {domainResult.domains.map((domain, idx) => (
                      <Table.Tr key={idx}>
                        <Table.Td>
                          <Badge variant="light">{domain.accession}</Badge>
                        </Table.Td>
                        <Table.Td>{domain.name}</Table.Td>
                        <Table.Td>{domain.start} - {domain.end}</Table.Td>
                        <Table.Td>{domain.evalue ? domain.evalue.toExponential(2) : '-'}</Table.Td>
                        <Table.Td>{domain.score ? domain.score.toFixed(1) : '-'}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Stack>
          )}
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
}
