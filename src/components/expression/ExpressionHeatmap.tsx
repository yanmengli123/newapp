/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Paper, Stack, Text } from "@mantine/core";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { GeneExpressionResponse } from "../../lib/geneApi";
import { resolveStageMeans, getDatasetDisplayName, getMetricLabel, PLOT_CONFIG, PAPER_STYLE } from "./utils";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionHeatmapProps {
  summary: GeneExpressionResponse["summary"];
  dataset: string;
  metric: string;
}

export default function ExpressionHeatmap({ summary, dataset, metric }: ExpressionHeatmapProps) {
  const { stages, maleValues, femaleValues } = resolveStageMeans(summary?.stage_means ?? null);

  const hasData = stages.length > 0 && (
    maleValues.some(v => v > 0) || femaleValues.some(v => v > 0)
  );

  if (!hasData) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Expression Heatmap: no stage means data available</Text>
      </Paper>
    );
  }

  // Build 2-row matrix: [Male, Female] × [stages]
  const z = [maleValues, femaleValues];
  const allValues = [...maleValues, ...femaleValues].filter(v => v > 0);
  const minVal = allValues.length > 0 ? Math.min(...allValues) : 0;
  const maxVal = allValues.length > 0 ? Math.max(...allValues) : 1;

  function normalize(v: number): number {
    return maxVal > minVal ? (v - minVal) / (maxVal - minVal) : 0;
  }

  const zNormalized = z.map(row => row.map(v => (v > 0 ? normalize(v) : 0)));

  const traces: any[] = [
    {
      type: "heatmap",
      z: zNormalized,
      x: stages,
      y: ["Male", "Female"],
      colorscale: [
        [0, "#f8f8f8"],
        [0.25, "#b39ddb"],
        [0.5, "#7e57c2"],
        [0.75, "#5e35b1"],
        [1, "#311b92"],
      ],
      showscale: true,
      colorbar: {
        title: { text: getMetricLabel(metric), side: "right", font: { size: 9 } },
        tickfont: { size: 8 },
        len: 0.7,
      },
      text: z.map(row => row.map(v => (v > 0 ? v.toFixed(2) : "0"))),
      hoverongaps: false,
      hovertemplate: "%{y} %{x}: %{text}<extra></extra>",
    },
  ];

  // Add annotations for cell values
  const annotations: any[] = [];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < stages.length; j++) {
      const val = z[i][j];
      const norm = zNormalized[i][j];
      const textColor = norm > 0.5 ? "#ffffff" : "#212121";
      annotations.push({
        x: stages[j],
        y: ["Male", "Female"][i],
        text: val > 0 ? val.toFixed(1) : "—",
        showarrow: false,
        font: { size: 8, color: textColor },
        xanchor: "center",
        yanchor: "middle",
      });
    }
  }

  const layout: any = {
    margin: { t: 8, b: 48, l: 80, r: 16 },
    xaxis: { tickfont: { size: 9 }, title: { text: "Stage", font: { size: 10 } }, gridcolor: "#f8f8f8" },
    yaxis: { tickfont: { size: 9 }, title: { text: "", font: { size: 10 } } },
    annotations,
    ...PAPER_STYLE,
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          Stage × Sex Heatmap — {getDatasetDisplayName(dataset)}
        </Text>
        <Box w="100%">
          <Plot
            data={traces}
            layout={layout}
            config={PLOT_CONFIG}
            style={{ width: "100%", height: 140 }}
            useResizeHandler
          />
        </Box>
      </Stack>
    </Paper>
  );
}
