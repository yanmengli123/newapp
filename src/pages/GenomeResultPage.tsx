import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Title,
  Text,
  Card,
  Group,
  Stack,
  Badge,
  Alert,
  Loader,
  Center,
  Accordion,
  Code,
  Table,
  ScrollArea,
  Button,
} from '@mantine/core';
import { IconDownload, IconEye } from '@tabler/icons-react';
import {
  getGenomeResult,
  getSampleResult,
  type GenomeResultResponse,
} from '../lib/genomeApi';

function ModuleCard({
  moduleName,
  data,
}: {
  moduleName: string;
  data: Record<string, unknown>;
}) {
  const moduleLabels: Record<string, string> = {
    genome: 'Genome Overview',
    gff: 'GFF Annotation',
    cds: 'CDS Analysis',
    protein: 'Protein Analysis',
    rna: 'RNA Analysis',
    consistency: 'Consistency Check',
  };

  return (
    <Accordion.Item value={moduleName}>
      <Accordion.Control>
        <Group justify="space-between" pr="md">
          <Text fw={600}>{moduleLabels[moduleName] || moduleName}</Text>
          <Badge color="blue" variant="light">
            {Object.keys(data).length} fields
          </Badge>
        </Group>
      </Accordion.Control>
      <Accordion.Panel>
        <ScrollArea>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Key</Table.Th>
                <Table.Th>Value</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {Object.entries(data).map(([key, value]) => (
                <Table.Tr key={key}>
                  <Table.Td>
                    <Text size="xs" fw={500} ff="monospace">
                      {key}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {typeof value === 'number'
                        ? value.toLocaleString()
                        : typeof value === 'object'
                          ? JSON.stringify(value)
                          : String(value)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

export default function GenomeResultPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [data, setData] = useState<GenomeResultResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSample, setIsSample] = useState(false);

  useEffect(() => {
    const fetchResult = async () => {
      try {
        setLoading(true);
        setError(null);

        // Try to fetch job result first
        if (jobId && jobId !== 'sample') {
          try {
            const result = await getGenomeResult(jobId);
            setData(result);
            setIsSample(false);
          } catch {
            // If job result not available, try sample
            const sampleResult = await getSampleResult();
            setData(sampleResult);
            setIsSample(true);
          }
        } else {
          // If no jobId or it's 'sample', show sample results
          const sampleResult = await getSampleResult();
          setData(sampleResult);
          setIsSample(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load results');
      } finally {
        setLoading(false);
      }
    };

    fetchResult();
  }, [jobId]);

  if (loading) {
    return (
      <Center py="xl">
        <Loader size="lg" />
      </Center>
    );
  }

  if (error) {
    return (
      <Alert color="red" title="Error">
        {error}
      </Alert>
    );
  }

  if (!data?.results) {
    return (
      <Alert color="yellow" title="No Results">
        No results available.
      </Alert>
    );
  }

  const moduleNames = Object.keys(data.results);
  const displayJobId = isSample ? 'sample' : (jobId || 'sample');

  return (
    <Stack gap="xl">
      <Group justify="space-between">
        <div>
          <Title order={2} mb="xs">
            Analysis Results
          </Title>
          <Group gap="xs">
            <Text c="dimmed">Job ID: </Text>
            <Code>{displayJobId}</Code>
            {isSample && (
              <Badge color="orange" variant="light">
                Sample Data
              </Badge>
            )}
          </Group>
        </div>
        <Group gap="xs">
          <Button
            variant="light"
            component={Link}
            to={`/genome/jobs/${displayJobId}/downloads`}
            leftSection={<IconDownload size={16} />}
          >
            Downloads
          </Button>
          {!isSample && (
            <Button
              variant="light"
              component={Link}
              to={`/genome/jobs/${jobId}`}
              leftSection={<IconEye size={16} />}
            >
              Job Details
            </Button>
          )}
        </Group>
      </Group>

      <Card withBorder shadow="sm" padding="md">
        <Group justify="space-between">
          <Text size="sm" fw={500}>
            Total Modules
          </Text>
          <Badge color="blue" size="lg">
            {moduleNames.length}
          </Badge>
        </Group>
      </Card>

      <Accordion variant="separated">
        {moduleNames.map((moduleName) => (
          <ModuleCard
            key={moduleName}
            moduleName={moduleName}
            data={data.results[moduleName] as Record<string, unknown>}
          />
        ))}
      </Accordion>
    </Stack>
  );
}
