/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Paper, Stack, Text } from "@mantine/core";
import ReactECharts from "echarts-for-react";
import type { ExpressionSample } from "../../../lib/geneApi";
import { isValidNumber, normalizeSex, sortSamples } from "../utils";

interface EChartsTrendProps {
  samples: ExpressionSample[];
  dataset: string;
  metric: string;
}

function buildTrendOption(samples: ExpressionSample[], metric: string): any {
  const sorted = sortSamples(samples);

  // Build stage × sex means
  const stageSexMap: Record<string, { male: number[]; female: number[] }> = {};
  for (const s of sorted) {
    const stage = s.stage ?? "?";
    if (!stageSexMap[stage]) stageSexMap[stage] = { male: [], female: [] };
    const sex = normalizeSex(s.sex);
    if (sex === "Male" && isValidNumber(s.value)) stageSexMap[stage].male.push(s.value);
    if (sex === "Female" && isValidNumber(s.value)) stageSexMap[stage].female.push(s.value);
  }

  const STAGE_ORDER = ["E0", "E3.5", "E7", "E11", "E14", "E18.5", "P0", "Adult"];
  const stages = STAGE_ORDER.filter((s) => stageSexMap[s]);

  const maleMeans = stages.map((s) => {
    const vals = stageSexMap[s]?.male ?? [];
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
  const femaleMeans = stages.map((s) => {
    const vals = stageSexMap[s]?.female ?? [];
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });

  const malePoints: Array<{ name: string; value: [string, number]; itemStyle: { color: string } }> = [];
  const femalePoints: Array<{ name: string; value: [string, number]; itemStyle: { color: string } }> = [];

  stages.forEach((stage, i) => {
    if (maleMeans[i] != null) {
      malePoints.push({
        name: `${stage}-M`,
        value: [stage, maleMeans[i] as number],
        itemStyle: { color: "#228BE6" },
      });
    }
    if (femaleMeans[i] != null) {
      femalePoints.push({
        name: `${stage}-F`,
        value: [stage, femaleMeans[i] as number],
        itemStyle: { color: "#E64980" },
      });
    }
  });

  const allMeans = [...maleMeans, ...femaleMeans].filter((v) => v != null) as number[];
  const yMin = allMeans.length ? Math.min(...allMeans) * 0.9 : 0;
  const yMax = allMeans.length ? Math.max(...allMeans) * 1.1 : 1;

  return {
    animation: true,
    animationDuration: 800,
    tooltip: {
      trigger: "item",
      formatter: (params: any) => {
        if (!params.data) return "";
        const [stage, val] = params.data.value;
        const sex = params.data.name?.includes("-M") ? "Male" : "Female";
        return `<b>${stage} (${sex})</b><br/>${metric.toUpperCase()}: ${(val as number).toFixed(3)}`;
      },
    },
    legend: {
      data: ["Male Mean", "Female Mean"],
      top: 0,
      textStyle: { fontSize: 11 },
    },
    grid: { top: 36, left: 56, right: 16, bottom: 48 },
    xAxis: {
      type: "category",
      data: stages,
      name: "Stage",
      nameLocation: "middle",
      nameGap: 30,
      axisLabel: { fontSize: 10 },
    },
    yAxis: {
      type: "value",
      name: metric === "tpm" || metric === "fpkm" ? metric.toUpperCase() : "Normalized Count",
      min: yMin,
      max: yMax,
      nameTextStyle: { fontSize: 10 },
      axisLabel: { fontSize: 9 },
      splitLine: { lineStyle: { color: "#f0f0f0" } },
    },
    series: [
      {
        name: "Male Mean",
        type: "line",
        data: maleMeans,
        smooth: true,
        lineStyle: { color: "#228BE6", width: 2.5 },
        itemStyle: { color: "#228BE6" },
        symbol: "circle",
        symbolSize: 8,
        showAllSymbol: true,
        connectNulls: true,
      },
      {
        name: "Female Mean",
        type: "line",
        data: femaleMeans,
        smooth: true,
        lineStyle: { color: "#E64980", width: 2.5 },
        itemStyle: { color: "#E64980" },
        symbol: "circle",
        symbolSize: 8,
        showAllSymbol: true,
        connectNulls: true,
      },
      // Replicate scatter overlay
      {
        name: "Male Rep",
        type: "scatter",
        data: malePoints,
        itemStyle: { color: "#228BE6", opacity: 0.4 },
        symbolSize: 5,
        tooltip: { formatter: (p: any) => `${p.data.name}<br/>${(p.data.value[1] as number).toFixed(3)}` },
      },
      {
        name: "Female Rep",
        type: "scatter",
        data: femalePoints,
        itemStyle: { color: "#E64980", opacity: 0.4 },
        symbolSize: 5,
        tooltip: { formatter: (p: any) => `${p.data.name}<br/>${(p.data.value[1] as number).toFixed(3)}` },
      },
    ],
  };
}

export default function EChartsTrend({ samples, dataset, metric }: EChartsTrendProps) {
  if (!samples?.length) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Trend: no data available</Text>
      </Paper>
    );
  }

  const option = buildTrendOption(samples, metric);

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          Expression Trend — {dataset}
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
