import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Divider,
  Group,
  LoadingOverlay,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconChartBar,
  IconChartDots,
  IconDatabase,
  IconDna,
  IconExternalLink,
  IconInfoCircle,
  IconRefresh,
  IconTable,
  IconTransform,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";
import {
  getAlignmentBlocks,
  getAlignmentStats,
  getBaseLevelRecords,
  getChromosomeMapping,
  getComparativeMethods,
  getGeneCollinearity,
  getGoldStandardStatus,
  getOrthologTable,
  mapCoordinates,
  type AlignmentBlock,
  type AlignmentMode,
  type AlignmentStats,
  type BaseLevelResponse,
  type ChromosomeMapping,
  type ComparativeMethods,
  type GeneCoordinateMapping,
  type GeneCollinearityResponse,
  type GoldStandardLayer,
  type GoldStandardStatus,
} from "../lib/comparativeApi";

const CHROMOSOMES = [
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
  "21", "22", "23", "24", "25", "26", "27", "28", "29", "30",
  "31", "32", "W", "Z", "MT",
];

const PAGE_SIZE = 50;
const NATURAL_FILTERS = {
  min_quality: 30,
  min_identity: 85,
  min_alignment_length: 50_000,
  limit: 5000,
};
const WINDOWED_FILTERS = {
  min_quality: 30,
  min_identity: 0,
  min_alignment_length: 0,
  limit: 5000,
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed";
}

function dash(value: number | undefined | null, digits?: number) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return digits === undefined ? value.toLocaleString() : value.toFixed(digits);
}

function pct(value: number | undefined | null, digits = 1) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

function bp(value: number | undefined | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} Mb`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} kb`;
  return `${value.toLocaleString()} bp`;
}

function displayStart(value: number) {
  return (value + 1).toLocaleString();
}

function displayEnd(value: number) {
  return value.toLocaleString();
}

