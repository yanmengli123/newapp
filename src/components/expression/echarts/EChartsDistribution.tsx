/* eslint-disable @typescript-eslint/no-explicit-any */
import { Badge, Box, Group, Paper, Stack, Text } from "@mantine/core";
import ReactECharts from "echarts-for-react";
import type { ExpressionSample } from "../../../lib/geneApi";
import { isValidNumber, normalizeSex } from "../utils";

interface EChartsDistributionProps {
  samples: ExpressionSample[];
  dataset: string;
  metric: string;
}

function quartiles(vals: number[]): { q1: number; median: number; q3: number; min: number; max: number } {
  const sorted = [...vals].sort((a, b) => a - b);
  const n = sorted.length;
  const q1 = sorted[Math.floor(n * 0.25)] ?? sorted[0];
  const median = sorted[Math.floor(n * 0.5)] ?? sorted[0];
  const q3 = sorted[Math.floor(n * 0.75)] ?? sorted[n - 1];
  const min = sorted[0];
  const max = sorted[n - 1];
  return { q1, median, q3, min, max };
}

function buildDistributionOption(samples: ExpressionSample[], metric: string): any {
  const STAGE_ORDER: Record<string, number> = {
    E0: 1, "E3.5": 2, E7: 3, "E11": 4, "E14": 5, "E18.5": 6, P0: 7, Adult: 8,
  };

  // Group: stage × sex → values[]
  const groups: Record<string, { male: number[]; female: number[] }> = {};
  for (const s of samples) {
    const stage = s.stage ?? "?";
    const sex = normalizeSex(s.sex);
    if (!stage || !sex) continue;
    if (!groups[stage]) groups[stage] = { male: [], female: [] };
    if (isValidNumber(s.value)) (groups[stage] as Record<string, number[]>)[sex].push(s.value);
  }

  const sortedStages = Object.keys(groups).sort(
    (a, b) => (STAGE_ORDER[a] ?? 99) - (STAGE_ORDER[b] ?? 99)
  );

  // For boxplot we need [min, q1, median, q3, max] per stage-sex
  // We'll do side-by-side: Male left, Female right
  type BoxData = { value: [number, number, number, number, number]; sex: string };
  const maleBoxes: (BoxData | null)[] = [];
  const femaleBoxes: (BoxData | null)[] = [];
  const xLabels: string[] = [];

  sortedStages.forEach((stage) => {
    xLabels.push(stage);
    const maleVals = groups[stage]?.male ?? [];
    const femaleVals = groups[stage]?.female ?? [];

    if (maleVals.length >= 2) {
      const { q1, median, q3, min, max } = quartiles(maleVals);
      maleBoxes.push({ value: [min, q1, median, q3, max], sex: "Male" });
    } else {
      maleBoxes.push(null);
    }

    if (femaleVals.length >= 2) {
      const { q1, median, q3, min, max } = quartiles(femaleVals);
      femaleBoxes.push({ value: [min, q1, median, q3, max], sex: "Female" });
    } else {
      femaleBoxes.push(null);
    }
  });

  // Jitter points: for each stage, scatter male/female individual points
  const maleJitter: { value: [number, number]; name: string }[] = [];
  const femaleJitter: { value: [number, number]; name: string }[] = [];

  sortedStages.forEach((stage, xIdx) => {
    const maleVals = groups[stage]?.male ?? [];
    const femaleVals = groups[stage]?.female ?? [];

    maleVals.forEach((v, vi) => {
      // jitter x in [xIdx-0.15, xIdx+0.15]
      const jitterX = xIdx + (Math.random() - 0.5) * 0.24;
      maleJitter.push({ value: [jitterX, v], name: `${stage}-M-${vi}` });
    });

    femaleVals.forEach((v, vi) => {
      const jitterX = xIdx + (Math.random() - 0.5) * 0.24;
      femaleJitter.push({ value: [jitterX, v], name: `${stage}-F-${vi}` });
    });
  });

  return {
    animation: true,
    animationDuration: 600,
    tooltip: {
      trigger: "item",
      formatter: (params: any) => {
        if (params.seriesName === "Male") {
          const [x, y] = params.data.value;
          const stage = sortedStages[x] ?? "?";
          return `<b>${stage} — Male</b><br/>Value: ${(y as number).toFixed(3)}`;
        }
        if (params.seriesName === "Female") {
          const [x, y] = params.data.value;
          const stage = sortedStages[x] ?? "?";
          return `<b>${stage} — Female</b><br/>Value: ${(y as number).toFixed(3)}`;
        }
        if (params.seriesName.startsWith("Box")) {
          const [min, q1, median, q3, max] = params.data.value as number[];
          const sex = params.seriesName.includes("Male") ? "Male" : "Female";
          const stage = sortedStages[params.dataIndex] ?? "?";
          const sexKey = sex === "Male" ? "male" : "female";
          const n = groups[stage]?.[sexKey]?.length ?? 0;
          return `<b>${stage} — ${sex} Box</b><br/>Max: ${max.toFixed(2)}<br/>Q3: ${q3.toFixed(2)}<br/>Median: ${median.toFixed(2)}<br/>Q1: ${q1.toFixed(2)}<br/>Min: ${min.toFixed(2)}<br/><span style="color:#9ca3af;font-size:9px">n=${n}</span>`;
        }
        return "";
      },
    },
    legend: {
      data: ["Male Box", "Female Box", "Male", "Female"],
      top: 0,
      textStyle: { fontSize: 11 },
    },
    grid: { top: 36, left: 56, right: 16, bottom: 56 },
    xAxis: {
      type: "category",
      data: sortedStages,
      name: "Stage",
      nameLocation: "middle",
      nameGap: 32,
      axisLabel: { fontSize: 10 },
    },
    yAxis: {
      type: "value",
      name: metric === "tpm" || metric === "fpkm" ? metric.toUpperCase() : "Normalized Count",
      axisLabel: { fontSize: 9 },
      splitLine: { lineStyle: { color: "#f0f0f0" } },
    },
    series: [
      {
        name: "Male Box",
        type: "boxplot",
        data: maleBoxes.map((b) => b?.value ?? [0, 0, 0, 0, 0]),
        itemStyle: { color: "rgba(34,139,230,0.6)", borderColor: "#228BE6" },
        boxWidth: ["40%", "40%"],
      },
      {
        name: "Female Box",
        type: "boxplot",
        data: femaleBoxes.map((b) => b?.value ?? [0, 0, 0, 0, 0]),
        itemStyle: { color: "rgba(230,73,128,0.6)", borderColor: "#E64980" },
        boxWidth: ["40%", "40%"],
      },
      {
        name: "Male",
        type: "scatter",
        data: maleJitter,
        itemStyle: { color: "#228BE6", opacity: 0.7 },
        symbolSize: 6,
      },
      {
        name: "Female",
        type: "scatter",
        data: femaleJitter,
        itemStyle: { color: "#E64980", opacity: 0.7 },
        symbolSize: 6,
      },
    ],
  };
}

export default function EChartsDistribution({ samples, dataset, metric }: EChartsDistributionProps) {
  if (!samples?.length) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Distribution: no data available</Text>
      </Paper>
    );
  }

  const option = buildDistributionOption(samples, metric);

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Text size="xs" fw={600} c="dimmed">
            Expression Distribution (Box + Jitter) — {dataset}
          </Text>
          <Badge size="xs" color="gray" variant="light">n=3 per group</Badge>
        </Group>
        <Box w="100%">
          <ReactECharts
            option={option}
            style={{ width: "100%", height: 320 }}
            opts={{ renderer: "canvas" }}
          />
        </Box>
      </Stack>
    </Paper>
  );
}
