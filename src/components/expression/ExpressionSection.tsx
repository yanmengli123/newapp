import {
  Alert,
  Group,
  Paper,
  Stack,
} from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import { IconChartBar } from "@tabler/icons-react";
import type {
  GeneExpressionExpandResponse,
  GeneExpressionResponse,
  DatasetInfo,
} from "../../lib/geneApi";
import { getGeneExpression, getDatasets } from "../../lib/geneApi";
import ExpressionHeader from "./ExpressionHeader";
import ExpressionStatsRow from "./ExpressionStatsRow";
import ExpressionStageChart from "./ExpressionStageChart";
import ExpressionLineChart from "./ExpressionLineChart";
import ExpressionTable from "./ExpressionTable";
import ExpressionComparePanel from "./ExpressionComparePanel";
import ExpressionViolinPlot from "./ExpressionViolinPlot";
import ExpressionStackedArea from "./ExpressionStackedArea";
import ExpressionRadarChart from "./ExpressionRadarChart";
import ExpressionHeatmap from "./ExpressionHeatmap";
import ExpressionFoldChangeBar from "./ExpressionFoldChangeBar";
import ExpressionDendrogram from "./ExpressionDendrogram";
import ExpressionZScoreChart from "./ExpressionZScoreChart";
import ExpressionFoldChangeTrajectory from "./ExpressionFoldChangeTrajectory";
import ExpressionReplicateConsistency from "./ExpressionReplicateConsistency";
import { useChartCustomizer } from "./useChartCustomizer";
import ChartCustomizerDrawer from "./ChartCustomizerDrawer";
import { resolveChartStyle } from "./chartStyleResolver";

interface ExpressionSectionProps {
  geneId: string;
  initialExpression: GeneExpressionResponse | null;
}

