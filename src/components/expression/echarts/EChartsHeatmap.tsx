/* eslint-disable @typescript-eslint/no-explicit-any */
import { Badge, Box, Group, Paper, Stack, Text } from "@mantine/core";
import ReactECharts from "echarts-for-react";
import type { ExpressionSample } from "../../../lib/geneApi";
import { isValidNumber, normalizeSex } from "../utils";

interface EChartsHeatmapProps {
  samples: ExpressionSample[];
  dataset: string;
  metric: string;
  variant?: "12x3" | "2x6";
}

function buildHeatmapOption(
  samples: ExpressionSample[],
  metric: string,
  variant: "12x3" | "2x6"
): any {
  if (variant === "2x6") {
    // Stage × Sex (2 rows × 6 stages) summary heatmap
    const stageSexMap: Record<string, Record<string, number>> = {};
    const STAGES = ["E0", "E3.5", "E7", "E11", "E14", "E18.5"];

    for (const s of samples) {
      const stage = s.stage ?? "?";
      const sex = normalizeSex(s.sex) ?? "?";
      if (!stage || !sex) continue;
      if (!stageSexMap[stage]) stageSexMap[stage] = {};
      if (!stageSexMap[stage][sex]) stageSexMap[stage][sex] = 0;
      if (isValidNumber(s.value)) {
        const prev = stageSexMap[stage][sex];
        stageSexMap[stage][sex] = (prev || 0) + (s.value as number);
        // We'll compute mean later
      }
    }

    // Count per group for mean
    const counts: Record<string, Record<string, number>> = {};
    for (const s of samples) {
      const stage = s.stage ?? "?";
      const sex = normalizeSex(s.sex) ?? "?";
      if (!counts[stage]) counts[stage] = {};
      counts[stage][sex] = (counts[stage][sex] ?? 0) + 1;
    }

    const sortedStages = STAGES.filter((s) => stageSexMap[s]);
    const yLabels = ["Male", "Female"];
    const data: [number, number, number][] = [];

    let globalMax = 0;
    const flatMap: Record<string, number> = {};
    sortedStages.forEach((stage) => {
      yLabels.forEach((sex, yIdx) => {
        const sum = stageSexMap[stage]?.[sex] ?? 0;
        const cnt = counts[stage]?.[sex] ?? 1;
        const mean = sum / cnt;
        if (mean > globalMax) globalMax = mean;
        const key = `${stage}-${sex}`;
        flatMap[key] = mean;
        data.push([yIdx, sortedStages.indexOf(stage), mean]);
      });
    });

    return {
      animation: true,
      tooltip: {
        formatter: (p: any) => {
          const vals = p.data?.value as number[] | undefined;
          if (!vals || vals.length < 3) return "";
          const [yIdx, xIdx, val] = vals;
          const stage = sortedStages[xIdx] ?? "?";
          const sex = yLabels[yIdx] ?? "?";
          return `<b>${stage} — ${sex}</b><br/>${metric.toUpperCase()}: ${val.toFixed(3)}`;
        },
      },
      grid: { top: 8, left: 80, right: 32, bottom: 8, containLabel: false },
      xAxis: {
        type: "category",
        data: sortedStages,
        name: "Stage",
        nameLocation: "middle",
        nameGap: 28,
        axisLabel: { fontSize: 10 },
        splitArea: { show: false },
      },
      yAxis: {
        type: "category",
        data: yLabels,
        name: "Sex",
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10 },
        splitArea: { show: false },
      },
      visualMap: {
        min: 0,
        max: globalMax,
        calculable: false,
        orient: "vertical",
        right: 0,
        top: "center",
        itemHeight: 120,
        itemWidth: 12,
        textStyle: { fontSize: 9 },
        inRange: { color: ["#f8f8f8", "#b39ddb", "#7e57c2", "#5e35b1", "#311b92"] },
      },
      series: [{
        name: metric,
        type: "heatmap",
        data,
        label: {
          show: true,
          formatter: (p: any) => {
            const val = (p.data?.value as number[] | undefined)?.[2];
            return val != null && val > 0 ? val.toFixed(1) : "—";
          },
          fontSize: 9,
          color: (p: any) => {
            const val = (p.data?.value as number[] | undefined)?.[2];
            return val != null && val > globalMax * 0.6 ? "#fff" : "#212121";
          },
        },
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,0.3)" } },
        itemStyle: { borderWidth: 1, borderColor: "#fff" },
      }],
    };
  }

  // variant === "12x3": Stage × Sex rows × Replicate columns
  const STAGES = ["E0", "E3.5", "E7", "E11", "E14", "E18.5"];
  const REPS = [1, 2, 3];

  const matrix: Record<string, Record<string, number>> = {};
  const sampleNames: Record<string, Record<string, string>> = {};

  for (const s of samples) {
    const stage = s.stage ?? "?";
    const sex = normalizeSex(s.sex) ?? "?";
    const rep = s.replicate ?? 1;
    const key = `${stage}-${sex}`;
    if (!matrix[key]) matrix[key] = {};
    if (!sampleNames[key]) sampleNames[key] = {};
    matrix[key][`rep${rep}`] = isValidNumber(s.value) ? (s.value as number) : 0;
    sampleNames[key][`rep${rep}`] = s.sample_name ?? s.srr_run_id ?? `${stage}-${sex}-R${rep}`;
  }

  const rowLabels: string[] = [];
  STAGES.forEach((stage) => {
    ["Male", "Female"].forEach((sex) => {
      if (matrix[`${stage}-${sex}`]) rowLabels.push(`${stage} ${sex}`);
    });
  });

  const allVals: number[] = [];
  const data: [number, number, number][] = [];
  rowLabels.forEach((rowLabel, rowIdx) => {
    const [stage, sex] = rowLabel.split(" ");
    REPS.forEach((rep, colIdx) => {
      const key = `${stage}-${sex}`;
      const val = matrix[key]?.[`rep${rep}`] ?? 0;
      if (val > 0) allVals.push(val);
      data.push([colIdx, rowIdx, val]);
    });
  });

  const globalMin = allVals.length ? Math.min(...allVals) : 0;
  const globalMax = allVals.length ? Math.max(...allVals) : 1;

  return {
    animation: true,
    tooltip: {
      formatter: (p: any) => {
        const vals = p.data?.value as number[] | undefined;
        if (!vals || vals.length < 3) return "";
        const [colIdx, rowIdx, val] = vals;
        const rowLabel = rowLabels[rowIdx] ?? "?";
        const rep = REPS[colIdx] ?? "?";
        const sampleName = sampleNames[rowLabel.split(" ")[0]]?.[`rep${rep}`] ?? "?";
        return `<b>${rowLabel} R${rep}</b><br/>Sample: ${sampleName}<br/>${metric.toUpperCase()}: ${val.toFixed(3)}`;
      },
    },
    grid: { top: 8, left: 100, right: 48, bottom: 16 },
    xAxis: {
      type: "category",
      data: REPS.map((r) => `Rep ${r}`),
      name: "Replicate",
      nameLocation: "middle",
      nameGap: 22,
      axisLabel: { fontSize: 10 },
    },
    yAxis: {
      type: "category",
      data: rowLabels,
      name: "Stage × Sex",
      nameTextStyle: { fontSize: 9 },
      axisLabel: { fontSize: 9 },
    },
    visualMap: {
      min: globalMin,
      max: globalMax,
      calculable: false,
      orient: "vertical",
      right: 0,
      top: "center",
      itemHeight: 140,
      itemWidth: 12,
      textStyle: { fontSize: 9 },
      inRange: { color: ["#f8f8f8", "#b39ddb", "#7e57c2", "#5e35b1", "#311b92"] },
    },
    series: [{
      name: metric,
      type: "heatmap",
      data,
      label: {
        show: true,
        formatter: (p: any) => {
          const val = (p.data?.value as number[] | undefined)?.[2];
          return val != null && val > 0 ? val.toFixed(1) : "—";
        },
        fontSize: 8,
        color: (p: any) => {
          const val = (p.data?.value as number[] | undefined)?.[2];
          return val != null && val > (globalMax - globalMin) * 0.6 + globalMin ? "#fff" : "#212121";
        },
      },
      emphasis: { itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,0.3)" } },
      itemStyle: { borderWidth: 1, borderColor: "#fff" },
    }],
  };
}

export default function EChartsHeatmap({ samples, dataset, metric, variant = "12x3" }: EChartsHeatmapProps) {
  if (!samples?.length) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Heatmap: no data available</Text>
      </Paper>
    );
  }

  const option = buildHeatmapOption(samples, metric, variant);

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Text size="xs" fw={600} c="dimmed">
            {variant === "12x3" ? "Expression Heatmap (Stage × Sex × Rep)" : "Expression Heatmap (Stage × Sex)"}
            {" — "}{dataset}
          </Text>
          <Badge size="xs" color="gray" variant="light">{samples.length} samples</Badge>
        </Group>
        <Box w="100%">
          <ReactECharts
            option={option}
            style={{ width: "100%", height: variant === "12x3" ? 340 : 160 }}
            opts={{ renderer: "canvas" }}
          />
        </Box>
      </Stack>
    </Paper>
  );
}
