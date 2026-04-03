/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Group, Paper, Progress, Stack, Text, Badge, Divider } from "@mantine/core";
import type { ExpressionSample } from "../../lib/geneApi";
import {
  groupSamplesByStageSex, sortStages, isValidNumber,
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

export default function ExpressionReplicateConsistency({ samples, dataset }: ExpressionReplicateConsistencyProps) {
  const grouped = groupSamplesByStageSex(samples);
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
        <Text size="xs" fw={600} c="dimmed">
          Replicate Consistency — {getDatasetDisplayName(dataset)}
        </Text>

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

              {/* n */}
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