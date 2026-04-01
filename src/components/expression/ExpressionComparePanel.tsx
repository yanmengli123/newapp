import {
  Box,
  Group,
  Paper,
  Stack,
  Tabs,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { useState, useEffect } from "react";
import { IconChartBar, IconTrendingUp } from "@tabler/icons-react";
import type { GeneExpressionExpandResponse } from "../../lib/geneApi";
import ExpressionStageChart from "./ExpressionStageChart";
import ExpressionLineChart from "./ExpressionLineChart";
import ExpressionStatsRow from "./ExpressionStatsRow";

interface ExpressionComparePanelProps {
  expandData: GeneExpressionExpandResponse;
  onSelectDataset: (ds: string, m: string) => void;
  onLoadingChange: (loading: boolean) => void;
  // Parent sync props — panel syncs its local state to these
  selectedDataset?: string;
  selectedMetric?: string;
}

// Normalize sex string to canonical form (handles both "Male"/"Female" and "M"/"F")
function normalizeSex(s: string | null | undefined): "Male" | "Female" | null {
  if (s === "Male" || s === "M" || s === "m") return "Male";
  if (s === "Female" || s === "F" || s === "f") return "Female";
  return null;
}

export default function ExpressionComparePanel({
  expandData,
  onSelectDataset,
  selectedDataset,
  selectedMetric,
}: ExpressionComparePanelProps) {
  const { cross_comparison, datasets } = expandData;

  // Initialize from parent sync props if provided, otherwise from first dataset
  const [activeTab, setActiveTab] = useState<string>(
    selectedDataset ?? datasets[0]?.dataset_code ?? ""
  );
  const [localMetric, setLocalMetric] = useState<string>(
    selectedMetric ?? datasets[0]?.metrics[0]?.metric_code ?? "normcount"
  );

  // Keep activeTab in sync when parent selectedDataset changes
  useEffect(() => {
    if (selectedDataset && selectedDataset !== activeTab) {
      setActiveTab(selectedDataset);
      // Also sync metric to parent's selection (default to first metric of new dataset)
      const ds = datasets.find((d) => d.dataset_code === selectedDataset);
      const newMetric = selectedMetric ?? ds?.metrics[0]?.metric_code ?? "normcount";
      if (newMetric !== localMetric) {
        setLocalMetric(newMetric);
      }
    }
  }, [selectedDataset, selectedMetric, activeTab, localMetric, datasets]);

  // Keep localMetric in sync when parent selectedMetric changes (same dataset)
  useEffect(() => {
    if (selectedMetric && selectedMetric !== localMetric) {
      setLocalMetric(selectedMetric);
    }
  }, [selectedMetric, localMetric]);

  // Current dataset and metric
  const currentDs = datasets.find((d) => d.dataset_code === activeTab) ?? datasets[0];
  const currentMetricObj = currentDs?.metrics.find((m) => m.metric_code === localMetric)
    ?? currentDs?.metrics[0];

  if (!currentDs) return null;

  return (
    <Paper withBorder p="md" radius="md" bg="gray.0">
      <Stack gap="sm">
        {/* Header */}
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <ThemeIcon variant="light" color="violet" size="sm" radius="md">
              <IconTrendingUp size={12} />
            </ThemeIcon>
            <Text size="sm" fw={600}>
              Cross-Dataset Comparison
            </Text>
            <Text size="xs" c="dimmed">
              {cross_comparison.available_datasets.length} datasets,{" "}
              {cross_comparison.trend_note || ""}
            </Text>
          </Group>
          {cross_comparison.opposite_trends && (
            <Text size="xs" c="orange">
              ⚠ Opposite trends detected
            </Text>
          )}
        </Group>

        {/* Dataset Tabs */}
        <Tabs
          value={activeTab}
          onChange={(v) => {
            if (!v) return;
            setActiveTab(v);
            const ds = datasets.find((d) => d.dataset_code === v);
            if (ds) {
              const newMetric = ds.metrics[0]?.metric_code ?? "normcount";
              setLocalMetric(newMetric);
              onSelectDataset(v, newMetric);
            }
          }}
          variant="pills"
          radius="md"
        >
          <Tabs.List>
            {datasets.map((ds) => (
              <Tabs.Tab
                key={ds.dataset_code}
                value={ds.dataset_code}
                leftSection={
                  ds.metrics.length > 1 ? (
                    <IconChartBar size={10} />
                  ) : undefined
                }
              >
                <Group gap={4}>
                  <Text size="xs">{ds.dataset_name}</Text>
                  <Text size="xs" c="dimmed">({ds.sample_count} samples)</Text>
                </Group>
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>

        {/* Metric Selector (only if >1 metric in current dataset) */}
        {currentDs.metrics.length > 1 && (
          <Group gap="xs">
            <Text size="xs" c="dimmed">Metric:</Text>
            {currentDs.metrics.map((m) => (
              <Box
                key={m.metric_code}
                style={{ cursor: "pointer" }}
                onClick={() => {
                  setLocalMetric(m.metric_code);
                  onSelectDataset(activeTab, m.metric_code);
                }}
              >
                <Text
                  size="xs"
                  fw={m.metric_code === localMetric ? 700 : 400}
                  c={m.metric_code === localMetric ? "violet" : "dimmed"}
                >
                  {m.metric_name}
                </Text>
              </Box>
            ))}
          </Group>
        )}

        {/* Summary + Charts */}
        {currentMetricObj && currentMetricObj.summary && currentMetricObj.samples && (
          <Stack gap="xs">
            <ExpressionStatsRow
              summary={currentMetricObj.summary}
              sampleCount={currentDs.sample_count}
            />
            <Group grow align="flex-start" gap="xs">
              <ExpressionStageChart
                summary={currentMetricObj.summary}
                dataset={currentDs.dataset_code}
                metric={currentMetricObj.metric_code}
              />
            </Group>
            <ExpressionLineChart
              samples={currentMetricObj.samples}
              dataset={currentDs.dataset_code}
              metric={currentMetricObj.metric_code}
            />
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
