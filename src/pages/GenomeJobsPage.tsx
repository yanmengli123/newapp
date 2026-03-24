import { useState, useEffect } from 'react';
import {
  Title,
  Text,
  Card,
  Group,
  Stack,
  Badge,
  Table,
  ScrollArea,
  Alert,
  Loader,
  Center,
  ActionIcon,
  Tooltip,
  Button,
} from '@mantine/core';
import { IconRefresh, IconEye } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { getGenomeJobs, type GenomeJobsResponse } from '../lib/genomeApi';

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    pending: 'yellow',
    running: 'blue',
    success: 'green',
    failed: 'red',
  };

  return (
    <Badge color={colorMap[status] || 'gray'} size="lg">
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

export default function GenomeJobsPage() {
  const [data, setData] = useState<GenomeJobsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getGenomeJobs();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  if (loading) {
    return (
      <Center py="xl">
        <Loader size="lg" />
      </Center>
    );
  }

  const jobs = data?.jobs || [];

  return (
    <Stack gap="xl">
      <Group justify="space-between">
        <div>
          <Title order={2} mb="xs">
            Analysis Jobs
          </Title>
          <Text c="dimmed">
            View all genome analysis jobs
          </Text>
        </div>
        <Tooltip label="Refresh">
          <ActionIcon variant="light" size="lg" onClick={fetchJobs}>
            <IconRefresh size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {error && (
        <Alert color="red" title="Error">
          {error}
        </Alert>
      )}

      <Card withBorder shadow="sm" padding="md">
        <ScrollArea>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Job ID</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th>Started</Table.Th>
                <Table.Th>Finished</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {jobs.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed" ta="center" py="xl">
                      No jobs found. Start a new analysis from the{' '}
                      <Text component={Link} to="/genome/run" c="blue" td="underline">
                        Run Analysis
                      </Text>{' '}
                      page.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                jobs.map((job) => (
                  <Table.Tr key={job.job_id}>
                    <Table.Td>
                      <Text size="sm" ff="monospace">{job.job_id.slice(0, 12)}...</Text>
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge status={job.status} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatDate(job.created_at)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatDate(job.started_at)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatDate(job.finished_at)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        <Tooltip label="View Details">
                          <ActionIcon
                            variant="light"
                            component={Link}
                            to={`/genome/jobs/${job.job_id}`}
                          >
                            <IconEye size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Card>

      <Group justify="center">
        <Button
          component={Link}
          to="/genome/run"
          leftSection={<IconRefresh size={16} />}
        >
          Run New Analysis
        </Button>
      </Group>
    </Stack>
  );
}
