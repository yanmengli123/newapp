/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconPlayerPlay, IconChartBar, IconAlertCircle } from "@tabler/icons-react";
import { getDatasets, getGeneExpression } from "../lib/geneApi";
import type { DatasetInfo, GeneExpressionResponse } from "../lib/geneApi";
import type { ChartType } from "../components/expression/chartCustomizer.types";
import { CHART_TYPE_LABELS } from "../components/expression/chartCustomizer.defaults";
import { useChartCustomizer } from "../components/expression/useChartCustomizer";
import { resolveChartStyle } from "../components/expression/chartStyleResolver";
import ChartCustomizerDrawer from "../components/expression/ChartCustomizerDrawer";
import ChartFullscreenModal from "../components/expression/ChartFullscreenModal";
import type { FullscreenState } from "../components/expression/chartFullscreen.types";
import ExpressionStageChart from "../components/expression/ExpressionStageChart";
import ExpressionLineChart from "../components/expression/ExpressionLineChart";
import ExpressionViolinPlot from "../components/expression/ExpressionViolinPlot";
import ExpressionStackedArea from "../components/expression/ExpressionStackedArea";
import ExpressionRadarChart from "../components/expression/ExpressionRadarChart";
import ExpressionHeatmap from "../components/expression/ExpressionHeatmap";
import ExpressionZScoreChart from "../components/expression/ExpressionZScoreChart";
import ExpressionFoldChangeBar from "../components/expression/ExpressionFoldChangeBar";
import ExpressionFoldChangeTrajectory from "../components/expression/ExpressionFoldChangeTrajectory";
import ExpressionDendrogram from "../components/expression/ExpressionDendrogram";

const EXAMPLE_GENES = [
  "gene-A4GALT",
  "gene-LOC112532827",
  "gene-OLAH",
  "gene-STOX2",
  "gene-CD44",
];

