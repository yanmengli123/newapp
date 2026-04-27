/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import {
  IconPlayerPlay,
  IconAlertCircle,
  IconDownload,
  IconX,
  IconDna,
} from "@tabler/icons-react";
import {
  analyzeGOEnrichment,
  getExampleSets,
  type EnrichmentResponse,
  type GOEnrichmentResult,
  type ExampleGeneSet,
} from "../lib/goEnrichmentApi";
import GOEnrichmentBarChart from "../components/go_enrichment/GOEnrichmentBarChart";
import GOEnrichmentBarChartFullscreen from "../components/go_enrichment/GOEnrichmentBarChartFullscreen";
import GOEnrichmentTable from "../components/go_enrichment/GOEnrichmentTable";
import GOEnrichmentTermDrawer from "../components/go_enrichment/GOEnrichmentTermDrawer";
import { BarChartFilters, TableFilters } from "../components/go_enrichment/GOEnrichmentPageFilters";

type PageState = "idle" | "loading" | "success" | "error";

const CORRECTION_OPTIONS = [
  { value: "bh", label: "Benjamini-Hochberg (BH)" },
  { value: "by", label: "Yekutieli (BY)" },
  { value: "bonferroni", label: "Bonferroni" },
  { value: "none", label: "None" },
];

const NAMESPACE_OPTIONS = [
  { value: "all", label: "All GO Terms" },
  { value: "biological_process", label: "Biological Process" },
  { value: "cellular_component", label: "Cellular Component" },
  { value: "molecular_function", label: "Molecular Function" },
];

