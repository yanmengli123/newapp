import { ActionIcon, Box, Divider, Group, Paper, Popover, Progress, Stack, Text, Badge } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconInfoCircle } from "@tabler/icons-react";
import type { ExpressionSample } from "../../lib/geneApi";
import {
  groupSamplesByStageSexReplicate, sortStages, isValidNumber,
  getDatasetDisplayName,
} from "./utils";

interface ExpressionReplicateConsistencyProps {
  samples: ExpressionSample[];
  dataset: string;
}

interface RowData {
  stage: string;
  sex: "Male" | "Female";
  mean: number;
  std: number;
  cv: number;
  n: number;
}

function calcStats(vals: number[]): { mean: number; std: number; cv: number } {
  if (vals.length === 0) return { mean: 0, std: 0, cv: 0 };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (vals.length === 1) return { mean, std: 0, cv: 0 };
  const variance = vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (vals.length - 1);
  const std = Math.sqrt(variance);
  const cv = mean !== 0 ? Math.abs(std / mean) : 0;
  return { mean, std, cv };
}

function cvColor(cv: number): string {
  if (cv > 0.3) return "red";
  if (cv > 0.15) return "yellow";
  return "teal";
}

function cvLabel(cv: number): string {
  if (cv > 0.3) return "High variability";
  if (cv > 0.15) return "Moderate";
  return "Consistent";
}

const TIPS_CONTENT = (
  <Stack gap="xs" style={{ minWidth: 320, maxWidth: 420 }}>
    {/* 标题 */}
    <Text size="sm" fw={700}>Replicate Consistency 分析说明</Text>

    <Divider size="xs" />

    {/* 1. 数据来源 */}
    <Stack gap={4}>
      <Text size="xs" fw={600} c="blue">▌1. 数据来源</Text>
      <Text size="xs" c="dimmed">
        数据来自 DESeq2 NC 样本（36 个样本 = 6 stages × 2 sexes × 3 replicates）。
        每个 stage × sex 组合有 3 个生物学重复（replicate）。
      </Text>
    </Stack>

    <Divider size="xs" />

    {/* 2. 计算流程 */}
    <Stack gap={4}>
      <Text size="xs" fw={600} c="blue">▌2. 计算流程</Text>
      <Text size="xs" c="dimmed">
        Step 1 — 按 stage → sex → replicate 分组：
      </Text>
      <Text size="xs" c="dimmed" pl="sm">
        例：E0 Male = {'{'} rep1: [198.57, 171.88, 245.42], rep2: [69.32, 57.32, 59.12], rep3: [61.47, 53.47, 66.41] {'}'}
      </Text>
      <Text size="xs" c="dimmed" mt={4}>
        Step 2 — 每个 replicate 内求均值：
      </Text>
      <Text size="xs" c="dimmed" pl="sm">
        rep1_mean = (198.57+171.88+245.42)/3 = 205.29
      </Text>
      <Text size="xs" c="dimmed" pl="sm">
        rep2_mean = (69.32+57.32+59.12)/3 = 61.92
      </Text>
      <Text size="xs" c="dimmed" pl="sm">
        rep3_mean = (61.47+53.47+66.41)/3 = 60.45
      </Text>
      <Text size="xs" c="dimmed" mt={4}>
        Step 3 — 在 3 个 replicate 均值之间计算：
      </Text>
      <Text size="xs" c="dimmed" pl="sm">
        Mean = (205.29+61.92+60.45)/3 = 109.22
      </Text>
      <Text size="xs" c="dimmed" pl="sm">
        SD = √[Σ(mean_i − Mean)²/(n−1)] = 82.08
      </Text>
      <Text size="xs" c="dimmed" pl="sm">
        CV = SD/Mean = 82.08/109.22 = <Text span fw={600}>75.2%</Text> → High variability
      </Text>
    </Stack>

    <Divider size="xs" />

    {/* 3. 指标解读 */}
    <Stack gap={4}>
      <Text size="xs" fw={600} c="blue">▌3. 指标解读</Text>
      <Text size="xs" c="dimmed">
        <Text span fw={600}>n</Text> = 该 stage × sex 组合的 replicate 数量（通常 = 3）
      </Text>
      <Text size="xs" c="dimmed">
        <Text span fw={600}>Mean ± SD</Text> = 3 个 replicate 均值的均值和标准差
      </Text>
      <Text size="xs" c="dimmed">
        <Text span fw={600}>CV</Text>（变异系数）= SD/Mean，反映 replicate 间的一致性：
      </Text>
    </Stack>

    {/* CV 颜色说明 */}
    <Stack gap={4} pl="sm">
      <Group gap="xs">
        <Badge size="xs" color="teal" variant="light">≤15%</Badge>
        <Text size="xs">Consistent — 重复一致性良好</Text>
      </Group>
      <Group gap="xs">
        <Badge size="xs" color="yellow" variant="light">15~30%</Badge>
        <Text size="xs">Moderate — 中等一致性</Text>
      </Group>
      <Group gap="xs">
        <Badge size="xs" color="red" variant="light">&gt;30%</Badge>
        <Text size="xs">High variability — 重复间变异大</Text>
      </Group>
    </Stack>

    <Divider size="xs" />

    {/* 4. 注意事项 */}
    <Stack gap={4}>
      <Text size="xs" fw={600} c="blue">▌4. 注意事项</Text>
      <Text size="xs" c="dimmed">
        • n=1 时 CV=0（无 replicate 可比），不代表真实一致性
      </Text>
      <Text size="xs" c="dimmed">
        • High variability 不一定意味着"坏数据"——可能反映真实的生物学变异
      </Text>
      <Text size="xs" c="dimmed">
        • Progress bar 长度反映该组合的相对表达量（归一化到最大值）
      </Text>
      <Text size="xs" c="dimmed">
        • 建议结合 <Text component="code" size="xs">FoldChangeTrajectory</Text> 和 <Text component="code" size="xs">StageChart</Text> 综合判断
      </Text>
    </Stack>
  </Stack>
);

