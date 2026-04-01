/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Paper, Stack, Text } from "@mantine/core";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { GeneExpressionResponse } from "../../lib/geneApi";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionStageChartProps {
  summary: GeneExpressionResponse["summary"];
  dataset: string;
  metric: string;
}

const DATASET_DISPLAY_NAMES: Record<string, string> = {
  day_deseq2_36: "DESeq2 NC — 36 发育阶段样本",
  raw_ballgown_36: "Ballgown TPM/FPKM — 36 发育阶段样本",
  esc_srr_23: "ESC SRR Runs — 23 个 SRA Runs",
};

function getDatasetDisplayName(code: string): string {
  return DATASET_DISPLAY_NAMES[code] ?? code;
}

function isValidNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function resolveStageMeans(
  stageMeans: Record<string, Record<string, number> | number | null> | null | undefined
): {
  stages: string[];
  maleValues: number[];
  femaleValues: number[];
  meanValues: number[];
} {
  if (!stageMeans || typeof stageMeans !== "object") {
    return { stages: [], maleValues: [], femaleValues: [], meanValues: [] };
  }

  const STAGE_ORDER = ["E0", "E3.5", "E7", "E11", "E14", "E18.5", "P0", "Adult"];

  const entries = Object.entries(stageMeans as Record<string, unknown>);
  entries.sort(([a], [b]) => {
    const ai = STAGE_ORDER.indexOf(a);
    const bi = STAGE_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const stages: string[] = [];
  const maleValues: number[] = [];
  const femaleValues: number[] = [];
  const meanValues: number[] = [];

  for (const [stage, val] of entries) {
    if (!stage) continue;
    stages.push(stage);

    if (val != null && typeof val === "object") {
      const obj = val as Record<string, unknown>;
      maleValues.push(isValidNumber(obj["male"]) ? (obj["male"] as number) : 0);
      femaleValues.push(isValidNumber(obj["female"]) ? (obj["female"] as number) : 0);
      const meanVal = isValidNumber(obj["mean"])
        ? (obj["mean"] as number)
        : Object.values(obj).find(isValidNumber) ?? 0;
      meanValues.push(meanVal);
    } else if (isValidNumber(val)) {
      maleValues.push(0);
      femaleValues.push(0);
      meanValues.push(val);
    } else {
      maleValues.push(0);
      femaleValues.push(0);
      meanValues.push(0);
    }
  }

  return { stages, maleValues, femaleValues, meanValues };
}

export default function ExpressionStageChart({
  summary,
  dataset,
  metric,
}: ExpressionStageChartProps) {
  const { stages, maleValues, femaleValues, meanValues } = resolveStageMeans(summary?.stage_means ?? null);

  const hasData = stages.length > 0 && (
    maleValues.some(v => v > 0) ||
    femaleValues.some(v => v > 0) ||
    meanValues.some(v => v > 0)
  );

  if (!hasData) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Stage means chart: no data available</Text>
      </Paper>
    );
  }

  const traces: any[] = [
    {
      x: stages,
      y: maleValues.map(v => isValidNumber(v) ? v : 0),
      name: "Male",
      type: "bar",
      marker: { color: "#228BE6", opacity: 0.85 },
      text: maleValues.map(v => (isValidNumber(v) ? v : 0).toFixed(2)),
      textposition: "outside",
      textfont: { size: 9, color: "#228BE6" },
    },
    {
      x: stages,
      y: femaleValues.map(v => isValidNumber(v) ? v : 0),
      name: "Female",
      type: "bar",
      marker: { color: "#E64980", opacity: 0.85 },
      text: femaleValues.map(v => (isValidNumber(v) ? v : 0).toFixed(2)),
      textposition: "outside",
      textfont: { size: 9, color: "#E64980" },
    },
    {
      x: stages,
      y: meanValues.map(v => isValidNumber(v) ? v : 0),
      name: "Total Mean",
      type: "scatter",
      mode: "lines+markers",
      line: { color: "#7950F2", width: 2, dash: "dot" },
      marker: { color: "#7950F2", size: 7 },
      yaxis: "y2",
    },
  ];

  const layout: any = {
    barmode: "group",
    margin: { t: 8, b: 48, l: 56, r: 16 },
    yaxis: {
      title: { text: metric === "tpm" || metric === "fpkm" ? metric.toUpperCase() : "Normalized Count", font: { size: 10 } },
      gridcolor: "#f0f0f0",
      tickfont: { size: 9 },
      domain: [0, 0.72],
    },
    yaxis2: {
      title: { text: "Mean (dot)", font: { size: 10, color: "#7950F2" } },
      gridcolor: "#f0f0f0",
      tickfont: { size: 9, color: "#7950F2" },
      anchor: "free",
      side: "right",
      overlaying: "y",
      position: 0.98,
      domain: [0, 1],
    },
    xaxis: {
      tickfont: { size: 9 },
      gridcolor: "#f8f8f8",
    },
    legend: {
      orientation: "h",
      x: 0.5,
      xanchor: "center",
      y: -0.22,
      font: { size: 9 },
    },
    font: { family: "sans-serif", size: 10 },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    showlegend: true,
    hovermode: "x unified",
  };

  const config: any = {
    displayModeBar: false,
    responsive: true,
    locale: "en",
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          Stage Means — {getDatasetDisplayName(dataset)}
        </Text>
        <Box w="100%">
          <Plot
            data={traces}
            layout={layout}
            config={config}
            style={{ width: "100%", height: 220 }}
            useResizeHandler
          />
        </Box>
      </Stack>
    </Paper>
  );
}
