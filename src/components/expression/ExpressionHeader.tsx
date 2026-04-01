import { Badge, Box, Group, Loader, Select, Stack, Text } from "@mantine/core";
import { IconChartBar, IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import type { DatasetInfo, GeneExpressionResponse } from "../../lib/geneApi";

interface ExpressionHeaderProps {
  // 当前选中
  selectedDataset: string;
  selectedMetric: string;
  onDatasetChange: (ds: string) => void;
  onMetricChange: (m: string) => void;
  // 可用选项（来自 expand 响应）
  availableDatasets: DatasetInfo[];
  loading: boolean;
  // expand 模式
  isExpanded: boolean;
  onToggleExpand: () => void;
  // 元信息
  sampleCount: number;
  summary: GeneExpressionResponse["summary"];
}

const DATASET_LABELS: Record<string, string> = {
  day_deseq2_36: "DESeq2 NC — 36 发育阶段",
  raw_ballgown_36: "Ballgown TPM/FPKM — 36 发育阶段",
  esc_srr_23: "ESC SRR Runs — 23 个 SRA Runs",
};

const METRIC_LABELS: Record<string, string> = {
  normcount: "DESeq2 Normalized Count",
  tpm: "TPM",
  fpkm: "FPKM",
  raw_count: "Raw Count",
};

export default function ExpressionHeader({
  selectedDataset,
  selectedMetric,
  onDatasetChange,
  onMetricChange,
  availableDatasets,
  loading,
  isExpanded,
  onToggleExpand,
  sampleCount,
  summary,
}: ExpressionHeaderProps) {
  const datasetOptions = availableDatasets.map((d) => ({
    value: d.dataset_code,
    label: d.dataset_name || d.dataset_code,
  }));

  // 从 availableDatasets 提取当前数据集的指标
  const currentDataset = availableDatasets.find((d) => d.dataset_code === selectedDataset);
  const metricOptions =
    currentDataset?.metrics.map((m) => ({
      value: m.metric_code,
      label: `${m.metric_name}${m.unit_desc ? ` (${m.unit_desc})` : ""}`,
    })) ||
    (selectedMetric
      ? [{ value: selectedMetric, label: METRIC_LABELS[selectedMetric] || selectedMetric }]
      : []);

  return (
    <Stack gap="sm">
      {/* 第一行：标题 + 控制按钮 */}
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <IconChartBar size={20} color="var(--mantine-color-violet-6)" />
          <Text fw={600} size="sm">
            Expression
          </Text>
          {loading ? (
            <Loader size="xs" />
          ) : (
            <>
              <Badge variant="light" color="violet" size="xs">
                {sampleCount} samples
              </Badge>
              {summary?.top_stage && (
                <Badge variant="light" color="gray" size="xs">
                  Top: {summary.top_stage}
                </Badge>
              )}
              {summary?.sex_bias_label && (
                <Badge
                  variant="light"
                  color={
                    summary.sex_bias_label === "Female_higher"
                      ? "pink"
                      : summary.sex_bias_label === "Male_higher"
                        ? "blue"
                        : "gray"
                  }
                  size="xs"
                >
                  {summary.sex_bias_label.replace(/_/g, " ")}
                </Badge>
              )}
            </>
          )}
        </Group>

        <Group gap="xs">
          {/* Expand All */}
          <Badge
            variant={isExpanded ? "filled" : "outline"}
            color="violet"
            style={{ cursor: "pointer", userSelect: "none" }}
            onClick={onToggleExpand}
            size="xs"
            rightSection={isExpanded ? <IconChevronUp size={10} /> : <IconChevronDown size={10} />}
          >
            {isExpanded ? "Collapse" : "Expand All"}
          </Badge>
        </Group>
      </Group>

      {/* 第二行：选择器 */}
      <Group gap="md" align="flex-end">
        <Select
          label="Dataset"
          size="xs"
          w={260}
          data={datasetOptions}
          value={selectedDataset}
          onChange={(v) => v && onDatasetChange(v)}
          disabled={loading}
          searchable={false}
          comboboxProps={{ withinPortal: false }}
        />
        <Select
          label="Metric"
          size="xs"
          w={220}
          data={metricOptions}
          value={selectedMetric}
          onChange={(v) => v && onMetricChange(v)}
          disabled={loading || metricOptions.length <= 1}
          searchable={false}
          comboboxProps={{ withinPortal: false }}
        />
        {selectedDataset && (
          <Box>
            <Text size="xs" c="dimmed">
              {DATASET_LABELS[selectedDataset] || selectedDataset}
            </Text>
          </Box>
        )}
      </Group>
    </Stack>
  );
}
