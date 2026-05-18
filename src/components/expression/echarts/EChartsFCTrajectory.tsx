/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Paper, Stack, Text } from "@mantine/core";
import ReactECharts from "echarts-for-react";
import type { ExpressionSample } from "../../../lib/geneApi";
import { isValidNumber, normalizeSex } from "../utils";

interface EChartsFCTrajectoryProps {
  samples: ExpressionSample[];
  dataset: string;
}

function buildFCtrajectoryOption(samples: ExpressionSample[]): any {
  const STAGE_ORDER: Record<string, number> = {
    E0: 1, "E3.5": 2, "E4.5": 3, "E5.5": 4, "E6.5": 5, "E18.5": 6,
  };

  // Compute stage × sex means
  const stageSexMap: Record<string, Record<string, number[]>> = {};
  for (const s of samples) {
    const stage = s.stage ?? "?";
    const sex = normalizeSex(s.sex) ?? "Unknown";
    if (!stage || !sex) continue;
    if (!stageSexMap[stage]) stageSexMap[stage] = {};
    if (!stageSexMap[stage][sex]) stageSexMap[stage][sex] = [];
    if (isValidNumber(s.value)) stageSexMap[stage][sex].push(s.value);
  }

  const sortedStages = Object.keys(stageSexMap).sort(
    (a, b) => (STAGE_ORDER[a] ?? 99) - (STAGE_ORDER[b] ?? 99)
  );

  // Compute mean per stage
  const stageMeans: Record<string, number> = {};
  for (const stage of sortedStages) {
    const allVals: number[] = [];
    for (const sex of Object.keys(stageSexMap[stage] ?? {})) {
      allVals.push(...(stageSexMap[stage][sex] ?? []));
    }
    stageMeans[stage] = allVals.length ? allVals.reduce((a, b) => a + b, 0) / allVals.length : 0;
  }

  // Compute log2FC between adjacent stages
  const transitions: string[] = [];
  const log2fcs: (number | null)[] = [];
  const isUpDown: ("up" | "down" | "neutral")[] = [];

  for (let i = 0; i < sortedStages.length - 1; i++) {
    const from = sortedStages[i];
    const to = sortedStages[i + 1];
    const fromMean = stageMeans[from] ?? 0;
    const toMean = stageMeans[to] ?? 0;
    const fc = fromMean > 0 && toMean > 0 ? toMean / fromMean : 0;
    const log2fc = fc > 0 ? Math.log2(fc) : 0;
    transitions.push(`${from} → ${to}`);
    log2fcs.push(log2fc);
    isUpDown.push(log2fc > 0.1 ? "up" : log2fc < -0.1 ? "down" : "neutral");
  }

  const colors = isUpDown.map((d) =>
    d === "up" ? "#ef4444" : d === "down" ? "#3b82f6" : "#9ca3af"
  );

  return {
    animation: true,
    animationDuration: 800,
    tooltip: {
      trigger: "axis",
      formatter: (params: any[]) => {
        const d = params.find((p: any) => p.seriesName === "log2FC");
        if (!d || d.data == null) return "";
        const idx = d.dataIndex;
        const transition = transitions[idx] ?? "";
        const fc = log2fcs[idx] ?? 0;
        const fcVal = fc > 0 ? `↑ ${(2 ** fc).toFixed(2)}x` : fc < 0 ? `↓ ${(2 ** -fc).toFixed(2)}x` : "—";
        return `<b>${transition}</b><br/>log₂FC: ${fc.toFixed(3)}<br/>Fold: ${fcVal}`;
      },
    },
    grid: { top: 16, left: 64, right: 32, bottom: 64 },
    xAxis: {
      type: "category",
      data: transitions,
      name: "Stage Transition",
      nameLocation: "middle",
      nameGap: 48,
      axisLabel: { fontSize: 9, interval: 0, rotate: -30 },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: "log₂ Fold Change",
      axisLabel: { fontSize: 10, formatter: (v: number) => v.toFixed(1) },
      splitLine: { lineStyle: { color: "#f0f0f0" } },
    },
    series: [
      {
        name: "log2FC",
        type: "bar",
        data: log2fcs.map((v, i) => ({
          value: v,
          itemStyle: { color: colors[i], borderRadius: (v ?? 0) >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4] },
        })),
        barWidth: "60%",
        label: {
          show: true,
          position: "top",
          formatter: (p: any) => {
            const v = p.data.value as number;
            return v > 0.5 || v < -0.5 ? v.toFixed(2) : "";
          },
          fontSize: 9,
        },
      },
      // Reference lines
      {
        name: "FC=2",
        type: "line",
        data: transitions.map(() => 1),
        lineStyle: { color: "#f59e0b", width: 1, type: "dashed", opacity: 0.6 },
        symbol: "none",
        tooltip: { show: false },
        silent: true,
      },
      {
        name: "FC=-2",
        type: "line",
        data: transitions.map(() => -1),
        lineStyle: { color: "#f59e0b", width: 1, type: "dashed", opacity: 0.6 },
        symbol: "none",
        tooltip: { show: false },
        silent: true,
      },
    ],
  };
}

export default function EChartsFCTrajectory({ samples, dataset }: EChartsFCTrajectoryProps) {
  if (!samples?.length) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">FC Trajectory: no data available</Text>
      </Paper>
    );
  }

  const option = buildFCtrajectoryOption(samples);

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          Fold Change Trajectory — {dataset}
        </Text>
        <Box w="100%">
          <ReactECharts
            option={option}
            style={{ width: "100%", height: 260 }}
            opts={{ renderer: "canvas" }}
          />
        </Box>
      </Stack>
    </Paper>
  );
}
