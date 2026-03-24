import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
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
  Button,
  Divider,
  Code,
  Paper,
} from '@mantine/core';
import { IconCheck, IconAlertCircle, IconArrowRight, IconRefresh } from '@tabler/icons-react';
import { getGenomeJob, type GenomeJobResponse } from '../lib/genomeApi';

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    pending: 'yellow',
    running: 'blue',
    success: 'green',
    failed: 'red',
  };

  return (
    <Badge color={colorMap[status] || 'gray'} size="xl">
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

export default function GenomeJobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [job, setJob] = useState<GenomeJobResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  const fetchJob = useCallback(async () => {
    if (!jobId) return;
    try {
      setError(null);
      const result = await getGenomeJob(jobId);
      setJob(result);

      // Stop polling if job is complete
      if (result.status === 'success' || result.status === 'failed') {
        setPolling(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load job');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  // Auto polling for pending/running jobs
  useEffect(() => {
    if (!job || polling) return;

    if (job.status === 'pending' || job.status === 'running') {
      setPolling(true);
    }
  }, [job, polling]);

  useEffect(() => {
    if (!polling) return;

    const interval = setInterval(() => {
      fetchJob();
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(interval);
  }, [polling, fetchJob]);

  if (loading) {
    return (
      <Center py="xl">
        <Loader size="lg" />
      </Center>
    );
  }

  if (error && !job) {
    return (
      <Alert color="red" title="Error">
        {error}
      </Alert>
    );
  }

  if (!job) {
    return (
      <Alert color="yellow" title="Job Not Found">
        Job not found or has been deleted.
      </Alert>
    );
  }

  return (
    <Stack gap="xl">
      <Group justify="space-between">
        <div>
          <Title order={2} mb="xs">
            Job Details
          </Title>
          <Text c="dimmed">
            Job ID: <Code>{job.job_id}</Code>
          </Text>
        </div>
        <Group gap="xs">
          <Badge size="xl" variant="outline">
            {job.status === 'running' && 'Auto-refresh active'}
          </Badge>
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            onClick={fetchJob}
          >
            Refresh
          </Button>
        </Group>
      </Group>

      <Card withBorder shadow="sm" padding="lg">
        <Stack gap="md">
          <Group justify="space-between">
            <Text fw={600}>Status</Text>
            <StatusBadge status={job.status} />
          </Group>

          <Divider />

          <Group justify="space-between">
            <Text fw={600}>Created At</Text>
            <Text>{formatDate(job.created_at)}</Text>
          </Group>

          <Group justify="space-between">
            <Text fw={600}>Started At</Text>
            <Text>{formatDate(job.started_at)}</Text>
          </Group>

          <Group justify="space-between">
            <Text fw={600}>Finished At</Text>
            <Text>{formatDate(job.finished_at)}</Text>
          </Group>

          {job.message && (
            <>
              <Divider />
              <div>
                <Text fw={600} mb="xs">Message</Text>
                <Paper p="md" withBorder>
                  <Text size="sm">{job.message}</Text>
                </Paper>
              </div>
            </>
          )}
        </Stack>
      </Card>

      {job.status === 'success' && (
        <Card withBorder shadow="sm" padding="lg">
          <Stack gap="md">
            <Group justify="space-between">
              <div>
                <Title order={4}>Analysis Complete</Title>
                <Text size="sm" c="dimmed">
                  Your genome analysis has finished successfully.
                </Text>
              </div>
              <Badge color="green" size="lg" leftSection={<IconCheck size={12} />}>
                Ready
              </Badge>
            </Group>

            <Divider />

            <Group>
              <Button
                size="lg"
                component="a"
                href={`/genome/jobs/${job.job_id}/result`}
                rightSection={<IconArrowRight size={18} />}
              >
                View Results
              </Button>
              <Button
                size="lg"
                variant="light"
                component="a"
                href={`/genome/jobs/${job.job_id}/downloads`}
                rightSection={<IconArrowRight size={18} />}
              >
                View Downloads
              </Button>
            </Group>
          </Stack>
        </Card>
      )}

      {job.status === 'failed' && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          title="Analysis Failed"
        >
          <Text>{job.message || 'An error occurred during analysis.'}</Text>
        </Alert>
      )}

      {(job.status === 'pending' || job.status === 'running') && (
        <Alert color="blue" title="Analysis In Progress">
          <Group justify="space-between">
            <Text>The analysis is currently running. This page will auto-refresh.</Text>
            <Loader size="sm" />
          </Group>
        </Alert>
      )}
    </Stack>
  );
}
