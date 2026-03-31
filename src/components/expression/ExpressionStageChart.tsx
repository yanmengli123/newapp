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

// stage_means: Record<string, Record<string, number> | number | null>
// Each stage key → { male: number, female: number, mean: number } | number
function resolveStageMeans(
  stageMeans: Record<string, Record<string, number> | number | null> | null
): {
  stages: string[];
  maleValues: number[];
  femaleValues: number[];
  meanValues: number[];
} {
  if (!stageMeans) return { stages: [], maleValues: [], femaleValues: [], meanValues: [] };

  // Sort stages by chronological order
  const STAGE_ORDER = ["E0", "E3.5", "E7", "E11", "E14", "E18.5", "P0", "Adult"];

  const entries = Object.entries(stageMeans);
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
    stages.push(stage);
    if (typeof val === "object" && val !== null) {
      maleValues.push(val["male"] ?? 0);
      femaleValues.push(val["female"] ?? 0);
      meanValues.push(val["mean"] ?? 0);
    } else {
      maleValues.push(0);
      femaleValues.push(0);
      meanValues.push(typeof val === "number" ? val : 0);
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

  if (stages.length === 0) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Stage means chart: no data available</Text>
      </Paper>
    );
  }

  const traces = [
    {
      x: stages,
      y: maleValues,
      name: "Male",
      type: "bar" as const,
      marker: { color: "#228BE6", opacity: 0.85 },
      text: maleValues.map((v) => v.toFixed(2)),
      textposition: "outside" as const,
      textfont: { size: 9, color: "#228BE6" },
    },
    {
      x: stages,
      y: femaleValues,
      name: "Female",
      type: "bar" as const,
      marker: { color: "#E64980", opacity: 0.85 },
      text: femaleValues.map((v) => v.toFixed(2)),
      textposition: "outside" as const,
      textfont: { size: 9, color: "#E64980" },
    },
    {
      x: stages,
      y: meanValues,
      name: "Total Mean",
      type: "scatter" as const,
      mode: "lines+markers" as const,
      line: { color: "#7950F2", width: 2, dash: "dot" as const },
      marker: { color: "#7950F2", size: 7 },
      yaxis: "y2" as const,
    },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      orientation: "h" as const,
      x: 0.5,
      xanchor: "center" as const,
      y: -0.22,
      font: { size: 9 },
    },
    font: { family: "sans-serif", size: 10 },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    showlegend: true,
    hovermode: "x unified" as const,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config: any = {
    displayModeBar: false,
    responsive: true,
    locale: "en",
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          Stage Means — {dataset}
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
