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
  Button,
  Accordion,
  Group as MGroup,
  ThemeIcon,
  SimpleGrid,
  Modal,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconChartBar,
  IconTable,
  IconFile,
  IconJson,
  IconPhoto,
  IconCode,
  IconPlayerPlay,
} from '@tabler/icons-react';
import {
  getGenomeDownloads,
  getSampleDownloads,
  buildGenomeDownloadUrl,
  buildChartUrl,
  buildSampleChartUrl,
  buildSampleFileUrl,
  buildSampleTableUrl,
  type GenomeDownloadsResponse,
} from '../lib/genomeApi';

function DownloadButton({
  label,
  url,
  color,
  icon,
}: {
  label: string;
  url: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <Button
      variant="light"
      size="xs"
      leftSection={icon}
      component="a"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      color={color}
    >
      {label}
    </Button>
  );
}

function InteractiveChartViewer({
  chartKey,
  jobId,
  isSample = false,
}: {
  chartKey: string;
  jobId: string;
  isSample?: boolean;
}) {
  const [opened, { open, close }] = useDisclosure(false);
  const [chartHtml, setChartHtml] = useState<string>('');
  const [iframeLoading, setIframeLoading] = useState(false);

  const htmlUrl = isSample
    ? buildSampleChartUrl(chartKey, 'html')
    : buildChartUrl(jobId, chartKey, 'html');

  const handleView = async () => {
    try {
      setIframeLoading(true);
      open();
      const response = await fetch(htmlUrl);
      const html = await response.text();
      setChartHtml(html);
    } catch (error) {
      console.error('Failed to load chart:', error);
    } finally {
      setIframeLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="filled"
        size="sm"
        color="blue"
        leftSection={<IconPlayerPlay size={16} />}
        onClick={handleView}
        loading={iframeLoading}
      >
        Interactive View
      </Button>

      <Modal
        opened={opened}
        onClose={close}
        title={
          <Text fw={600} size="lg">
            Interactive Chart: {chartKey.replace(/_/g, ' ').toUpperCase()}
          </Text>
        }
        size="xl"
        fullScreen
      >
        <Card withBorder padding={0} style={{ overflow: 'hidden', minHeight: 'calc(100vh - 140px)' }}>
          {iframeLoading ? (
            <Center style={{ height: 'calc(100vh - 140px)' }}>
              <Stack align="center" gap="md">
                <Loader size="lg" />
                <Text size="sm" c="dimmed">Loading chart...</Text>
              </Stack>
            </Center>
          ) : chartHtml ? (
            <iframe
              srcDoc={chartHtml}
              style={{
                width: '100%',
                height: 'calc(100vh - 140px)',
                border: 'none',
              }}
              title={chartKey}
            />
          ) : (
            <Center style={{ height: 'calc(100vh - 140px)' }}>
              <Text c="dimmed">Failed to load chart.</Text>
            </Center>
          )}
        </Card>
      </Modal>
    </>
  );
}

function ChartCard({
  chart,
  jobId,
  isSample = false,
}: {
  chart: GenomeDownloadsResponse['downloads']['charts'][0];
  jobId: string;
  isSample?: boolean;
}) {
  return (
    <Card withBorder shadow="sm" padding="md">
      <Stack gap="sm">
        <Text fw={600} size="sm" lineClamp={1}>
          {chart.title}
        </Text>

        {/* Interactive Chart Viewer */}
        <InteractiveChartViewer chartKey={chart.chart_key} jobId={jobId} isSample={isSample} />

        <Text size="xs" c="dimmed">
          Download formats:
        </Text>

        <MGroup gap="xs">
          {chart.files.png && (
            <DownloadButton
              label="PNG"
              url={
                isSample
                  ? buildSampleChartUrl(chart.chart_key, 'png')
                  : buildGenomeDownloadUrl(jobId, 'charts', `${chart.chart_key}.png`)
              }
              color="blue"
              icon={<IconPhoto size={14} />}
            />
          )}
          {chart.files.svg && (
            <DownloadButton
              label="SVG"
              url={
                isSample
                  ? buildSampleChartUrl(chart.chart_key, 'svg')
                  : buildGenomeDownloadUrl(jobId, 'charts', `${chart.chart_key}.svg`)
              }
              color="green"
              icon={<IconCode size={14} />}
            />
          )}
          {chart.files.html && (
            <DownloadButton
              label="HTML"
              url={
                isSample
                  ? buildSampleChartUrl(chart.chart_key, 'html')
                  : buildGenomeDownloadUrl(jobId, 'charts', `${chart.chart_key}.html`)
              }
              color="orange"
              icon={<IconCode size={14} />}
            />
          )}
          {chart.files.json && (
            <DownloadButton
              label="JSON"
              url={
                isSample
                  ? buildSampleChartUrl(chart.chart_key, 'json')
                  : buildGenomeDownloadUrl(jobId, 'charts', `${chart.chart_key}.json`)
              }
              color="gray"
              icon={<IconJson size={14} />}
            />
          )}
        </MGroup>
      </Stack>
    </Card>
  );
}

function TableCard({
  table,
  jobId,
  isSample = false,
}: {
  table: GenomeDownloadsResponse['downloads']['tables'][0];
  jobId: string;
  isSample?: boolean;
}) {
  return (
    <Card withBorder shadow="sm" padding="md">
      <Stack gap="sm">
        <Text fw={600} size="sm" lineClamp={1}>
          {table.title}
        </Text>
        <Text size="xs" c="dimmed">
          Download formats:
        </Text>
        <MGroup gap="xs">
          {table.files.csv && (
            <DownloadButton
              label="CSV"
              url={
                isSample
                  ? buildSampleTableUrl(table.name, 'csv')
                  : buildGenomeDownloadUrl(jobId, 'tables', `${table.name}.csv`)
              }
              color="green"
              icon={<IconTable size={14} />}
            />
          )}
          {table.files.xlsx && (
            <DownloadButton
              label="XLSX"
              url={
                isSample
                  ? buildSampleTableUrl(table.name, 'xlsx')
                  : buildGenomeDownloadUrl(jobId, 'tables', `${table.name}.xlsx`)
              }
              color="blue"
              icon={<IconTable size={14} />}
            />
          )}
        </MGroup>
      </Stack>
    </Card>
  );
}

export default function GenomeDownloadsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [data, setData] = useState<GenomeDownloadsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSample, setIsSample] = useState(false);

  useEffect(() => {
    const fetchDownloads = async () => {
      try {
        setLoading(true);
        setError(null);

        // Try to fetch job downloads first
        if (jobId && jobId !== 'sample') {
          try {
            const result = await getGenomeDownloads(jobId);
            setData(result);
            setIsSample(false);
          } catch {
            // If job downloads not available, try sample
            const sampleResult = await getSampleDownloads();
            setData(sampleResult);
            setIsSample(true);
          }
        } else {
          // If no jobId or it's 'sample', show sample downloads
          const sampleResult = await getSampleDownloads();
          setData(sampleResult);
          setIsSample(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load downloads');
      } finally {
        setLoading(false);
      }
    };

    fetchDownloads();
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

  if (!data?.downloads) {
    return (
      <Alert color="yellow" title="No Downloads">
        No downloads available.
      </Alert>
    );
  }

  const { charts, tables, result, metadata } = data.downloads;
  const displayJobId = isSample ? 'sample' : (jobId || 'sample');

  return (
    <Stack gap="xl">
      <Group justify="space-between">
        <div>
          <Title order={2} mb="xs">
            Downloads
          </Title>
          <Group gap="xs">
            <Text c="dimmed">Job ID: </Text>
            <Text fw={600} ff="monospace">{displayJobId}</Text>
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
            to={`/genome/jobs/${displayJobId}/result`}
            leftSection={<IconChartBar size={16} />}
          >
            View Results
          </Button>
          {!isSample && (
            <Button
              variant="light"
              component={Link}
              to={`/genome/jobs/${jobId}`}
            >
              Job Details
            </Button>
          )}
        </Group>
      </Group>

      {/* Summary */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
        <Card withBorder shadow="sm" padding="md">
          <Group>
            <ThemeIcon color="blue" size="lg" variant="light">
              <IconChartBar size={18} />
            </ThemeIcon>
            <div>
              <Text size="xl" fw={700}>{charts.length}</Text>
              <Text size="xs" c="dimmed">Charts</Text>
            </div>
          </Group>
        </Card>
        <Card withBorder shadow="sm" padding="md">
          <Group>
            <ThemeIcon color="green" size="lg" variant="light">
              <IconTable size={18} />
            </ThemeIcon>
            <div>
              <Text size="xl" fw={700}>{tables.length}</Text>
              <Text size="xs" c="dimmed">Tables</Text>
            </div>
          </Group>
        </Card>
        <Card withBorder shadow="sm" padding="md">
          <Group>
            <ThemeIcon color="orange" size="lg" variant="light">
              <IconFile size={18} />
            </ThemeIcon>
            <div>
              <Text size="xl" fw={700}>{result.length}</Text>
              <Text size="xs" c="dimmed">Result Files</Text>
            </div>
          </Group>
        </Card>
        <Card withBorder shadow="sm" padding="md">
          <Group>
            <ThemeIcon color="gray" size="lg" variant="light">
              <IconJson size={18} />
            </ThemeIcon>
            <div>
              <Text size="xl" fw={700}>{metadata.length}</Text>
              <Text size="xs" c="dimmed">Metadata</Text>
            </div>
          </Group>
        </Card>
      </SimpleGrid>

      <Accordion variant="separated">
        {/* Charts */}
        <Accordion.Item value="charts">
          <Accordion.Control>
            <Group>
              <IconChartBar size={18} />
              <Text fw={600}>Interactive Charts ({charts.length})</Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            {charts.length > 0 ? (
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
                {charts.map((chart) => (
                  <ChartCard key={chart.chart_key} chart={chart} jobId={displayJobId} isSample={isSample} />
                ))}
              </SimpleGrid>
            ) : (
              <Text c="dimmed" ta="center" py="md">
                No charts available
              </Text>
            )}
          </Accordion.Panel>
        </Accordion.Item>

        {/* Tables */}
        <Accordion.Item value="tables">
          <Accordion.Control>
            <Group>
              <IconTable size={18} />
              <Text fw={600}>Tables ({tables.length})</Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            {tables.length > 0 ? (
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
                {tables.map((table) => (
                  <TableCard key={table.name} table={table} jobId={displayJobId} isSample={isSample} />
                ))}
              </SimpleGrid>
            ) : (
              <Text c="dimmed" ta="center" py="md">
                No tables available
              </Text>
            )}
          </Accordion.Panel>
        </Accordion.Item>

        {/* Results */}
        <Accordion.Item value="result">
          <Accordion.Control>
            <Group>
              <IconFile size={18} />
              <Text fw={600}>Results ({result.length})</Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            {result.length > 0 ? (
              <Stack gap="sm">
                {result.map((item) => (
                  <Card key={item.name} withBorder shadow="sm" padding="sm">
                    <Group justify="space-between">
                      <Text size="sm" fw={500}>{item.name}</Text>
                      <DownloadButton
                        label="JSON"
                        url={
                          isSample
                            ? buildSampleFileUrl('result', `${item.name}.json`)
                            : item.files.json
                        }
                        color="gray"
                        icon={<IconJson size={14} />}
                      />
                    </Group>
                  </Card>
                ))}
              </Stack>
            ) : (
              <Text c="dimmed" ta="center" py="md">
                No result files available
              </Text>
            )}
          </Accordion.Panel>
        </Accordion.Item>

        {/* Metadata */}
        <Accordion.Item value="metadata">
          <Accordion.Control>
            <Group>
              <IconJson size={18} />
              <Text fw={600}>Metadata ({metadata.length})</Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            {metadata.length > 0 ? (
              <Stack gap="sm">
                {metadata.map((item) => (
                  <Card key={item.name} withBorder shadow="sm" padding="sm">
                    <Group justify="space-between">
                      <Text size="sm" fw={500}>{item.name}</Text>
                      <DownloadButton
                        label="JSON"
                        url={
                          isSample
                            ? buildSampleFileUrl('metadata', `${item.name}.json`)
                            : item.files.json
                        }
                        color="gray"
                        icon={<IconJson size={14} />}
                      />
                    </Group>
                  </Card>
                ))}
              </Stack>
            ) : (
              <Text c="dimmed" ta="center" py="md">
                No metadata available
              </Text>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