const CHART_TYPE_OPTIONS = Object.entries(CHART_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

type PageState = "idle" | "loading" | "success" | "error";

export default function PictureMakerPage() {
  const [geneQuery, setGeneQuery] = useState("");
  const [selectedChartType, setSelectedChartType] = useState<ChartType>("stage");
  const [selectedDataset, setSelectedDataset] = useState<string>("day_deseq2_36");
  const [selectedMetric, setSelectedMetric] = useState<string>("normcount");
  const [availableDatasets, setAvailableDatasets] = useState<DatasetInfo[]>([]);
  const [expressionData, setExpressionData] = useState<GeneExpressionResponse | null>(null);
  const [submittedGene, setSubmittedGene] = useState("");
  const [pageState, setPageState] = useState<PageState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [customizerOpened, setCustomizerOpened] = useState(false);
  const [fullscreenState, setFullscreenState] = useState<FullscreenState | null>(null);

  const customizerHook = useChartCustomizer();

  // Load available datasets on mount
  useEffect(() => {
    getDatasets()
      .then((res) => {
        setAvailableDatasets(res.datasets || []);
        if (res.datasets?.length > 0) {
          const first = res.datasets[0];
          setSelectedDataset(first.dataset_code);
          if (first.metrics?.length > 0) {
            setSelectedMetric(first.metrics[0].metric_code);
          }
        }
      })
      .catch(() => {
        setAvailableDatasets([]);
      });
  }, []);

  const handleDatasetChange = useCallback(
    (ds: string) => {
      setSelectedDataset(ds);
      const dsInfo = availableDatasets.find((d) => d.dataset_code === ds);
      if (dsInfo?.metrics?.length) {
        setSelectedMetric(dsInfo.metrics[0].metric_code);
      }
    },
    [availableDatasets]
  );

  const handleRun = useCallback(async (gene?: string) => {
    const targetGene = (gene ?? geneQuery).trim();
    if (!targetGene) {
      setErrorMsg("Please enter a gene ID or symbol.");
      setPageState("error");
      return;
    }
    if (!selectedDataset || !selectedMetric) {
      setErrorMsg("Please select a dataset and metric.");
      setPageState("error");
      return;
    }

    setPageState("loading");
    setErrorMsg(null);
    setExpressionData(null);

    try {
      const result = await getGeneExpression(targetGene, {
        dataset: selectedDataset,
        metric: selectedMetric,
      });

      if ("status" in result) {
        if (result.status === "no_data") {
          setErrorMsg(
            "This gene does not have expression data in the selected dataset."
          );
          setPageState("error");
        } else if (result.status === "unavailable") {
          setErrorMsg("Expression service is temporarily unavailable.");
          setPageState("error");
        } else {
          setExpressionData(result as GeneExpressionResponse);
          setSubmittedGene(targetGene);
          setPageState("success");
        }
      }
    } catch {
      setErrorMsg("Gene not found or expression data unavailable for the selected dataset.");
      setPageState("error");
    }
  }, [geneQuery, selectedDataset, selectedMetric, availableDatasets]);

  const metricOptions = (() => {
    const ds = availableDatasets.find((d) => d.dataset_code === selectedDataset);
    if (!ds?.metrics) return [];
    return ds.metrics.map((m) => ({ value: m.metric_code, label: m.metric_name }));
  })();

  const datasetOptions = availableDatasets.map((d) => ({
    value: d.dataset_code,
    label: d.dataset_name,
  }));

  const chartHeight = 420;
  const styleConfig = resolveChartStyle(
    selectedChartType as ChartType,
    customizerHook.config
  );

  const chartTitle =
    CHART_TYPE_LABELS[selectedChartType] ?? selectedChartType;

  const commonChartProps = {
    renderMode: "card" as const,
    styleConfig,
  };

  const renderChart = () => {
    if (!expressionData?.summary) return null;

    const summary = expressionData.summary;
    const samples = expressionData.samples ?? [];

    switch (selectedChartType) {
      case "stage":
        return (
          <ExpressionStageChart
            summary={summary}
            dataset={selectedDataset}
            metric={selectedMetric}
            {...commonChartProps}
          />
        );
      case "line":
        return (
          <ExpressionLineChart
            samples={samples}
            dataset={selectedDataset}
            metric={selectedMetric}
            {...commonChartProps}
          />
        );
      case "violin":
        return (
          <ExpressionViolinPlot
            samples={samples}
            dataset={selectedDataset}
            metric={selectedMetric}
            {...commonChartProps}
          />
        );
      case "area":
        return (
          <ExpressionStackedArea
            summary={summary}
            dataset={selectedDataset}
            metric={selectedMetric}
            {...commonChartProps}
          />
        );
      case "radar":
        return (
          <ExpressionRadarChart
            summary={summary}
            dataset={selectedDataset}
            {...commonChartProps}
          />
        );
      case "heatmap":
        return (
          <ExpressionHeatmap
            summary={summary}
            dataset={selectedDataset}
            metric={selectedMetric}
            {...commonChartProps}
          />
        );
      case "zscore":
        return (
          <ExpressionZScoreChart
            samples={samples}
            dataset={selectedDataset}
            {...commonChartProps}
          />
        );
      case "fcbar":
        return (
          <ExpressionFoldChangeBar
            summary={summary}
            {...commonChartProps}
          />
        );
      case "fctraj":
        return (
          <ExpressionFoldChangeTrajectory
            samples={samples}
            dataset={selectedDataset}
            {...commonChartProps}
          />
        );
      case "dendrogram":
        return (
          <ExpressionDendrogram
            samples={samples}
            dataset={selectedDataset}
            {...commonChartProps}
          />
        );
      default:
        return (
          <Text c="dimmed" ta="center" py="xl">
            Unknown chart type.
          </Text>
        );
    }
  };

  return (
    <Stack gap="lg">
      {/* Header */}
      <Box>
        <Title order={2}>Picture Maker</Title>
        <Text c="dimmed" size="sm" mt={4}>
          Generate a single expression chart for a selected gene, dataset, and
          metric. Best for figure export and customized single-chart viewing.
        </Text>
      </Box>

      {/* Control Panel */}
      <Paper withBorder radius="lg" p="lg">
        <Stack gap="md">
          {/* Row 1: Gene + Run */}
          <Group grow align="flex-end">
            <TextInput
              label="Gene Search"
              placeholder="Enter gene ID or symbol, e.g. gene-LOC112532827"
              value={geneQuery}
              onChange={(e) => setGeneQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRun();
              }}
description="Supports gene ID, symbol, or NCBI gene ID"
              styles={{ input: { fontFamily: "monospace" } }}
            />
            <Button
              leftSection={<IconPlayerPlay size={16} />}
              onClick={() => { void handleRun(); }}
              loading={pageState === "loading"}
              size="md"
            >
              Run
            </Button>
          </Group>

          {/* Example genes */}
          <Group gap="xs" align="center">
            <Text size="xs" c="dimmed">
              Try an example:
            </Text>
            <Group gap={6}>
              {EXAMPLE_GENES.map((gene) => (
                <Badge
                  key={gene}
                  size="sm"
                  variant="light"
                  color="blue"
                  style={{ cursor: "pointer" }}
                  onClick={() => { setGeneQuery(gene); void handleRun(gene); }}
                >
                  {gene}
                </Badge>
              ))}
            </Group>
          </Group>

          {/* Row 2: Chart Type + Dataset + Metric */}
          <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="md">
            <Select
              label="Chart Type"
              data={CHART_TYPE_OPTIONS}
              value={selectedChartType}
              onChange={(v) => v && setSelectedChartType(v as ChartType)}
            />
            <Select
              label="Dataset"
              data={datasetOptions}
              value={selectedDataset}
              onChange={(v) => v && handleDatasetChange(v)}
              disabled={availableDatasets.length === 0}
            />
            <Select
              label="Metric"
              data={metricOptions}
              value={selectedMetric}
              onChange={(v) => v && setSelectedMetric(v)}
              disabled={metricOptions.length === 0}
            />
          </SimpleGrid>
        </Stack>
      </Paper>

      {/* Result Panel */}
      {pageState === "idle" && (
        <Paper withBorder radius="lg" p="xl">
          <Stack align="center" gap="sm" py="xl">
            <IconChartBar size={40} color="#adb5bd" />
            <Text c="dimmed" ta="center">
              Select a gene, dataset, metric, and chart type, then click{" "}
              <Text span fw={600} c="dark">
                Run
              </Text>{" "}
              to generate a chart.
            </Text>
          </Stack>
        </Paper>
      )}

      {pageState === "loading" && (
        <Paper withBorder radius="lg" p="xl">
          <Stack gap="sm">
            <Skeleton height={24} width={200} />
            <Skeleton height={chartHeight} />
          </Stack>
        </Paper>
      )}

      {pageState === "error" && errorMsg && (
        <Alert
          color="red"
          variant="light"
          title="Error"
          icon={<IconAlertCircle size={16} />}
        >
          {errorMsg}
        </Alert>
      )}

      {pageState === "success" && expressionData && (
        <Paper withBorder radius="lg" p="lg">
          <Stack gap="md">
            {/* Chart header */}
            <Group justify="space-between" align="flex-start">
              <Box>
                <Group gap="xs">
                  <Title order={4}>{chartTitle}</Title>
                  <Badge size="sm" variant="light" color="blue">
                    {submittedGene}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed" mt={2}>
                  Dataset:{" "}
                  {availableDatasets.find((d) => d.dataset_code === selectedDataset)
                    ?.dataset_name ?? selectedDataset}{" "}
                  · Metric: {selectedMetric} · Samples:{" "}
                  {expressionData.samples?.length ?? 0}
                </Text>
              </Box>

              <Group gap="xs">
                <Button
                  variant="light"
                  size="xs"
                  onClick={() => setCustomizerOpened(true)}
                >
                  Customize
                </Button>
                <Button
                  variant="light"
                  size="xs"
                  onClick={() =>
                    setFullscreenState({ chartType: selectedChartType as any })
                  }
                >
                  Fullscreen
                </Button>
              </Group>
            </Group>

            <Divider />

            {/* Chart */}
            <Box style={{ minHeight: chartHeight }}>{renderChart()}</Box>
          </Stack>
        </Paper>
      )}

      {/* Modals */}
      <ChartCustomizerDrawer
        opened={customizerOpened}
        onClose={() => setCustomizerOpened(false)}
        hook={customizerHook}
      />

      <ChartFullscreenModal
        fullscreenState={fullscreenState}
        onClose={() => setFullscreenState(null)}
        summary={expressionData?.summary}
        samples={expressionData?.samples ?? []}
        dataset={selectedDataset}
        metric={selectedMetric}
        resolveStyle={(ct) =>
          resolveChartStyle(ct as ChartType, customizerHook.config)
        }
      />
    </Stack>
  );
}