export default function GOEnrichmentPage() {
  const [geneInput, setGeneInput] = useState("");
  const [correction, setCorrection] = useState("bh");
  const [fdrCutoff, setFdrCutoff] = useState<number>(0.05);
  const [minOverlap, setMinOverlap] = useState<number>(2);
  const [namespace, setNamespace] = useState("all");

  const [pageState, setPageState] = useState<PageState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<EnrichmentResponse | null>(null);
  const [exampleSets, setExampleSets] = useState<ExampleGeneSet[]>([]);

  const [ontologyFilter, setOntologyFilter] = useState({ P: true, C: true, F: true });
  const [selectedTerm, setSelectedTerm] = useState<GOEnrichmentResult | null>(null);
  const [fullscreenChartOpened, setFullscreenChartOpened] = useState(false);

  // Load example sets on mount
  useEffect(() => {
    getExampleSets().then((res) => {
      setExampleSets(res.sets);
    }).catch(() => {});
  }, []);

  const handleRun = useCallback(async () => {
    const geneList = geneInput.split(/[\n,;\s]+/).map((g) => g.trim()).filter(Boolean);
    if (geneList.length === 0) {
      setErrorMsg("Please enter at least one gene ID.");
      setPageState("error");
      return;
    }

    setPageState("loading");
    setErrorMsg(null);

    try {
      const res = await analyzeGOEnrichment({
        gene_list: geneList,
        correction,
        fdr_cutoff: fdrCutoff,
        min_overlap: minOverlap,
        namespace,
        annotation_mode: "direct",
      });
      setResult(res);
      setPageState("success");
    } catch (err: any) {
      setErrorMsg(err.message ?? "Analysis failed. Please try again.");
      setPageState("error");
    }
  }, [geneInput, correction, fdrCutoff, minOverlap, namespace]);

  const handleClear = () => {
    setGeneInput("");
    setResult(null);
    setPageState("idle");
  };

  const handleFillExample = (genes: string[]) => {
    setGeneInput(genes.join("\n"));
  };

  const filteredResults = result?.results.filter((term) => {
    if (!term.significant) return false;
    const code = term.ontology;
    return ontologyFilter[code as "P" | "C" | "F"];
  }) ?? [];

  const handleDownloadCSV = () => {
    if (!result) return;
    const header = ["GO ID", "Ontology", "Description", "Gene Ratio", "BG Ratio", "Query", "BG", "p-value", "FDR", "Significant", "Hit Genes", "Hit NCBI IDs", "Hit Symbols"];
    const rows = filteredResults.map((t) => [
      t.go_id, t.ontology, t.term_name, t.gene_ratio, t.background_ratio,
      t.query_count, t.background_count, t.p_value, t.fdr,
      t.significant ? "yes" : "no",
      t.hit_genes.join(";"), t.hit_ncbi_ids.join(";"), t.hit_symbols.join(";"),
    ]);
    const csv = [header.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n");
    const blob = new Blob([csv], { type: "text/tab-separated-values" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `go_enrichment_${Date.now()}.tsv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAnnotated = () => {
    if (!result) return;
    const lines = filteredResults.flatMap((t) => t.hit_genes);
    const unique = [...new Set(lines)];
    const blob = new Blob([unique.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `annotated_genes_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Stack gap="lg">
      {/* Header */}
      <Box>
        <Title order={2}>GO Enrichment Analysis (SEA)</Title>
        <Text c="dimmed" size="sm" mt={4}>
          Singular Enrichment Analysis for Gallus gallus GRCg6a genes
        </Text>
        <Text c="dimmed" size="xs" mt={2}>
          Uses the same Gallus_gallus/agriGO-derived local GO annotations as the single-gene GO page.
          Background: GRCg6a genes with NCBI Gene ID and local GO annotations.
        </Text>
        <Text c="dimmed" size="xs">
          This analysis uses the local GO annotations mapped to the NCBI GRCg6a gene set,
          not the full agriGO background. Annotation mode: direct GO terms only (no GO DAG propagation).
          FDR correction is applied across all terms hit by query genes (min_overlap filter applied after).
        </Text>
      </Box>

      {/* Input Panel */}
      <Paper withBorder radius="lg" p="lg">
        <Stack gap="md">
          {/* Gene Input */}
          <Box>
            <Text fw={600} mb={4}>Input Gene List</Text>
            <Textarea
              placeholder={`Enter gene IDs, one per line:\n418223\nA4GALT\ngene-STOX2\nCD44`}
              value={geneInput}
              onChange={(e) => setGeneInput(e.currentTarget.value)}
              minRows={6}
              maxRows={10}
              autosize
              styles={{ input: { fontFamily: "monospace", fontSize: 13 } }}
            />
          </Box>

          {/* Example Gene Sets */}
          <Group gap="xs" align="center">
            <Text size="sm" c="dimmed">Example gene sets:</Text>
            {exampleSets.map((set) => (
              <Badge
                key={set.name}
                size="sm"
                variant="light"
                color="cyan"
                style={{ cursor: "pointer" }}
                onClick={() => handleFillExample(set.genes)}
              >
                {set.name}
              </Badge>
            ))}
          </Group>

          {/* Parameters */}
          <SimpleGrid cols={{ base: 2, xs: 3, sm: 6 }} spacing="xs">
            <Select
              label="Ontology"
              data={NAMESPACE_OPTIONS}
              value={namespace}
              onChange={(v) => v && setNamespace(v)}
              size="sm"
            />
            <Select
              label="Correction"
              data={CORRECTION_OPTIONS}
              value={correction}
              onChange={(v) => v && setCorrection(v)}
              size="sm"
            />
            <NumberInput
              label="FDR Cutoff"
              value={fdrCutoff}
              onChange={(v) => setFdrCutoff(Number(v) || 0.05)}
              min={0.001}
              max={0.5}
              step={0.01}
              decimalScale={3}
              size="sm"
            />
            <NumberInput
              label="Min Overlap"
              value={minOverlap}
              onChange={(v) => setMinOverlap(Number(v) || 2)}
              min={1}
              max={100}
              size="sm"
            />
          </SimpleGrid>

          {/* Action Buttons */}
          <Group>
            <Button
              leftSection={<IconPlayerPlay size={16} />}
              onClick={() => { void handleRun(); }}
              loading={pageState === "loading"}
              size="md"
            >
              Run Analysis
            </Button>
            <Button
              variant="light"
              leftSection={<IconX size={16} />}
              onClick={handleClear}
              size="md"
            >
              Clear
            </Button>
          </Group>
        </Stack>
      </Paper>

      {/* Idle State */}
      {pageState === "idle" && (
        <Paper withBorder radius="lg" p="xl">
          <Stack align="center" gap="sm" py="xl">
            <IconDna size={40} color="#adb5bd" />
            <Text c="dimmed" ta="center">
              Enter gene IDs and click <Text span fw={600} c="dark">Run Analysis</Text> to perform GO enrichment.
            </Text>
          </Stack>
        </Paper>
      )}

      {/* Loading State */}
      {pageState === "loading" && (
        <Paper withBorder radius="lg" p="xl">
          <Stack gap="sm">
            <Skeleton height={24} width={200} />
            <Skeleton height={300} />
          </Stack>
        </Paper>
      )}

      {/* Error State */}
      {pageState === "error" && errorMsg && (
        <Alert color="red" variant="light" title="Error" icon={<IconAlertCircle size={16} />}>
          {errorMsg}
        </Alert>
      )}

      {/* Success State */}
      {pageState === "success" && result && (
        <Stack gap="lg">
          {/* Summary Cards */}
          <SimpleGrid cols={{ base: 2, xs: 3, sm: 6 }}>
            <Card withBorder radius="md" p="sm" ta="center">
              <Text fw={700} fz={24}>{result.query_count}</Text>
              <Text size="xs" c="dimmed">Input IDs</Text>
            </Card>
            <Card withBorder radius="md" p="sm" ta="center">
              <Text fw={700} fz={24}>{result.mapped_count}</Text>
              <Text size="xs" c="dimmed">Mapped Genes</Text>
            </Card>
            <Card withBorder radius="md" p="sm" ta="center">
              <Text fw={700} fz={24}>{result.annotated_count}</Text>
              <Text size="xs" c="dimmed">Annotated</Text>
            </Card>
            <Card withBorder radius="md" p="sm" ta="center">
              <Text fw={700} fz={24}>{namespace === "all" ? "See below" : result.background_count.toLocaleString()}</Text>
              <Text size="xs" c="dimmed">
                {namespace === "all" ? "Background (per ontology)" : "Background"}
              </Text>
            </Card>
            <Card withBorder radius="md" p="sm" ta="center">
              <Text fw={700} fz={24}>{result.tested_term_count}</Text>
              <Text size="xs" c="dimmed">Tested Terms</Text>
            </Card>
            <Card withBorder radius="md" p="sm" ta="center">
              <Text fw={700} fz={24} c="red">{result.significant_count}</Text>
              <Text size="xs" c="dimmed">Significant</Text>
            </Card>
          </SimpleGrid>

          {/* Ontology Stats (when namespace=all) */}
          {namespace === "all" && result.ontology_stats && (
            <Paper withBorder radius="md" p="sm">
              <Group gap="lg">
                {Object.entries(result.ontology_stats).map(([code, stats]) => (
                  <Group key={code} gap="xs">
                    <Badge color={code === "P" ? "blue" : code === "C" ? "orange" : "green"}>{code}</Badge>
                    <Text size="xs">BG: {stats.background_count.toLocaleString()} | Tested: {stats.tested_term_count} | Sig: {stats.significant_count}</Text>
                  </Group>
                ))}
              </Group>
            </Paper>
          )}

          {/* Mapping Report */}
          {result.mapping && result.mapping.length > 0 && (
            <Paper withBorder radius="lg" p="lg">
              <Title order={4} mb="sm">Mapping Report</Title>
              <Table striped withTableBorder withColumnBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Input ID</Table.Th>
                    <Table.Th>Resolved Gene ID</Table.Th>
                    <Table.Th>NCBI ID</Table.Th>
                    <Table.Th>Symbol</Table.Th>
                    <Table.Th>Status</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {result.mapping.map((m, i) => (
                    <Table.Tr key={`${m.input_id}-${i}`}>
                      <Table.Td><Text size="sm" style={{ fontFamily: "monospace" }}>{m.input_id}</Text></Table.Td>
                      <Table.Td><Text size="sm" style={{ fontFamily: "monospace" }}>{m.resolved_gene_id ?? "-"}</Text></Table.Td>
                      <Table.Td><Text size="sm">{m.ncbi_gene_id ?? "-"}</Text></Table.Td>
                      <Table.Td><Text size="sm">{m.gene_symbol ?? "-"}</Text></Table.Td>
                      <Table.Td>
                        <Badge
                          color={m.status === "mapped" ? "green" : m.status === "no_go_annotation" ? "yellow" : "red"}
                          size="sm"
                        >
                          {m.status}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          )}

          {/* Bar Chart */}
          <Paper withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Group justify="space-between">
                <Title order={4}>GO Enrichment Bar Chart</Title>
                <BarChartFilters filter={ontologyFilter} onChange={setOntologyFilter} />
              </Group>
              <GOEnrichmentBarChart data={result.bar_chart_data} filtered={ontologyFilter} onExpand={() => setFullscreenChartOpened(true)} />
            </Stack>
          </Paper>

          {/* Results Table */}
          <Paper withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Group justify="space-between">
                <Title order={4}>Significant GO Terms ({filteredResults.length})</Title>
                <Group gap="xs">
                  <Button size="xs" variant="light" leftSection={<IconDownload size={14} />} onClick={handleDownloadAnnotated}>
                    Download Hit Genes
                  </Button>
                  <Button size="xs" variant="light" leftSection={<IconDownload size={14} />} onClick={handleDownloadCSV}>
                    Download Significant Terms CSV
                  </Button>
                </Group>
              </Group>

              {/* Ontology Filter */}
              <TableFilters filter={ontologyFilter} onChange={setOntologyFilter} />

              <Divider />

              <GOEnrichmentTable terms={filteredResults} onRowClick={setSelectedTerm} />
            </Stack>
          </Paper>
        </Stack>
      )}

      {/* Term Drawer */}
      <GOEnrichmentTermDrawer term={selectedTerm} onClose={() => setSelectedTerm(null)} />

      {/* Bar Chart Fullscreen Modal */}
      {fullscreenChartOpened && result && (
        <GOEnrichmentBarChartFullscreen
          data={result.bar_chart_data}
          filtered={ontologyFilter}
          onClose={() => setFullscreenChartOpened(false)}
        />
      )}
    </Stack>
  );
}