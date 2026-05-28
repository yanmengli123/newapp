import { useState, useEffect, useCallback } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Group,
  LoadingOverlay,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconChartBar,
  IconChartDots,
  IconDna,
  IconExternalLink,
  IconRefresh,
  IconTable,
  IconTransform,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";
import {
  getAssemblies,
  getChromosomeMapping,
  getComparisonStats,
  getDotplotData,
  getOrthologTable,
  getSyntenyBlocks,
  mapCoordinates,
  type Assembly,
  type ChromosomeMapping,
  type ComparisonStats,
  type GeneCoordinateMapping,
  type SyntenyBlock,
} from "../lib/comparativeApi";

const CHROMOSOMES = [
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
  "21", "22", "23", "24", "25", "26", "27", "28", "29", "30",
  "31", "32", "W", "Z", "MT",
];

const PAGE_SIZE = 50;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed";
}

function dash(value: number | undefined | null, digits?: number) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return digits === undefined ? value.toLocaleString() : value.toFixed(digits);
}

export default function ComparativeGenomicsPage() {
  const [activeTab, setActiveTab] = useState<string | null>("overview");
  const [assembly1, setAssembly1] = useState("GRCg6a");
  const [assembly2, setAssembly2] = useState("GRCg7b");
  const [chrFilter, setChrFilter] = useState<string | null>(null);

  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [chrMapping, setChrMapping] = useState<ChromosomeMapping[]>([]);
  const [syntenyBlocks, setSyntenyBlocks] = useState<SyntenyBlock[]>([]);
  const [dotplotData, setDotplotData] = useState<SyntenyBlock[]>([]);
  const [stats, setStats] = useState<ComparisonStats | null>(null);
  const [orthologs, setOrthologs] = useState<GeneCoordinateMapping[]>([]);
  const [orthologTotal, setOrthologTotal] = useState(0);
  const [orthologPage, setOrthologPage] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const assemblyOptions = assemblies.length
    ? assemblies.map((a) => a.assembly_name)
    : ["GRCg6a", "GRCg7b"];

  const loadCore = useCallback(async () => {
    setError("");
    try {
      const [assemblyRows, mappingRows, statRows] = await Promise.all([
        getAssemblies(),
        getChromosomeMapping(assembly1, assembly2),
        getComparisonStats(assembly1, assembly2),
      ]);
      setAssemblies(assemblyRows);
      setChrMapping(mappingRows);
      setStats(statRows);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, [assembly1, assembly2]);

  const loadSynteny = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const blocks = await getSyntenyBlocks({
        assembly_1: assembly1,
        assembly_2: assembly2,
        chr_1: chrFilter || undefined,
        min_score: 0,
        limit: 5000,
      });
      setSyntenyBlocks(blocks);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [assembly1, assembly2, chrFilter]);

  const loadDotplot = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getDotplotData({
        assembly_1: assembly1,
        assembly_2: assembly2,
        chr_1: chrFilter || undefined,
        min_score: 0,
      });
      setDotplotData(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [assembly1, assembly2, chrFilter]);

  const loadOrthologs = useCallback(async (page = 0) => {
    setLoading(true);
    setError("");
    try {
      const result = await getOrthologTable({
        assembly_1: assembly1,
        assembly_2: assembly2,
        chr: chrFilter || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setOrthologs(result.data);
      setOrthologTotal(result.total);
      setOrthologPage(page);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [assembly1, assembly2, chrFilter]);

  useEffect(() => {
    loadCore();
  }, [loadCore]);

  useEffect(() => {
    if (activeTab === "synteny") loadSynteny();
    if (activeTab === "dotplot") loadDotplot();
    if (activeTab === "orthologs") loadOrthologs(0);
  }, [activeTab, loadDotplot, loadOrthologs, loadSynteny]);

  const refreshActiveTab = () => {
    loadCore();
    if (activeTab === "synteny") loadSynteny();
    if (activeTab === "dotplot") loadDotplot();
    if (activeTab === "orthologs") loadOrthologs(orthologPage);
  };

  return (
    <Container size="xl" py="md">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start" gap="md">
          <div>
            <Title order={2}>Comparative Genomics</Title>
            <Text c="dimmed" size="sm">
              GRCg6a to GRCg7b chromosome mapping, synteny blocks, dotplot, and gene coordinate lookup.
            </Text>
          </div>
          <Group gap="xs">
            <Button component={Link} to="/jbrowse?mode=comparative" leftSection={<IconExternalLink size={16} />} variant="light">
              Open JBrowse
            </Button>
            <Button leftSection={<IconRefresh size={16} />} variant="light" onClick={refreshActiveTab}>
              Refresh
            </Button>
          </Group>
        </Group>

        <SimpleGrid cols={{ base: 1, md: 3 }}>
          <Card withBorder radius="sm" p="md">
            <Text size="xs" tt="uppercase" c="dimmed" fw={700}>Mode</Text>
            <Text fw={700}>{assembly1} vs {assembly2}</Text>
          </Card>
          <Card withBorder radius="sm" p="md">
            <Text size="xs" tt="uppercase" c="dimmed" fw={700}>Configuration</Text>
            <Text fw={700}>Dual assembly</Text>
          </Card>
          <Card withBorder radius="sm" p="md">
            <Text size="xs" tt="uppercase" c="dimmed" fw={700}>JBrowse tracks</Text>
            <Group gap={6} mt={4}>
              <Badge variant="light">GRCg6a Genes</Badge>
              <Badge variant="light">GRCg7b Genes</Badge>
              <Badge variant="light">Synteny</Badge>
            </Group>
          </Card>
        </SimpleGrid>

        <Card withBorder radius="sm" p="md">
          <Group justify="space-between" align="end" gap="md">
            <Group align="end" gap="md">
              <Select
                label="Assembly 1"
                value={assembly1}
                onChange={(v) => setAssembly1(v || "GRCg6a")}
                data={assemblyOptions}
                w={150}
              />
              <Select
                label="Assembly 2"
                value={assembly2}
                onChange={(v) => setAssembly2(v || "GRCg7b")}
                data={assemblyOptions}
                w={150}
              />
              <Select
                label="Chromosome"
                value={chrFilter}
                onChange={setChrFilter}
                data={CHROMOSOMES}
                clearable
                placeholder="All"
                w={130}
              />
            </Group>
            <Text size="sm" c="dimmed">
              Primary reference genome: GRCg6a
            </Text>
          </Group>
        </Card>

        {error && (
          <Alert color="red" title="Comparative data is unavailable">
            {error}
          </Alert>
        )}

        <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="overview" leftSection={<IconChartBar size={16} />}>Overview</Tabs.Tab>
            <Tabs.Tab value="synteny" leftSection={<IconDna size={16} />}>Synteny</Tabs.Tab>
            <Tabs.Tab value="dotplot" leftSection={<IconChartDots size={16} />}>Dotplot</Tabs.Tab>
            <Tabs.Tab value="orthologs" leftSection={<IconTable size={16} />}>Gene Orthologs</Tabs.Tab>
            <Tabs.Tab value="mapper" leftSection={<IconTransform size={16} />}>Coordinate Mapper</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="overview" pt="md">
            <OverviewPanel assembly1={assembly1} assembly2={assembly2} stats={stats} chrMapping={chrMapping} />
          </Tabs.Panel>
          <Tabs.Panel value="synteny" pt="md">
            <SyntenyPanel syntenyBlocks={syntenyBlocks} loading={loading} assembly1={assembly1} assembly2={assembly2} />
          </Tabs.Panel>
          <Tabs.Panel value="dotplot" pt="md">
            <DotplotPanel data={dotplotData} loading={loading} assembly1={assembly1} assembly2={assembly2} />
          </Tabs.Panel>
          <Tabs.Panel value="orthologs" pt="md">
            <OrthologPanel orthologs={orthologs} total={orthologTotal} page={orthologPage} loading={loading} onPageChange={loadOrthologs} />
          </Tabs.Panel>
          <Tabs.Panel value="mapper" pt="md">
            <CoordinateMapperPanel assembly1={assembly1} assembly2={assembly2} />
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
}

function OverviewPanel({
  assembly1,
  assembly2,
  stats,
  chrMapping,
}: {
  assembly1: string;
  assembly2: string;
  stats: ComparisonStats | null;
  chrMapping: ChromosomeMapping[];
}) {
  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <MetricCard label="Synteny Blocks" value={stats?.synteny?.block_count} detail={`${dash(stats?.synteny?.chromosomes_1)} chromosomes aligned`} />
        <MetricCard label="Gene Orthologs" value={stats?.gene_mapping?.mapped_genes} detail={`${dash(stats?.gene_mapping?.chr_from_count)} chromosomes mapped`} />
        <MetricCard label="Avg Identity" value={stats?.synteny?.avg_identity} suffix="%" detail="Alignment quality" digits={1} />
      </SimpleGrid>

      <Card withBorder radius="sm">
        <Group justify="space-between" mb="md">
          <Text fw={700}>Chromosome Mapping</Text>
          <Badge variant="light">{assembly1} ↔ {assembly2}</Badge>
        </Group>
        <ScrollArea h={400}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Chr</Table.Th>
                <Table.Th>{assembly1} RefSeq</Table.Th>
                <Table.Th>{assembly2} RefSeq</Table.Th>
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
      </Card>
    </Stack>
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
      <Text size="sm" c="dimmed">{label}</Text>
      <Text size="xl" fw={700}>{dash(value, digits)}{value === undefined ? "" : suffix}</Text>
      <Text size="xs" c="dimmed">{detail}</Text>
    </Card>
  );
}

function SyntenyPanel({ syntenyBlocks, loading, assembly1, assembly2 }: {
  syntenyBlocks: SyntenyBlock[];
  loading: boolean;
  assembly1: string;
  assembly2: string;
}) {
  return (
    <Card withBorder radius="sm" pos="relative">
      <LoadingOverlay visible={loading} />
      <Group justify="space-between" mb="md">
        <Text fw={700}>Synteny Blocks ({syntenyBlocks.length.toLocaleString()})</Text>
        <Badge>{assembly1} ↔ {assembly2}</Badge>
      </Group>
      <ScrollArea h={500}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Chr</Table.Th><Table.Th>Start</Table.Th><Table.Th>End</Table.Th>
              <Table.Th>Target Chr</Table.Th><Table.Th>Start</Table.Th><Table.Th>End</Table.Th>
              <Table.Th>Strand</Table.Th><Table.Th>Score</Table.Th><Table.Th>Identity</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {syntenyBlocks.slice(0, 200).map((b, index) => (
              <Table.Tr key={b.block_id ?? `${b.chr_1}-${b.start_1}-${index}`}>
                <Table.Td><Badge size="sm">{b.chr_1}</Badge></Table.Td>
                <Table.Td>{b.start_1.toLocaleString()}</Table.Td>
                <Table.Td>{b.end_1.toLocaleString()}</Table.Td>
                <Table.Td><Badge size="sm">{b.chr_2}</Badge></Table.Td>
                <Table.Td>{b.start_2.toLocaleString()}</Table.Td>
                <Table.Td>{b.end_2.toLocaleString()}</Table.Td>
                <Table.Td>{b.strand}</Table.Td>
                <Table.Td>{dash(b.score, 0)}</Table.Td>
                <Table.Td>{dash(b.identity, 1)}%</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Card>
  );
}

function DotplotPanel({ data, loading, assembly1, assembly2 }: {
  data: SyntenyBlock[];
  loading: boolean;
  assembly1: string;
  assembly2: string;
}) {
  if (loading) return <Paper withBorder p="xl" pos="relative" h={300}><LoadingOverlay visible /></Paper>;
  if (!data.length) return <Alert color="gray">No dotplot records are available for the selected filters.</Alert>;

  const chrLengths6a: Record<string, number> = {};
  const chrLengths7b: Record<string, number> = {};
  data.forEach((d) => {
    chrLengths6a[d.chr_1] = Math.max(chrLengths6a[d.chr_1] || 0, d.end_1);
    chrLengths7b[d.chr_2] = Math.max(chrLengths7b[d.chr_2] || 0, d.end_2);
  });

  const cumPos6a: Record<string, number> = {};
  const cumPos7b: Record<string, number> = {};
  let total6a = 0;
  let total7b = 0;
  CHROMOSOMES.forEach((chr) => {
    if (chrLengths6a[chr]) {
      cumPos6a[chr] = total6a;
      total6a += chrLengths6a[chr];
    }
    if (chrLengths7b[chr]) {
      cumPos7b[chr] = total7b;
      total7b += chrLengths7b[chr];
    }
  });

  if (!total6a || !total7b) return <Alert color="gray">Dotplot coordinates are incomplete for this selection.</Alert>;

  const width = 800;
  const height = 800;
  const margin = 50;
  const has6a = (chr: string) => Object.prototype.hasOwnProperty.call(cumPos6a, chr);
  const has7b = (chr: string) => Object.prototype.hasOwnProperty.call(cumPos7b, chr);
  const scaleX = (chr: string, pos: number) => margin + ((cumPos6a[chr] + pos) / total6a) * (width - 2 * margin);
  const scaleY = (chr: string, pos: number) => height - margin - ((cumPos7b[chr] + pos) / total7b) * (height - 2 * margin);

  return (
    <Card withBorder radius="sm">
      <Group justify="space-between" mb="md">
        <Text fw={700}>Dotplot ({data.length.toLocaleString()} blocks)</Text>
        <Group gap="xs"><Badge color="green">+ strand</Badge><Badge color="red">- strand</Badge></Group>
      </Group>
      <ScrollArea>
        <svg width={width} height={height} style={{ border: "1px solid #dee2e6", display: "block" }}>
          {CHROMOSOMES.map((chr) => has6a(chr) ? (
            <line key={`v-${chr}`} x1={scaleX(chr, 0)} y1={margin} x2={scaleX(chr, 0)} y2={height - margin} stroke="#e9ecef" />
          ) : null)}
          {CHROMOSOMES.map((chr) => has7b(chr) ? (
            <line key={`h-${chr}`} x1={margin} y1={scaleY(chr, 0)} x2={width - margin} y2={scaleY(chr, 0)} stroke="#e9ecef" />
          ) : null)}
          {data.map((d, i) => {
            if (!has6a(d.chr_1) || !has7b(d.chr_2)) return null;
            const x1 = scaleX(d.chr_1, d.start_1);
            const x2 = scaleX(d.chr_1, d.end_1);
            const y1 = scaleY(d.chr_2, d.start_2);
            const y2 = scaleY(d.chr_2, d.end_2);
            return (
              <rect key={`${d.chr_1}-${d.start_1}-${i}`} x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1) || 1} height={Math.abs(y2 - y1) || 1} fill={d.strand === "+" ? "#2f9e44" : "#e03131"} opacity={0.65} />
            );
          })}
          <text x={width / 2} y={height - 12} textAnchor="middle" fontSize={12}>{assembly1}</text>
          <text x={16} y={height / 2} textAnchor="middle" fontSize={12} transform={`rotate(-90, 16, ${height / 2})`}>{assembly2}</text>
        </svg>
      </ScrollArea>
    </Card>
  );
}

function OrthologPanel({ orthologs, total, page, loading, onPageChange }: {
  orthologs: GeneCoordinateMapping[];
  total: number;
  page: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card withBorder radius="sm" pos="relative">
      <LoadingOverlay visible={loading} />
      <Group justify="space-between" mb="md">
        <Text fw={700}>Gene Orthologs ({total.toLocaleString()})</Text>
        <Group>
          <Button size="xs" variant="light" disabled={page === 0} onClick={() => onPageChange(page - 1)}>Previous</Button>
          <Text size="sm">Page {Math.min(page + 1, totalPages)} of {totalPages}</Text>
          <Button size="xs" variant="light" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>Next</Button>
        </Group>
      </Group>
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
                <Table.Td><Badge size="sm">{o.gene_symbol || "-"}</Badge></Table.Td>
                <Table.Td>{o.chr_from}</Table.Td><Table.Td>{o.start_from.toLocaleString()}</Table.Td><Table.Td>{o.end_from.toLocaleString()}</Table.Td>
                <Table.Td>{o.chr_to}</Table.Td><Table.Td>{o.start_to.toLocaleString()}</Table.Td><Table.Td>{o.end_to.toLocaleString()}</Table.Td>
                <Table.Td><Badge size="xs" variant="light">{o.mapping_method}</Badge></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Card>
  );
}

function CoordinateMapperPanel({ assembly1, assembly2 }: { assembly1: string; assembly2: string }) {
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
      setResult(await mapCoordinates(geneId.trim(), assembly1, assembly2));
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
          <Select label="From" value={assembly1} data={[assembly1]} disabled w={120} />
          <Text mb={8}>→</Text>
          <Select label="To" value={assembly2} data={[assembly2]} disabled w={120} />
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
              <Text size="sm" c="dimmed">{assembly1} Coordinates</Text>
              <Text>Chr: {result.chr_from}</Text>
              <Text>Start: {result.start_from.toLocaleString()}</Text>
              <Text>End: {result.end_from.toLocaleString()}</Text>
              <Text>Strand: {result.strand_from}</Text>
            </div>
            <div>
              <Text size="sm" c="dimmed">{assembly2} Coordinates</Text>
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
