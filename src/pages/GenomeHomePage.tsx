import { useState, useEffect } from 'react';
import {
  Title,
  Text,
  Card,
  Group,
  Stack,
  Button,
  Badge,
  SimpleGrid,
  Box,
  Alert,
  Loader,
  Center,
} from '@mantine/core';
import {
  IconChartBar,
  IconFolder,
  IconPlayerPlay,
  IconList,
  IconCheck,
  IconAlertCircle,
  IconDownload,
  IconEye,
} from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import {
  getGenomeHealth,
  getSampleStatus,
  type GenomeHealthResponse,
  type SampleStatusResponse,
} from '../lib/genomeApi';

export default function GenomeHomePage() {
  const [health, setHealth] = useState<GenomeHealthResponse | null>(null);
  const [sampleStatus, setSampleStatus] = useState<SampleStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [healthData, statusData] = await Promise.all([
          getGenomeHealth(),
          getSampleStatus().catch(() => ({ available: false, has_charts: false, chart_count: 0, results_dir: '' })),
        ]);

        setHealth(healthData);
        setSampleStatus(statusData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <Center py="xl">
        <Loader size="lg" />
      </Center>
    );
  }

  const hasSampleResults = sampleStatus?.available ?? false;

  return (
    <Stack gap="xl">
      <Box>
        <Title order={2} mb="xs">
          Genome Analysis
        </Title>
        <Text c="dimmed">
          GRCg6a chicken genome analysis, result viewing, and download module.
        </Text>
      </Box>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
          {error}
        </Alert>
      )}

      {/* Service Status */}
      <Card withBorder shadow="sm" padding="lg">
        <Group justify="space-between">
          <div>
            <Text fw={600} size="lg">
              Service Status
            </Text>
            <Group gap="xs" mt="xs">
              <Badge
                color={health?.status === 'healthy' ? 'green' : 'red'}
                leftSection={health?.status === 'healthy' ? <IconCheck size={12} /> : <IconAlertCircle size={12} />}
              >
                {health?.status || 'Unknown'}
              </Badge>
              <Text size="sm" c="dimmed">
                Version: {health?.version || 'N/A'}
              </Text>
            </Group>
          </div>
        </Group>
      </Card>

      {/* Results Available — Show direct access */}
      {hasSampleResults && (
        <Alert icon={<IconCheck size={20} />} color="green" title="Analysis Results Ready">
          <Group justify="space-between" mt="xs">
            <div>
              <Text size="sm">
                Sample analysis results are available with {sampleStatus?.chart_count ?? 11} interactive charts.
              </Text>
            </div>
            <Group gap="xs">
              <Button
                size="md"
                leftSection={<IconEye size={16} />}
                component={Link}
                to="/genome/jobs/sample/result"
              >
                View Results
              </Button>
              <Button
                size="md"
                variant="light"
                leftSection={<IconDownload size={16} />}
                component={Link}
                to="/genome/jobs/sample/downloads"
              >
                Downloads
              </Button>
            </Group>
          </Group>
        </Alert>
      )}

      {/* Quick Actions */}
      <SimpleGrid cols={{ base: 1, sm: 2, md: hasSampleResults ? 3 : 4 }} spacing="md">
        {/* Results — Always visible, prominent */}
        <Card withBorder shadow="sm" padding="lg" component={Link} to="/genome/jobs/sample/result">
          <Group>
            <IconChartBar size={32} color="var(--mantine-color-blue-6)" />
            <div>
              <Text fw={600}>Results</Text>
              <Text size="sm" c="dimmed">
                View analysis results
              </Text>
            </div>
          </Group>
        </Card>

        {/* Downloads — Always visible */}
        <Card withBorder shadow="sm" padding="lg" component={Link} to="/genome/jobs/sample/downloads">
          <Group>
            <IconDownload size={32} color="var(--mantine-color-green-6)" />
            <div>
              <Text fw={600}>Downloads</Text>
              <Text size="sm" c="dimmed">
                Charts & tables
              </Text>
            </div>
          </Group>
        </Card>

        {/* Scan Files */}
        <Card withBorder shadow="sm" padding="lg" component={Link} to="/genome/files">
          <Group>
            <IconFolder size={32} color="var(--mantine-color-orange-6)" />
            <div>
              <Text fw={600}>Scan Files</Text>
              <Text size="sm" c="dimmed">
                View genome files
              </Text>
            </div>
          </Group>
        </Card>

        {/* Run Analysis — Only shown when no sample results */}
        {!hasSampleResults && (
          <Card withBorder shadow="sm" padding="lg" component={Link} to="/genome/run">
            <Group>
              <IconPlayerPlay size={32} color="var(--mantine-color-red-6)" />
              <div>
                <Text fw={600}>Run Analysis</Text>
                <Text size="sm" c="dimmed">
                  Start new analysis
                </Text>
              </div>
            </Group>
          </Card>
        )}

        {/* Job History — Only shown when no sample results */}
        {!hasSampleResults && (
          <Card withBorder shadow="sm" padding="lg" component={Link} to="/genome/jobs">
            <Group>
              <IconList size={32} color="var(--mantine-color-violet-6)" />
              <div>
                <Text fw={600}>View Jobs</Text>
                <Text size="sm" c="dimmed">
                  Check job status
                </Text>
              </div>
            </Group>
          </Card>
        )}
      </SimpleGrid>
    </Stack>
  );
}
