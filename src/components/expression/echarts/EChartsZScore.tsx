/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Paper, Stack, Text } from "@mantine/core";
import ReactECharts from "echarts-for-react";
import type { ExpressionSample } from "../../../lib/geneApi";
import { isValidNumber, normalizeSex } from "../utils";

interface EChartsZScoreProps {
  samples: ExpressionSample[];
  dataset: string;
}

function buildZScoreOption(samples: ExpressionSample[]): any {
  // Compute stage × sex mean and global mean/std for z-score
  const stageSexMap: Record<string, number[]> = {};
  const STAGE_ORDER: Record<string, number> = {
    E0: 1, "E3.5": 2, "E4.5": 3, "E5.5": 4, "E6.5": 5, "E18.5": 6,
  };

  for (const s of samples) {
    const stage = s.stage ?? "?";
    const sex = normalizeSex(s.sex);
    if (!stage || !sex) continue;
    const key = `${stage}-${sex}`;
    if (!stageSexMap[key]) stageSexMap[key] = [];
    if (isValidNumber(s.value)) stageSexMap[key].push(s.value);
  }

  // Compute mean per stage-sex
  const keys = Object.keys(stageSexMap).sort((a, b) => {
    const [sa, sexA] = a.split("-");
    const [sb] = b.split("-");
    const orderA = STAGE_ORDER[sa] ?? 99;
    const orderB = STAGE_ORDER[sb] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return sexA === "Male" ? -1 : 1;
  });

  const means: number[] = keys.map((k) => {
    const vals = stageSexMap[k];
    return vals?.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  });

  const globalMean = means.filter((v) => v > 0).reduce((a, b) => a + b, 0) / means.filter((v) => v > 0).length || 0;
  const globalStd = Math.sqrt(
    means.filter((v) => v > 0).reduce((sum, v) => sum + (v - globalMean) ** 2, 0) / means.filter((v) => v > 0).length
  ) || 1;

  const zMale: (number | null)[] = [];
  const zFemale: (number | null)[] = [];
  const xLabels: string[] = [];

  keys.forEach((k, i) => {
    const [stage, sex] = k.split("-");
    const mean = means[i];
    const z = globalStd > 0 ? (mean - globalMean) / globalStd : 0;
    if (sex === "Male") {
      zMale.push(z);
      zFemale.push(null);
    } else {
      zMale.push(null);
      zFemale.push(z);
    }
    xLabels.push(stage);
  });

  // Unique x-axis labels (stages)
  const uniqueStages = xLabels.filter((v, i, a) => a.indexOf(v) === i);

  return {
    animation: true,
    animationDuration: 800,
    tooltip: {
      trigger: "axis",
      formatter: (params: any[]) => {
        const stage = params[0]?.axisValue ?? "";
        const parts = params.filter((p: any) => p.data != null && p.seriesName !== "Zero Line");
        if (!parts.length) return "";
        return `<b>${stage}</b><br/>` +
          parts.map((p: any) => `${p.seriesName}: ${(p.data as number).toFixed(3)}`).join("<br/>");
      },
    },
    legend: {
      data: ["Male Z-Score", "Female Z-Score"],
      top: 0,
      textStyle: { fontSize: 11 },
    },
    grid: { top: 36, left: 56, right: 16, bottom: 48 },
    xAxis: {
      type: "category",
      data: uniqueStages,
      name: "Stage",
      nameLocation: "middle",
      nameGap: 30,
      axisLabel: { fontSize: 10 },
    },
    yAxis: {
      type: "value",
      name: "Z-Score",
      axisLabel: { fontSize: 9, formatter: (v: number) => v.toFixed(1) },
      splitLine: { lineStyle: { color: "#f0f0f0" } },
    },
    series: [
      {
        name: "Male Z-Score",
        type: "line",
        data: zMale,
        smooth: true,
        lineStyle: { color: "#228BE6", width: 2 },
        itemStyle: { color: "#228BE6" },
        symbol: "circle",
        symbolSize: 7,
        connectNulls: true,
      },
      {
        name: "Female Z-Score",
        type: "line",
        data: zFemale,
        smooth: true,
        lineStyle: { color: "#E64980", width: 2 },
        itemStyle: { color: "#E64980" },
        symbol: "circle",
        symbolSize: 7,
        connectNulls: true,
      },
      // Zero reference line
      {
        name: "Zero Line",
        type: "line",
        data: uniqueStages.map(() => 0),
        lineStyle: { color: "#9ca3af", width: 1, type: "dashed" },
        symbol: "none",
        tooltip: { show: false },
        silent: true,
      },
      // ±1.96 CI band (approximate)
      {
        name: "95% CI",
        type: "line",
        data: uniqueStages.map(() => 1.96),
        lineStyle: { color: "#f59e0b", width: 1, type: "dotted", opacity: 0.5 },
        symbol: "none",
        tooltip: { show: false },
        silent: true,
      },
      {
        name: "95% CI -",
        type: "line",
        data: uniqueStages.map(() => -1.96),
        lineStyle: { color: "#f59e0b", width: 1, type: "dotted", opacity: 0.5 },
        symbol: "none",
        tooltip: { show: false },
        silent: true,
      },
    ],
  };
}

export default function EChartsZScore({ samples, dataset }: EChartsZScoreProps) {
  if (!samples?.length) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Z-Score: no data available</Text>
      </Paper>
    );
  }

  const option = buildZScoreOption(samples);

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          Z-Score Profile — {dataset}
        </Text>
        <Box w="100%">
          <ReactECharts
            option={option}
            style={{ width: "100%", height: 280 }}
            opts={{ renderer: "canvas" }}
          />
        </Box>
      </Stack>
    </Paper>
  );
}