export default function ExpressionReplicateConsistency({ samples, dataset }: ExpressionReplicateConsistencyProps) {
  const [opened, { toggle, close }] = useDisclosure(false);

  // Use replicate-aware grouping: groups values by stage → sex → replicate
  const grouped = groupSamplesByStageSexReplicate(samples);
  const stages = sortStages(Object.keys(grouped));

  const rows: RowData[] = [];
  for (const stage of stages) {
    const maleVals = grouped[stage].male.filter(isValidNumber);
    const femaleVals = grouped[stage].female.filter(isValidNumber);

    if (maleVals.length > 0) {
      const { mean, std, cv } = calcStats(maleVals);
      rows.push({ stage, sex: "Male", mean, std, cv, n: maleVals.length });
    }
    if (femaleVals.length > 0) {
      const { mean, std, cv } = calcStats(femaleVals);
      rows.push({ stage, sex: "Female", mean, std, cv, n: femaleVals.length });
    }
  }

  if (rows.length === 0) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Replicate Consistency: no valid data</Text>
      </Paper>
    );
  }

  // Normalize mean to [0,1] for bar width display
  const maxMean = Math.max(...rows.map(r => r.mean), 0.001);

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        {/* Header with title + info button */}
        <Group justify="space-between" align="center">
          <Text size="xs" fw={600} c="dimmed">
            Replicate Consistency — {getDatasetDisplayName(dataset)}
          </Text>
          <Popover
            opened={opened}
            onClose={close}
            position="top"
            withArrow
            shadow="md"
            middlewares={{ flip: true, shift: true, inline: true }}
            transitionProps={{ transition: "pop" }}
          >
            <Popover.Target>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                onClick={toggle}
                title="查看分析说明"
              >
                <IconInfoCircle size={14} />
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown
              style={{
                padding: 12,
                maxHeight: "70vh",
                overflowY: "auto",
                maxWidth: 460,
              }}
            >
              {TIPS_CONTENT}
            </Popover.Dropdown>
          </Popover>
        </Group>

        <Stack gap={4}>
          {/* Header row */}
          <Group gap={4} px={4} pb={2}>
            <Text size="xs" c="dimmed" fw={600} w={52}>Stage</Text>
            <Text size="xs" c="dimmed" fw={600} w={28} ta="center">Sex</Text>
            <Text size="xs" c="dimmed" fw={600} w={28} ta="right">n</Text>
            <Text size="xs" c="dimmed" fw={600} ta="right" pr={4}>Mean ± SD</Text>
            <Text size="xs" c="dimmed" fw={600} ta="right" w={52}>CV</Text>
            <Text size="xs" c="dimmed" fw={600} ta="center" w={80}>Consistency</Text>
          </Group>

          <Divider size="xs" />

          {rows.map((r, i) => (
            <Group key={i} gap={4} px={4} py={3} wrap="nowrap" style={{ borderBottom: i < rows.length - 1 ? "1px solid #f0f0f0" : undefined }}>
              {/* Stage */}
              <Text size="xs" fw={500} w={52} lineClamp={1}>{r.stage}</Text>

              {/* Sex badge */}
              <Box w={28} ta="center">
                <Text size="xs" c={r.sex === "Male" ? "blue" : "pink"} fw={600}>
                  {r.sex === "Male" ? "♂" : "♀"}
                </Text>
              </Box>

              {/* n — number of replicates */}
              <Text size="xs" c="dimmed" w={28} ta="right" mr={4}>{r.n}</Text>

              {/* Mean bar + SD */}
              <Box style={{ flex: 1, minWidth: 0 }} ta="right" pr={8}>
                <Group gap={6} wrap="nowrap">
                  <Box style={{ flex: 1, minWidth: 60 }}>
                    <Progress
                      value={(r.mean / maxMean) * 100}
                      color={r.sex === "Male" ? "blue" : "pink"}
                      size="sm"
                      radius="xs"
                      style={{ width: "100%" }}
                    />
                  </Box>
                  <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                    {r.mean.toFixed(2)} ± {r.std.toFixed(2)}
                  </Text>
                </Group>
              </Box>

              {/* CV badge */}
              <Badge
                size="xs"
                color={cvColor(r.cv)}
                variant="light"
                w={52}
                ta="right"
                style={{ whiteSpace: "nowrap" }}
              >
                {(r.cv * 100).toFixed(1)}%
              </Badge>

              {/* Consistency indicator */}
              <Badge
                size="xs"
                variant="outline"
                color={cvColor(r.cv)}
                w={80}
                ta="center"
                style={{ whiteSpace: "nowrap" }}
              >
                {cvLabel(r.cv)}
              </Badge>
            </Group>
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}