export default function ExpressionSection({ geneId, initialExpression }: ExpressionSectionProps) {
  const [selectedDataset, setSelectedDataset] = useState<string>('day_deseq2_36');
  const [selectedMetric, setSelectedMetric] = useState<string>('normcount');
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentExpr, setCurrentExpr] = useState<GeneExpressionResponse | null>(null);
  const [expandData, setExpandData] = useState<GeneExpressionExpandResponse | null>(null);
  const [availableDatasets, setAvailableDatasets] = useState<DatasetInfo[]>([]);
  const [loadingExpression, setLoadingExpression] = useState(false);
  const [customizerOpened, setCustomizerOpened] = useState(false);

  // Chart customizer hook
  const customizerHook = useChartCustomizer();

  // Seed from page data on mount / geneId change
  useEffect(() => {
    if (initialExpression) {
      setCurrentExpr(initialExpression);
      setSelectedDataset(initialExpression.dataset || 'day_deseq2_36');
      setSelectedMetric(initialExpression.metric || 'normcount');
    } else {
      setCurrentExpr(null);
    }
    setExpandData(null);
    setIsExpanded(false);
  }, [geneId, initialExpression]);

  // Load available datasets
  useEffect(() => {
    getDatasets()
      .then(ds => setAvailableDatasets(ds.datasets || []))
      .catch(() => {/* ignore */});
  }, []);

  const fetchExpression = useCallback(async (ds: string, metric: string) => {
    setLoadingExpression(true);
    try {
      const result = await getGeneExpression(geneId, { dataset: ds, metric });
      if ("samples" in result) {
        setCurrentExpr(result as GeneExpressionResponse);
      }
    } catch (err) {
      console.error("Failed to fetch expression:", err);
    } finally {
      setLoadingExpression(false);
    }
  }, [geneId]);

  const fetchExpand = useCallback(async () => {
    setLoadingExpression(true);
    try {
      const result = await getGeneExpression(geneId, { expand: true });
      if ("cross_comparison" in result) {
        setExpandData(result as GeneExpressionExpandResponse);
        const expResult = result as GeneExpressionExpandResponse;
        if (expResult.datasets?.length) {
          const derived: DatasetInfo[] = expResult.datasets.map(d => ({
            dataset_id: 0,
            dataset_code: d.dataset_code,
            dataset_name: d.dataset_name,
            sample_scope: null,
            normalization_family: d.normalization_family,
            description: null,
            source_file: null,
            metrics: d.metrics.map(m => ({
              metric_code: m.metric_code,
              metric_name: m.metric_name,
              unit_desc: m.unit_desc,
              is_comparable: m.is_comparable,
              gene_count: m.gene_count,
            })),
          }));
          setAvailableDatasets(prev => prev.length === 0 ? derived : prev);
        }
      }
    } catch (err) {
      console.error("Failed to fetch expand expression:", err);
    } finally {
      setLoadingExpression(false);
    }
  }, [geneId]);

  const handleToggleExpand = useCallback(() => {
    setIsExpanded(prev => {
      if (!prev) fetchExpand();
      return !prev;
    });
  }, [fetchExpand]);

  const handleDatasetChange = useCallback((ds: string) => {
    setSelectedDataset(ds);
    const dsInfo = availableDatasets.find(d => d.dataset_code === ds);
    const defaultMetric = dsInfo?.metrics[0]?.metric_code || "normcount";
    setSelectedMetric(defaultMetric);
    fetchExpression(ds, defaultMetric);
  }, [availableDatasets, fetchExpression]);

  const handleMetricChange = useCallback((m: string) => {
    setSelectedMetric(m);
    fetchExpression(selectedDataset, m);
  }, [selectedDataset, fetchExpression]);

  const handleCompareSelect = useCallback((ds: string, m: string) => {
    setSelectedDataset(ds);
    setSelectedMetric(m);
    fetchExpression(ds, m);
  }, [fetchExpression]);

  const effectiveExpr = currentExpr ?? initialExpression;
  const effectiveSummary = effectiveExpr?.summary;
  const effectiveSamples = effectiveExpr?.samples ?? initialExpression?.samples ?? [];
  const effectiveStatus = effectiveExpr?.status ?? initialExpression?.status ?? "no_data";

  return (
    <Paper withBorder radius="xl" p="xl">
      <Stack gap="md">
        <ExpressionHeader
          selectedDataset={selectedDataset}
          selectedMetric={selectedMetric}
          onDatasetChange={handleDatasetChange}
          onMetricChange={handleMetricChange}
          availableDatasets={availableDatasets}
          loading={loadingExpression}
          isExpanded={isExpanded}
          onToggleExpand={handleToggleExpand}
          sampleCount={effectiveSamples.length}
          summary={effectiveSummary}
          onOpenCustomizer={() => setCustomizerOpened(true)}
        />

        {/* Expand All: Cross-Dataset Compare Panel */}
        {isExpanded && expandData ? (
          <ExpressionComparePanel
            expandData={expandData}
            onSelectDataset={handleCompareSelect}
            onLoadingChange={setLoadingExpression}
            selectedDataset={selectedDataset}
            selectedMetric={selectedMetric}
          />
        ) : (
          <>
            {/* No data */}
            {effectiveStatus === "no_data" && (
              <Alert color="gray" variant="light" title="No expression data" icon={<IconChartBar size={16} />}>
                This gene does not have expression profiling data in the current dataset.
              </Alert>
            )}

            {/* unavailable */}
            {effectiveStatus === 'unavailable' && (
              <Alert color="yellow" variant="light" title="Database unavailable" icon={<IconChartBar size={16} />}>
                Expression data is temporarily unavailable. Please try again later.
              </Alert>
            )}

            {/* Stats Row + Charts — only when available */}
            {effectiveStatus === "available" && effectiveSummary && (
              <>
                <ExpressionStatsRow
                  summary={effectiveSummary}
                  sampleCount={effectiveSamples.length}
                />

                <Group grow align="flex-start" gap="md">
                  <ExpressionStageChart
                    summary={effectiveSummary}
                    dataset={selectedDataset}
                    metric={selectedMetric}
                    styleConfig={resolveChartStyle("stage", customizerHook.config)}
                  />
                  <ExpressionLineChart
                    samples={effectiveSamples}
                    dataset={selectedDataset}
                    metric={selectedMetric}
                    styleConfig={resolveChartStyle("line", customizerHook.config)}
                  />
                </Group>

                <Group grow align="flex-start" gap="md">
                  <ExpressionViolinPlot
                    samples={effectiveSamples}
                    dataset={selectedDataset}
                    metric={selectedMetric}
                    styleConfig={resolveChartStyle("violin", customizerHook.config)}
                  />
                  <ExpressionStackedArea
                    summary={effectiveSummary}
                    dataset={selectedDataset}
                    metric={selectedMetric}
                    styleConfig={resolveChartStyle("area", customizerHook.config)}
                  />
                </Group>

                <Group grow align="flex-start" gap="md">
                  <ExpressionRadarChart
                    summary={effectiveSummary}
                    dataset={selectedDataset}
                    styleConfig={resolveChartStyle("radar", customizerHook.config)}
                  />
                  <ExpressionHeatmap
                    summary={effectiveSummary}
                    dataset={selectedDataset}
                    metric={selectedMetric}
                    styleConfig={resolveChartStyle("heatmap", customizerHook.config)}
                  />
                </Group>

                <Group grow align="flex-start" gap="md">
                  <ExpressionZScoreChart
                    samples={effectiveSamples}
                    dataset={selectedDataset}
                    styleConfig={resolveChartStyle("zscore", customizerHook.config)}
                  />
                  <ExpressionFoldChangeBar
                    summary={effectiveSummary}
                    styleConfig={resolveChartStyle("fcbar", customizerHook.config)}
                  />
                </Group>

                <Group grow align="flex-start" gap="md">
                  <ExpressionFoldChangeTrajectory
                    samples={effectiveSamples}
                    dataset={selectedDataset}
                    styleConfig={resolveChartStyle("fctraj", customizerHook.config)}
                  />
                  <ExpressionDendrogram
                    samples={effectiveSamples}
                    dataset={selectedDataset}
                    styleConfig={resolveChartStyle("dendrogram", customizerHook.config)}
                  />
                </Group>

                <ExpressionReplicateConsistency
                  samples={effectiveSamples}
                  dataset={selectedDataset}
                />

                <ExpressionTable
                  samples={effectiveSamples}
                  summary={effectiveSummary}
                  dataset={selectedDataset}
                />
              </>
            )}
          </>
        )}
      </Stack>

      <ChartCustomizerDrawer
        opened={customizerOpened}
        onClose={() => setCustomizerOpened(false)}
        hook={customizerHook}
      />
    </Paper>
  );
}