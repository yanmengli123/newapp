import {
  Box,
  Group,
  Paper,
  Stack,
  Tabs,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { useState } from "react";
import { IconChartBar, IconTrendingUp } from "@tabler/icons-react";
import type { GeneExpressionExpandResponse } from "../../lib/geneApi";
import ExpressionStageChart from "./ExpressionStageChart";
import ExpressionLineChart from "./ExpressionLineChart";
import ExpressionStatsRow from "./ExpressionStatsRow";

interface ExpressionComparePanelProps {
  expandData: GeneExpressionExpandResponse;
  onSelectDataset: (ds: string, m: string) => void;
  onLoadingChange: (loading: boolean) => void;
}

export default function ExpressionComparePanel({
  expandData,
  onSelectDataset,
}: ExpressionComparePanelProps) {
  const { cross_comparison, datasets } = expandData;

  const [activeTab, setActiveTab] = useState<string>(datasets[0]?.dataset_code ?? "");

  // 当前选中数据集
  const currentDs = datasets.find((d) => d.dataset_code === activeTab) ?? datasets[0];
  const currentMetric = currentDs?.metrics[0];

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
              onSelectDataset(v, ds.metrics[0]?.metric_code ?? "normcount");
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
                  <Text size="xs">{ds.dataset_code}</Text>
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
                onClick={() => onSelectDataset(activeTab, m.metric_code)}
              >
                <Text
                  size="xs"
                  fw={m.metric_code === currentMetric?.metric_code ? 700 : 400}
                  c={m.metric_code === currentMetric?.metric_code ? "violet" : "dimmed"}
                >
                  {m.metric_name}
                </Text>
              </Box>
            ))}
          </Group>
        )}

        {/* Summary + Charts */}
        {currentMetric && currentMetric.summary && currentMetric.samples && (
          <Stack gap="xs">
            <ExpressionStatsRow
              summary={currentMetric.summary}
              sampleCount={currentDs.sample_count}
            />
            <Group grow align="flex-start" gap="xs">
              <ExpressionStageChart
                summary={currentMetric.summary}
                dataset={currentDs.dataset_code}
                metric={currentMetric.metric_code}
              />
            </Group>
            <ExpressionLineChart
              samples={currentMetric.samples}
              dataset={currentDs.dataset_code}
              metric={currentMetric.metric_code}
            />
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