export default function ComparativeGenomicsPage() {
  const [activeTab, setActiveTab] = useState<string | null>("overview");
  const [plotMode, setPlotMode] = useState<AlignmentMode>("natural");
  const [chrFilter, setChrFilter] = useState<string | null>(null);

  const [naturalBlocks, setNaturalBlocks] = useState<AlignmentBlock[]>([]);
  const [windowedBlocks, setWindowedBlocks] = useState<AlignmentBlock[]>([]);
  const [naturalStats, setNaturalStats] = useState<AlignmentStats | null>(null);
  const [windowedStats, setWindowedStats] = useState<AlignmentStats | null>(null);
  const [methods, setMethods] = useState<ComparativeMethods | null>(null);
  const [goldStatus, setGoldStatus] = useState<GoldStandardStatus | null>(null);
  const [baseLevel, setBaseLevel] = useState<BaseLevelResponse | null>(null);
  const [geneCollinearity, setGeneCollinearity] = useState<GeneCollinearityResponse | null>(null);
  const [chrMapping, setChrMapping] = useState<ChromosomeMapping[]>([]);
  const [orthologs, setOrthologs] = useState<GeneCoordinateMapping[]>([]);
  const [orthologTotal, setOrthologTotal] = useState(0);
  const [orthologPage, setOrthologPage] = useState(0);
  const [baseSide, setBaseSide] = useState<"query" | "target">("query");
  const [baseChr, setBaseChr] = useState("1");
  const [baseStart, setBaseStart] = useState("1");
  const [baseEnd, setBaseEnd] = useState("5000000");
  const [baseLoading, setBaseLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [orthologLoading, setOrthologLoading] = useState(false);
  const [error, setError] = useState("");

  const loadAlignmentData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const chrParam = chrFilter || undefined;
      const [
        naturalStatsRow,
        windowedStatsRow,
        naturalRows,
        windowedRows,
        methodRows,
        goldRows,
        geneCollinearityRows,
        mappingRows,
      ] = await Promise.all([
        getAlignmentStats({ mode: "natural", ...NATURAL_FILTERS }),
        getAlignmentStats({ mode: "windowed", ...WINDOWED_FILTERS }),
        getAlignmentBlocks({ mode: "natural", chr_1: chrParam, order: "coordinate", ...NATURAL_FILTERS }),
        getAlignmentBlocks({ mode: "windowed", chr_1: chrParam, order: "coordinate", ...WINDOWED_FILTERS }),
        getComparativeMethods(),
        getGoldStandardStatus(),
        getGeneCollinearity({ chr: chrParam, limit: 100 }).catch(() => null),
        getChromosomeMapping("GRCg6a", "GRCg7b").catch(() => []),
      ]);
      setNaturalStats(naturalStatsRow);
      setWindowedStats(windowedStatsRow);
      setNaturalBlocks(naturalRows);
      setWindowedBlocks(windowedRows);
      setMethods(methodRows);
      setGoldStatus(goldRows);
      setGeneCollinearity(geneCollinearityRows);
      setChrMapping(mappingRows);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [chrFilter]);

  const loadOrthologs = useCallback(async (page = 0) => {
    setOrthologLoading(true);
    try {
      const result = await getOrthologTable({
        assembly_1: "GRCg6a",
        assembly_2: "GRCg7b",
        chr: chrFilter || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setOrthologs(result.data);
      setOrthologTotal(result.total);
      setOrthologPage(page);
    } catch {
      setOrthologs([]);
      setOrthologTotal(0);
      setOrthologPage(0);
    } finally {
      setOrthologLoading(false);
    }
  }, [chrFilter]);

  useEffect(() => {
    loadAlignmentData();
  }, [loadAlignmentData]);

  useEffect(() => {
    if (activeTab === "genes") loadOrthologs(0);
  }, [activeTab, loadOrthologs]);

  const refresh = () => {
    loadAlignmentData();
    if (activeTab === "genes") loadOrthologs(orthologPage);
  };

  const loadBaseLevel = async () => {
    const start = Math.max(0, Number(baseStart.replace(/,/g, "")) - 1);
    const end = Number(baseEnd.replace(/,/g, ""));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      setError("Base-level region must have a valid start/end interval.");
      return;
    }
    setBaseLoading(true);
    setError("");
    try {
      setBaseLevel(await getBaseLevelRecords({
        side: baseSide,
        chr: baseChr,
        start,
        end,
        limit: 50,
      }));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBaseLoading(false);
    }
  };

  const plotBlocks = plotMode === "natural" ? naturalBlocks : windowedBlocks;
  const plotStats = plotMode === "natural" ? naturalStats : windowedStats;

  return (
    <Container size="xl" py="md">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start" gap="md">
          <div>
            <Title order={2}>Comparative Synteny: GRCg6a vs GRCg7b</Title>
            <Text c="dimmed" size="sm">
              Natural-breakpoint whole-genome alignment is the primary synteny layer; fixed 1 Mb PAF windows are retained as QC.
            </Text>
          </div>
          <Group gap="xs">
            <Button component={Link} to="/jbrowse?mode=comparative" leftSection={<IconExternalLink size={16} />} variant="light">
              Open JBrowse
            </Button>
            <Button leftSection={<IconRefresh size={16} />} variant="light" onClick={refresh} loading={loading}>
              Refresh
            </Button>
          </Group>
        </Group>

        <SimpleGrid cols={{ base: 1, md: 4 }}>
          <MetricCard
            label="Primary Dataset"
            value={naturalStats?.block_count}
            detail={naturalStats?.dataset_classification || "Natural PAF"}
          />
          <MetricCard
            label="Weighted Identity"
            value={naturalStats?.weighted_identity}
            suffix="%"
            digits={1}
            detail={`mapQ >= ${NATURAL_FILTERS.min_quality}, identity >= ${NATURAL_FILTERS.min_identity}%, length >= ${bp(NATURAL_FILTERS.min_alignment_length)}`}
          />
          <MetricCard
            label="Query Coverage"
            value={naturalStats?.query_coverage_fraction ? naturalStats.query_coverage_fraction * 100 : undefined}
            suffix="%"
            digits={1}
            detail={`${bp(naturalStats?.query_covered_bases)} covered in GRCg6a`}
          />
          <MetricCard
            label="Window QC"
            value={windowedStats?.rounded_query_start_fraction ? windowedStats.rounded_query_start_fraction * 100 : undefined}
            suffix="%"
            digits={0}
            detail="Rounded 1 Mb query starts"
          />
        </SimpleGrid>

        <Card withBorder radius="sm" p="md">
          <Group justify="space-between" align="end" gap="md">
            <Group align="end" gap="md">
              <Select label="Assembly 1" value="GRCg6a" data={["GRCg6a"]} disabled w={140} />
              <Select label="Assembly 2" value="GRCg7b" data={["GRCg7b"]} disabled w={140} />
              <Select
                label="Chromosome"
                value={chrFilter}
                onChange={setChrFilter}
                data={CHROMOSOMES}
                clearable
                placeholder="All primary"
                w={150}
              />
            </Group>
            <Group gap="xs">
              <Badge variant="light" color="green">Natural PAF primary</Badge>
              <Badge variant="light" color="gray">PAF 0-based source</Badge>
              <Tooltip label="Displayed table intervals use start + 1 and PAF end as the inclusive label.">
                <Badge leftSection={<IconInfoCircle size={12} />} variant="light" color="blue">1-based display</Badge>
              </Tooltip>
            </Group>
          </Group>
        </Card>

        {error && (
          <Alert color="red" title="Comparative alignment data is unavailable">
            {error}
          </Alert>
        )}

        <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="overview" leftSection={<IconChartBar size={16} />}>Overview</Tabs.Tab>
            <Tabs.Tab value="gold" leftSection={<IconInfoCircle size={16} />}>Gold Standard</Tabs.Tab>
            <Tabs.Tab value="natural" leftSection={<IconDna size={16} />}>Natural Synteny</Tabs.Tab>
            <Tabs.Tab value="dotplot" leftSection={<IconChartDots size={16} />}>Dotplot</Tabs.Tab>
            <Tabs.Tab value="baselevel" leftSection={<IconTable size={16} />}>Base-Level</Tabs.Tab>
            <Tabs.Tab value="windowed" leftSection={<IconDatabase size={16} />}>Window QC</Tabs.Tab>
            <Tabs.Tab value="collinearity" leftSection={<IconTable size={16} />}>Gene Collinearity</Tabs.Tab>
            <Tabs.Tab value="genes" leftSection={<IconTable size={16} />}>Gene Layer</Tabs.Tab>
            <Tabs.Tab value="methods" leftSection={<IconInfoCircle size={16} />}>Methods</Tabs.Tab>
            <Tabs.Tab value="mapper" leftSection={<IconTransform size={16} />}>Coordinate Mapper</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="overview" pt="md">
            <OverviewPanel
              naturalStats={naturalStats}
              windowedStats={windowedStats}
              methods={methods}
              chrMapping={chrMapping}
              loading={loading}
            />
          </Tabs.Panel>
          <Tabs.Panel value="gold" pt="md">
            <GoldStandardPanel status={goldStatus} loading={loading} />
          </Tabs.Panel>
          <Tabs.Panel value="natural" pt="md">
            <AlignmentPanel
              title="Natural-Breakpoint Alignment Blocks"
              mode="natural"
              blocks={naturalBlocks}
              stats={naturalStats}
              loading={loading}
            />
          </Tabs.Panel>
          <Tabs.Panel value="dotplot" pt="md">
            <Stack gap="md">
              <Group justify="space-between">
                <SegmentedControl
                  value={plotMode}
                  onChange={(value) => setPlotMode(value as AlignmentMode)}
                  data={[
                    { label: "Natural", value: "natural" },
                    { label: "Window QC", value: "windowed" },
                  ]}
                />
                <Badge variant="light">{plotStats?.dataset_classification || plotMode}</Badge>
              </Group>
              <DotplotPanel data={plotBlocks} loading={loading} mode={plotMode} stats={plotStats} />
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="baselevel" pt="md">
            <BaseLevelPanel
              result={baseLevel}
              side={baseSide}
              chr={baseChr}
              start={baseStart}
              end={baseEnd}
              loading={baseLoading}
              onSideChange={setBaseSide}
              onChrChange={setBaseChr}
              onStartChange={setBaseStart}
              onEndChange={setBaseEnd}
              onRun={loadBaseLevel}
              layer={goldStatus?.layers.base_level_alignment || null}
            />
          </Tabs.Panel>
          <Tabs.Panel value="windowed" pt="md">
            <WindowQcPanel blocks={windowedBlocks} stats={windowedStats} loading={loading} />
          </Tabs.Panel>
          <Tabs.Panel value="collinearity" pt="md">
            <GeneCollinearityPanel result={geneCollinearity} layer={goldStatus?.layers.gene_collinearity || null} />
          </Tabs.Panel>
          <Tabs.Panel value="genes" pt="md">
            <GeneLayerPanel
              orthologs={orthologs}
              total={orthologTotal}
              page={orthologPage}
              loading={orthologLoading}
              onPageChange={loadOrthologs}
            />
          </Tabs.Panel>
          <Tabs.Panel value="methods" pt="md">
            <MethodsPanel methods={methods} naturalStats={naturalStats} windowedStats={windowedStats} />
          </Tabs.Panel>
          <Tabs.Panel value="mapper" pt="md">
            <CoordinateMapperPanel />
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
}

function MetricCard({ label, value, detail, suffix = "", digits }: {
  label: string;
  value: number | undefined;
  detail: string;
  suffix?: string;
  digits?: number;
}) {
  return (
    <Card withBorder radius="sm">
      <Text size="xs" tt="uppercase" c="dimmed" fw={700}>{label}</Text>
      <Text size="xl" fw={700}>{dash(value, digits)}{value === undefined ? "" : suffix}</Text>
      <Text size="xs" c="dimmed">{detail}</Text>
    </Card>
  );
}

function OverviewPanel({
  naturalStats,
  windowedStats,
  methods,
  chrMapping,
  loading,
}: {
  naturalStats: AlignmentStats | null;
  windowedStats: AlignmentStats | null;
  methods: ComparativeMethods | null;
  chrMapping: ChromosomeMapping[];
  loading: boolean;
}) {
  return (
    <Stack gap="md">
      <Card withBorder radius="sm" pos="relative">
        <LoadingOverlay visible={loading} />
        <Group justify="space-between" mb="md">
          <Text fw={700}>Dataset Separation</Text>
          <Badge color="green" variant="light">{methods?.primary_dataset || "natural"} primary</Badge>
        </Group>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <DatasetSummary title="Natural synteny" stats={naturalStats} color="green" />
          <DatasetSummary title="1 Mb window QC" stats={windowedStats} color="gray" />
        </SimpleGrid>
      </Card>

      <Card withBorder radius="sm">
        <Group justify="space-between" mb="md">
          <Text fw={700}>Primary Chromosome Mapping</Text>
          <Badge variant="light">{"GRCg6a -> GRCg7b"}</Badge>
        </Group>
        {chrMapping.length ? (
          <ScrollArea h={340}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Chr</Table.Th>
                  <Table.Th>GRCg6a RefSeq</Table.Th>
                  <Table.Th>GRCg7b RefSeq</Table.Th>
                  <Table.Th>Strand</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {chrMapping.map((m) => (
                  <Table.Tr key={m.mapping_id}>
                    <Table.Td><Badge variant="light">chr{m.chr_from}</Badge></Table.Td>
                    <Table.Td><Text size="sm" ff="monospace">{m.refseq_from}</Text></Table.Td>
                    <Table.Td><Text size="sm" ff="monospace">{m.refseq_to}</Text></Table.Td>
                    <Table.Td>{m.strand}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        ) : (
          <Alert color="gray">Chromosome mapping table is not loaded from the database, but PAF-based synteny remains available.</Alert>
        )}
      </Card>
    </Stack>
  );
}

function DatasetSummary({ title, stats, color }: { title: string; stats: AlignmentStats | null; color: string }) {
  const queryCoverage = stats?.query_coverage_fraction ?? 0;
  const targetCoverage = stats?.target_coverage_fraction ?? 0;

  return (
    <Paper withBorder radius="sm" p="md">
      <Group justify="space-between" mb="xs">
        <Text fw={700}>{title}</Text>
        <Badge color={color} variant="light">{stats?.dataset_classification || "unavailable"}</Badge>
      </Group>
      <SimpleGrid cols={2} spacing="xs">
        <SmallStat label="Blocks" value={dash(stats?.block_count)} />
        <SmallStat label="Identity" value={`${dash(stats?.weighted_identity, 1)}%`} />
        <SmallStat label="Reverse blocks" value={dash(stats?.reverse_strand_blocks)} />
        <SmallStat label="Off diagonal" value={dash(stats?.off_diagonal_blocks)} />
      </SimpleGrid>
      <Divider my="sm" />
      <Stack gap={6}>
        <CoverageRow label="GRCg6a coverage" value={queryCoverage} />
        <CoverageRow label="GRCg7b coverage" value={targetCoverage} />
      </Stack>
    </Paper>
  );
}

function layerColor(status: string | undefined) {
  if (status === "available") return "green";
  if (status === "not_indexed") return "yellow";
  if (status?.includes("fallback")) return "orange";
  return "red";
}

function GoldStandardPanel({ status, loading }: {
  status: GoldStandardStatus | null;
  loading: boolean;
}) {
  if (!status) return <Paper withBorder p="xl" pos="relative"><LoadingOverlay visible={loading} /><Alert color="gray">Gold-standard evidence status is not loaded.</Alert></Paper>;
  const layers = Object.entries(status.layers) as Array<[string, GoldStandardLayer]>;

  return (
    <Stack gap="md">
      <Alert color="blue" title="Gold-standard interpretation">
        DNA natural PAF is the primary visualization layer. Base-level PAF and gene collinearity are separate evidence layers and must not be silently substituted by 1 Mb window QC.
      </Alert>
      <SimpleGrid cols={{ base: 1, md: 4 }}>
        {layers.map(([key, layer]) => (
          <Card key={key} withBorder radius="sm">
            <Group justify="space-between" mb="xs">
              <Text fw={700}>{key.replace(/_/g, " ")}</Text>
              <Badge color={layerColor(layer.status)} variant="light">{layer.status}</Badge>
            </Group>
            <Text size="xs" c="dimmed" mb="sm">{layer.best_practice}</Text>
            <Stack gap={4}>
              {layer.files.map((file) => (
                <Group key={`${key}-${file.role}`} justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed">{file.role}</Text>
                  <Badge size="xs" color={file.exists ? "green" : "red"} variant="light">
                    {file.exists ? bp(file.size_bytes) : "missing"}
                  </Badge>
                </Group>
              ))}
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
      <Card withBorder radius="sm">
        <Text fw={700} mb="sm">Fallback Governance</Text>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <KeyValue label="Natural endpoint" value={status.fallback_policy.natural_endpoint} mono />
          <KeyValue label="Fallback dataset" value={status.fallback_policy.fallback_dataset} />
          <KeyValue label="Fallback allowed" value={String(status.fallback_policy.fallback_allowed)} />
          <KeyValue label="UI requirement" value={status.fallback_policy.ui_requirement} />
        </SimpleGrid>
      </Card>
      <Card withBorder radius="sm">
        <Text fw={700} mb="sm">Tool Availability on Backend Host</Text>
        <SimpleGrid cols={{ base: 2, md: 5 }}>
          {Object.entries(status.tool_status).map(([tool, row]) => (
            <Group key={tool} gap="xs">
              <Badge color={row.available ? "green" : "gray"} variant="light">{tool}</Badge>
              <Text size="xs" c="dimmed">{row.available ? "available" : "not in PATH"}</Text>
            </Group>
          ))}
        </SimpleGrid>
      </Card>
    </Stack>
  );
}

function BaseLevelPanel({
  result,
  side,
  chr,
  start,
  end,
  loading,
  layer,
  onSideChange,
  onChrChange,
  onStartChange,
  onEndChange,
  onRun,
}: {
  result: BaseLevelResponse | null;
  side: "query" | "target";
  chr: string;
  start: string;
  end: string;
  loading: boolean;
  layer: GoldStandardLayer | null;
  onSideChange: (value: "query" | "target") => void;
  onChrChange: (value: string) => void;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onRun: () => void;
}) {
  return (
    <Stack gap="md">
      <Alert color={layer?.status === "available" ? "green" : "yellow"} title="Base-level PAF is a local details layer">
        Do not load full --cs/-c PAF into the browser. Query only the clicked block or a small region. Current layer status: {layer?.status || "unknown"}.
      </Alert>
      <Card withBorder radius="sm">
        <Group align="end">
          <Select
            label="Coordinate side"
            value={side}
            onChange={(value) => value && onSideChange(value as "query" | "target")}
            data={[
              { value: "query", label: "GRCg6a query" },
              { value: "target", label: "GRCg7b target" },
            ]}
            w={180}
          />
          <Select label="Chr" value={chr} onChange={(value) => value && onChrChange(value)} data={CHROMOSOMES} w={120} />
          <TextInput label="Start (1-based)" value={start} onChange={(event) => onStartChange(event.currentTarget.value)} w={150} />
          <TextInput label="End" value={end} onChange={(event) => onEndChange(event.currentTarget.value)} w={150} />
          <Button onClick={onRun} loading={loading}>Query Details</Button>
        </Group>
      </Card>
      {result && (
        <Card withBorder radius="sm">
          <Group justify="space-between" mb="md">
            <div>
              <Text fw={700}>Base-Level Query Result</Text>
              <Text size="xs" c="dimmed">{result.message}</Text>
            </div>
            <Badge color={layerColor(result.status)}>{result.status}</Badge>
          </Group>
          {result.records.length ? (
            <ScrollArea h={360}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Chr</Table.Th><Table.Th>Interval</Table.Th><Table.Th>Target</Table.Th>
                    <Table.Th>Strand</Table.Th><Table.Th>Identity</Table.Th><Table.Th>cs</Table.Th><Table.Th>CIGAR</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {result.records.map((record) => (
                    <Table.Tr key={record.block_id}>
                      <Table.Td>{record.chr_1}</Table.Td>
                      <Table.Td>{displayStart(record.start_1)}-{displayEnd(record.end_1)}</Table.Td>
                      <Table.Td>{record.chr_2}:{displayStart(record.start_2)}-{displayEnd(record.end_2)}</Table.Td>
                      <Table.Td>{record.strand}</Table.Td>
                      <Table.Td>{dash(record.identity, 2)}%</Table.Td>
                      <Table.Td><Badge color={record.has_cs ? "green" : "gray"} variant="light">{record.has_cs ? "yes" : "no"}</Badge></Table.Td>
                      <Table.Td><Badge color={record.has_cigar ? "green" : "gray"} variant="light">{record.has_cigar ? "yes" : "no"}</Badge></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          ) : (
            <Alert color="gray">No base-level records are available for this region.</Alert>
          )}
        </Card>
      )}
    </Stack>
  );
}

function GeneCollinearityPanel({ result, layer }: {
  result: GeneCollinearityResponse | null;
  layer: GoldStandardLayer | null;
}) {
  return (
    <Stack gap="md">
      <Alert color={layer?.status === "available" ? "green" : "yellow"} title="Gene collinearity is functional evidence">
        DNA PAF answers sequence alignment; method-labeled gene anchors answer conserved gene order. Current layer status: {layer?.status || result?.status || "unknown"}.
      </Alert>
      <Card withBorder radius="sm">
        <Group justify="space-between" mb="md">
          <Text fw={700}>Required Gene Collinearity Files</Text>
          <Badge color={layerColor(layer?.status || result?.status)}>{layer?.status || result?.status || "unknown"}</Badge>
        </Group>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          {(layer?.files || result?.files || []).map((file) => (
            <KeyValue key={file.role} label={`${file.role} ${file.exists ? `(${bp(file.size_bytes)})` : "(missing)"}`} value={file.path} mono />
          ))}
        </SimpleGrid>
      </Card>
      {result?.blocks.length ? (
        <Card withBorder radius="sm">
          <Text fw={700} mb="sm">Gene Collinearity Blocks</Text>
          <ScrollArea h={320}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  {Object.keys(result.blocks[0]).map((key) => <Table.Th key={key}>{key}</Table.Th>)}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {result.blocks.map((row, idx) => (
                  <Table.Tr key={idx}>
                    {Object.keys(result.blocks[0]).map((key) => <Table.Td key={key}>{row[key]}</Table.Td>)}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Card>
      ) : (
        <Alert color="gray">{result?.message || "Gene collinearity outputs are not generated yet."}</Alert>
      )}
    </Stack>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={700}>{value}</Text>
    </div>
  );
}

function CoverageRow({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">{label}</Text>
        <Text size="xs" fw={700}>{pct(value)}</Text>
      </Group>
      <Progress value={Math.max(0, Math.min(100, value * 100))} size="sm" radius="xs" />
    </div>
  );
}

function AlignmentPanel({
  title,
  mode,
  blocks,
  stats,
  loading,
}: {
  title: string;
  mode: AlignmentMode;
  blocks: AlignmentBlock[];
  stats: AlignmentStats | null;
  loading: boolean;
}) {
  return (
    <Card withBorder radius="sm" pos="relative">
      <LoadingOverlay visible={loading} />
      <Group justify="space-between" mb="md">
        <div>
          <Text fw={700}>{title}</Text>
          <Text size="xs" c="dimmed">
            {mode === "natural"
              ? "minimap2 asm5 natural chain breakpoints, filtered for high-confidence display"
              : "legacy fixed-width alignment windows for QC"}
          </Text>
        </div>
        <Group gap="xs">
          <Badge color={mode === "natural" ? "green" : "gray"}>{blocks.length.toLocaleString()} rows</Badge>
          <Badge variant="light">{stats?.dataset_classification || mode}</Badge>
        </Group>
      </Group>
      <AlignmentTable blocks={blocks} />
    </Card>
  );
}

function AlignmentTable({ blocks }: { blocks: AlignmentBlock[] }) {
  if (!blocks.length) {
    return <Alert color="gray">No alignment blocks are available for the selected filters.</Alert>;
  }

  return (
    <ScrollArea h={520}>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Chr</Table.Th>
            <Table.Th>Start</Table.Th>
            <Table.Th>End</Table.Th>
            <Table.Th>Target Chr</Table.Th>
            <Table.Th>Start</Table.Th>
            <Table.Th>End</Table.Th>
            <Table.Th>Strand</Table.Th>
            <Table.Th>Length</Table.Th>
            <Table.Th>MapQ</Table.Th>
            <Table.Th>Identity</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {blocks.slice(0, 500).map((b) => (
            <Table.Tr key={b.block_id}>
              <Table.Td><Badge size="sm" variant="light">{b.chr_1}</Badge></Table.Td>
              <Table.Td>{displayStart(b.start_1)}</Table.Td>
              <Table.Td>{displayEnd(b.end_1)}</Table.Td>
              <Table.Td><Badge size="sm" variant="light">{b.chr_2}</Badge></Table.Td>
              <Table.Td>{displayStart(b.start_2)}</Table.Td>
              <Table.Td>{displayEnd(b.end_2)}</Table.Td>
              <Table.Td><Badge color={b.strand === "+" ? "green" : "red"} variant="light">{b.strand}</Badge></Table.Td>
              <Table.Td>{bp(b.alignment_length)}</Table.Td>
              <Table.Td>{b.mapping_quality}</Table.Td>
              <Table.Td>{dash(b.identity, 1)}%</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

function DotplotPanel({
  data,
  loading,
  mode,
  stats,
}: {
  data: AlignmentBlock[];
  loading: boolean;
  mode: AlignmentMode;
  stats: AlignmentStats | null;
}) {
  if (loading) return <Paper withBorder p="xl" pos="relative" h={420}><LoadingOverlay visible /></Paper>;
  if (!data.length) return <Alert color="gray">No dotplot records are available for the selected filters.</Alert>;

  const queryLengths: Record<string, number> = {};
  const targetLengths: Record<string, number> = {};
  data.forEach((d) => {
    queryLengths[d.chr_1] = Math.max(queryLengths[d.chr_1] || 0, d.query_length);
    targetLengths[d.chr_2] = Math.max(targetLengths[d.chr_2] || 0, d.target_length);
  });

  const queryOffsets: Record<string, number> = {};
  const targetOffsets: Record<string, number> = {};
  let totalQuery = 0;
  let totalTarget = 0;
  CHROMOSOMES.forEach((chr) => {
    if (queryLengths[chr]) {
      queryOffsets[chr] = totalQuery;
      totalQuery += queryLengths[chr];
    }
    if (targetLengths[chr]) {
      targetOffsets[chr] = totalTarget;
      totalTarget += targetLengths[chr];
    }
  });

  if (!totalQuery || !totalTarget) return <Alert color="gray">Dotplot coordinates are incomplete for this selection.</Alert>;

  const width = 900;
  const height = 760;
  const margin = 56;
  const plotWidth = width - 2 * margin;
  const plotHeight = height - 2 * margin;
  const hasQuery = (chr: string) => Object.prototype.hasOwnProperty.call(queryOffsets, chr);
  const hasTarget = (chr: string) => Object.prototype.hasOwnProperty.call(targetOffsets, chr);
  const scaleX = (chr: string, pos: number) => margin + ((queryOffsets[chr] + pos) / totalQuery) * plotWidth;
  const scaleY = (chr: string, pos: number) => height - margin - ((targetOffsets[chr] + pos) / totalTarget) * plotHeight;

  return (
    <Card withBorder radius="sm">
      <Group justify="space-between" mb="md">
        <div>
          <Text fw={700}>Whole-Genome Dotplot</Text>
          <Text size="xs" c="dimmed">Scaled by PAF sequence lengths, not by visible block maxima.</Text>
        </div>
        <Group gap="xs">
          <Badge color={mode === "natural" ? "green" : "gray"}>{mode}</Badge>
          <Badge variant="light">{data.length.toLocaleString()} blocks</Badge>
          <Badge variant="light">{dash(stats?.weighted_identity, 1)}% weighted identity</Badge>
        </Group>
      </Group>
      <ScrollArea>
        <svg width={width} height={height} style={{ border: "1px solid #dee2e6", display: "block", background: "#fff" }}>
          <rect x={margin} y={margin} width={plotWidth} height={plotHeight} fill="#fbfcfe" stroke="#ced4da" />
          {CHROMOSOMES.map((chr) => hasQuery(chr) ? (
            <line key={`v-${chr}`} x1={scaleX(chr, 0)} y1={margin} x2={scaleX(chr, 0)} y2={height - margin} stroke="#e9ecef" />
          ) : null)}
          {CHROMOSOMES.map((chr) => hasTarget(chr) ? (
            <line key={`h-${chr}`} x1={margin} y1={scaleY(chr, 0)} x2={width - margin} y2={scaleY(chr, 0)} stroke="#e9ecef" />
          ) : null)}
          {data.map((d) => {
            if (!hasQuery(d.chr_1) || !hasTarget(d.chr_2)) return null;
            return (
              <line
                key={d.block_id}
                x1={scaleX(d.chr_1, d.start_1)}
                y1={scaleY(d.chr_2, d.start_2)}
                x2={scaleX(d.chr_1, d.end_1)}
                y2={scaleY(d.chr_2, d.end_2)}
                stroke={d.strand === "+" ? "#2f9e44" : "#c92a2a"}
                strokeWidth={mode === "natural" ? 1.6 : 1}
                opacity={mode === "natural" ? 0.72 : 0.45}
              />
            );
          })}
          <text x={width / 2} y={height - 14} textAnchor="middle" fontSize={13}>GRCg6a query chromosomes</text>
          <text x={18} y={height / 2} textAnchor="middle" fontSize={13} transform={`rotate(-90, 18, ${height / 2})`}>GRCg7b target chromosomes</text>
        </svg>
      </ScrollArea>
    </Card>
  );
}

function WindowQcPanel({ blocks, stats, loading }: {
  blocks: AlignmentBlock[];
  stats: AlignmentStats | null;
  loading: boolean;
}) {
  return (
    <Stack gap="md">
      <Alert color="gray" title="The regular 1 Mb coordinates are expected in this QC dataset">
        These records were created by fixed genomic windows, so starts such as 127,000,000 and 144,000,000 are processing boundaries, not biological breakpoints.
      </Alert>
      <SimpleGrid cols={{ base: 1, md: 4 }}>
        <MetricCard label="Window Blocks" value={stats?.block_count} detail="Fixed window PAF records" />
        <MetricCard label="Rounded Starts" value={stats?.rounded_query_start_fraction ? stats.rounded_query_start_fraction * 100 : undefined} suffix="%" digits={0} detail="Expected for 1 Mb windows" />
        <MetricCard label="Weighted Identity" value={stats?.weighted_identity} suffix="%" digits={1} detail="Window-level alignment signal" />
        <MetricCard label="Windowed Blocks" value={stats?.one_mb_windowed_blocks} detail="Detected by query span/start" />
      </SimpleGrid>
      <AlignmentPanel title="Windowed Alignment QC Table" mode="windowed" blocks={blocks} stats={stats} loading={loading} />
    </Stack>
  );
}

function GeneLayerPanel({ orthologs, total, page, loading, onPageChange }: {
  orthologs: GeneCoordinateMapping[];
  total: number;
  page: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Stack gap="md">
      <Alert color="blue" title="Gene-level collinearity is a separate evidence layer">
        Natural PAF is DNA alignment synteny. Gene collinearity should be interpreted separately from nucleotide alignment blocks and labeled by its generating method.
      </Alert>
      <Card withBorder radius="sm" pos="relative">
        <LoadingOverlay visible={loading} />
        <Group justify="space-between" mb="md">
          <Text fw={700}>Gene Coordinate Mappings ({total.toLocaleString()})</Text>
          <Group>
            <Button size="xs" variant="light" disabled={page === 0} onClick={() => onPageChange(page - 1)}>Previous</Button>
            <Text size="sm">Page {Math.min(page + 1, totalPages)} of {totalPages}</Text>
            <Button size="xs" variant="light" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>Next</Button>
          </Group>
        </Group>
        {orthologs.length ? (
          <ScrollArea h={500}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Gene ID</Table.Th><Table.Th>Symbol</Table.Th><Table.Th>Chr 6a</Table.Th>
                  <Table.Th>Start</Table.Th><Table.Th>End</Table.Th><Table.Th>Chr 7b</Table.Th>
                  <Table.Th>Start</Table.Th><Table.Th>End</Table.Th><Table.Th>Method</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {orthologs.map((o) => (
                  <Table.Tr key={o.mapping_id}>
                    <Table.Td><Text size="xs" ff="monospace">{o.gene_id}</Text></Table.Td>
                    <Table.Td><Badge size="sm" variant="light">{o.gene_symbol || "-"}</Badge></Table.Td>
                    <Table.Td>{o.chr_from}</Table.Td><Table.Td>{o.start_from.toLocaleString()}</Table.Td><Table.Td>{o.end_from.toLocaleString()}</Table.Td>
                    <Table.Td>{o.chr_to}</Table.Td><Table.Td>{o.start_to.toLocaleString()}</Table.Td><Table.Td>{o.end_to.toLocaleString()}</Table.Td>
                    <Table.Td><Badge size="xs" variant="light">{o.mapping_method}</Badge></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        ) : (
          <Alert color="gray">Gene mapping rows are not available from the comparative database in this session.</Alert>
        )}
      </Card>
    </Stack>
  );
}

function MethodsPanel({ methods, naturalStats, windowedStats }: {
  methods: ComparativeMethods | null;
  naturalStats: AlignmentStats | null;
  windowedStats: AlignmentStats | null;
}) {
  if (!methods) return <Alert color="gray">Methods metadata is not loaded.</Alert>;
  const provenance = methods.natural_alignment.provenance;

  return (
    <Stack gap="md">
      <Card withBorder radius="sm">
        <Group justify="space-between" mb="md">
          <Text fw={700}>Natural Alignment Provenance</Text>
          <Badge color={methods.natural_alignment.status === "available" ? "green" : "red"}>{methods.natural_alignment.status}</Badge>
        </Group>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <KeyValue label="Tool" value={`${provenance.tool || "minimap2"} ${provenance.preset || "asm5"}`} />
          <KeyValue label="Generated" value={String(provenance.generated_at || "-")} />
          <KeyValue label="Command" value={String(provenance.output_paf ? "minimap2 -x asm5 --secondary=no" : "-")} mono />
          <KeyValue label="JBrowse2 input" value={`${methods.jbrowse2.compatible_input} / ${methods.jbrowse2.view}`} />
          <KeyValue label="Natural PAF" value={methods.natural_alignment.path} mono />
          <KeyValue label="Window QC PAF" value={methods.windowed_alignment_qc.path} mono />
        </SimpleGrid>
      </Card>

      <Card withBorder radius="sm">
        <Text fw={700} mb="sm">Interpretation Rules</Text>
        <Stack gap="xs">
          <Text size="sm">{methods.natural_alignment.interpretation}</Text>
          <Text size="sm">{methods.windowed_alignment_qc.interpretation}</Text>
          <Text size="sm">{methods.jbrowse2.note}</Text>
          <Text size="sm">
            Natural display filters: mapQ {">="} {NATURAL_FILTERS.min_quality}, identity {">="} {NATURAL_FILTERS.min_identity}%, alignment length {">="} {bp(NATURAL_FILTERS.min_alignment_length)}.
          </Text>
          <Text size="sm">Natural blocks shown: {dash(naturalStats?.block_count)}; window QC blocks: {dash(windowedStats?.block_count)}.</Text>
        </Stack>
      </Card>
    </Stack>
  );
}

function KeyValue({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>
      <Text size="sm" ff={mono ? "monospace" : undefined} style={{ wordBreak: "break-word" }}>{value}</Text>
    </div>
  );
}

function CoordinateMapperPanel() {
  const [geneId, setGeneId] = useState("");
  const [result, setResult] = useState<GeneCoordinateMapping | null>(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    if (!geneId.trim()) return;
    setSearching(true);
    setError("");
    setResult(null);
    try {
      setResult(await mapCoordinates(geneId.trim(), "GRCg6a", "GRCg7b"));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSearching(false);
    }
  };

  return (
    <Stack gap="md">
      <Card withBorder radius="sm">
        <Text fw={700} mb="md">Map Gene Coordinates</Text>
        <Group align="end">
          <Select label="From" value="GRCg6a" data={["GRCg6a"]} disabled w={120} />
          <Select label="To" value="GRCg7b" data={["GRCg7b"]} disabled w={120} />
          <TextInput
            label="Gene ID"
            value={geneId}
            onChange={(event) => setGeneId(event.currentTarget.value)}
            placeholder="e.g. gene-A4GALT"
            onKeyDown={(event) => event.key === "Enter" && handleSearch()}
            style={{ flex: 1, minWidth: 220 }}
          />
          <Button onClick={handleSearch} loading={searching}>Map</Button>
        </Group>
      </Card>

      {error && <Alert color="red">{error}</Alert>}

      {result && (
        <Card withBorder radius="sm">
          <Text fw={700} mb="md">Mapping Result</Text>
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <div>
              <Text size="sm" c="dimmed">GRCg6a Coordinates</Text>
              <Text>Chr: {result.chr_from}</Text>
              <Text>Start: {result.start_from.toLocaleString()}</Text>
              <Text>End: {result.end_from.toLocaleString()}</Text>
              <Text>Strand: {result.strand_from}</Text>
            </div>
            <div>
              <Text size="sm" c="dimmed">GRCg7b Coordinates</Text>
              <Text>Chr: {result.chr_to}</Text>
              <Text>Start: {result.start_to.toLocaleString()}</Text>
              <Text>End: {result.end_to.toLocaleString()}</Text>
              <Text>Strand: {result.strand_to}</Text>
            </div>
          </SimpleGrid>
          <Group mt="md">
            <Badge>Method: {result.mapping_method}</Badge>
            <Badge>Confidence: {(result.confidence * 100).toFixed(0)}%</Badge>
          </Group>
        </Card>
      )}
    </Stack>
  );
}
