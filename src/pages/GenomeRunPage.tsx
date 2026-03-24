import { useState, useEffect } from 'react';
import {
  Title,
  Text,
  Card,
  Group,
  Stack,
  Button,
  Alert,
  Loader,
  Center,
  List,
  ThemeIcon,
} from '@mantine/core';
import {
  IconPlayerPlay,
  IconCheck,
  IconAlertCircle,
  IconArrowRight,
  IconEye,
  IconDownload,
} from '@tabler/icons-react';
import { Link, useNavigate } from 'react-router-dom';
import { runGenomeAnalysis, getSampleStatus, type GenomeRunResponse } from '../lib/genomeApi';

export default function GenomeRunPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenomeRunResponse | null>(null);
  const [hasSample, setHasSample] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const checkSample = async () => {
      try {
        const status = await getSampleStatus();
        setHasSample(status.available);
      } catch {
        setHasSample(false);
      } finally {
        setLoading(false);
      }
    };
    checkSample();
  }, []);

  const handleRunAnalysis = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await runGenomeAnalysis();
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run analysis');
    } finally {
      setLoading(false);
    }
  };

  const handleGoToJob = () => {
    if (result?.job_id) {
      navigate(`/genome/jobs/${result.job_id}`);
    }
  };

  if (loading) {
    return (
      <Center py="xl">
        <Loader size="lg" />
      </Center>
    );
  }

  // Sample results already exist — show direct access instead of running
  if (hasSample && !result) {
    return (
      <Stack gap="xl">
        <div>
          <Title order={2} mb="xs">
            Run Genome Analysis
          </Title>
          <Text c="dimmed">
            Start a new genome analysis job for GRCg6a
          </Text>
        </div>

        <Alert icon={<IconCheck size={20} />} color="green" title="Results Already Available">
          <Text size="sm" mb="md">
            Analysis results have already been generated and saved locally.
            No need to run again — just view or download the results.
          </Text>
          <Group>
            <Button
              size="lg"
              leftSection={<IconEye size={20} />}
              component={Link}
              to="/genome/jobs/sample/result"
            >
              View Results
            </Button>
            <Button
              size="lg"
              variant="light"
              leftSection={<IconDownload size={20} />}
              component={Link}
              to="/genome/jobs/sample/downloads"
            >
              Downloads
            </Button>
          </Group>
        </Alert>

        <Card withBorder shadow="sm" padding="xl">
          <Stack gap="lg">
            <div>
              <Title order={4}>About Pre-generated Results</Title>
              <Text size="sm" c="dimmed" mt="xs">
                These results were generated from the GRCg6a chicken genome assembly
                and include comprehensive analysis of all genomic features.
              </Text>
            </div>

            <div>
              <Title order={4}>Analysis Modules</Title>
              <List
                spacing="xs"
                size="sm"
                mt="xs"
                icon={
                  <ThemeIcon color="blue" size={20} radius="xl">
                    <IconCheck size={12} />
                  </ThemeIcon>
                }
              >
                <List.Item>Genome file scanning and validation</List.Item>
                <List.Item>GFF annotation analysis</List.Item>
                <List.Item>CDS sequence analysis</List.Item>
                <List.Item>Protein sequence analysis</List.Item>
                <List.Item>RNA sequence analysis</List.Item>
                <List.Item>Cross-file consistency checks</List.Item>
                <List.Item>Chart generation (PNG, SVG, HTML, JSON)</List.Item>
                <List.Item>Table export (CSV, XLSX)</List.Item>
              </List>
            </div>

            <div>
              <Title order={4}>Want to Re-run Analysis?</Title>
              <Text size="sm" c="dimmed" mt="xs">
                If you have updated genome files, you can run a fresh analysis.
                Results will be saved as a new job alongside the existing sample.
              </Text>
            </div>

            <Group>
              <Button
                size="lg"
                leftSection={<IconPlayerPlay size={20} />}
                onClick={handleRunAnalysis}
                variant="outline"
                color="red"
              >
                Start New Analysis
              </Button>
            </Group>
          </Stack>
        </Card>
      </Stack>
    );
  }

  return (
    <Stack gap="xl">
      <div>
        <Title order={2} mb="xs">
          Run Genome Analysis
        </Title>
        <Text c="dimmed">
          Start a new genome analysis job for GRCg6a
        </Text>
      </div>

      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          title="Error"
        >
          {error}
        </Alert>
      )}

      {result && (
        <Alert
          icon={<IconCheck size={16} />}
          color="green"
          title="Analysis Started"
        >
          <Text>Job ID: {result.job_id}</Text>
          <Text size="sm" c="dimmed">{result.message}</Text>
          <Button
            mt="md"
            rightSection={<IconArrowRight size={16} />}
            onClick={handleGoToJob}
          >
            View Job Status
          </Button>
        </Alert>
      )}

      <Card withBorder shadow="sm" padding="xl">
        <Stack gap="lg">
          <div>
            <Title order={4}>Analysis Description</Title>
            <Text size="sm" c="dimmed" mt="xs">
              This analysis will perform a comprehensive examination of the GRCg6a
              chicken genome files and generate detailed reports.
            </Text>
          </div>

          <div>
            <Title order={4}>Analysis Modules</Title>
            <List
              spacing="xs"
              size="sm"
              mt="xs"
              icon={
                <ThemeIcon color="blue" size={20} radius="xl">
                  <IconCheck size={12} />
                </ThemeIcon>
              }
            >
              <List.Item>Genome file scanning and validation</List.Item>
              <List.Item>GFF annotation analysis</List.Item>
              <List.Item>CDS sequence analysis</List.Item>
              <List.Item>Protein sequence analysis</List.Item>
              <List.Item>RNA sequence analysis</List.Item>
              <List.Item>Cross-file consistency checks</List.Item>
              <List.Item>Chart generation (PNG, SVG, HTML, JSON)</List.Item>
              <List.Item>Table export (CSV, XLSX)</List.Item>
            </List>
          </div>

          <div>
            <Title order={4}>Estimated Time</Title>
            <Text size="sm" c="dimmed" mt="xs">
              Analysis typically takes 1-5 minutes depending on the genome size
              and system performance.
            </Text>
          </div>

          <Group>
            <Button
              size="lg"
              leftSection={<IconPlayerPlay size={20} />}
              loading={loading}
              onClick={handleRunAnalysis}
              disabled={!!result}
            >
              Start Analysis
            </Button>
          </Group>
        </Stack>
      </Card>

      {loading && (
        <Center>
          <Loader size="sm" />
          <Text size="sm" c="dimmed" ml="sm">
            Analysis is running in the background...
          </Text>
        </Center>
      )}
    </Stack>
  );
}
