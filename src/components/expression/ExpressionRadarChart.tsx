/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Paper, Stack, Text } from "@mantine/core";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { GeneExpressionResponse } from "../../lib/geneApi";
import { resolveStageMeans, getDatasetDisplayName, PLOT_CONFIG, PAPER_STYLE, isValidNumber } from "./utils";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionRadarChartProps {
  summary: GeneExpressionResponse["summary"];
  dataset: string;
}

export default function ExpressionRadarChart({ summary, dataset }: ExpressionRadarChartProps) {
  const { stages, maleValues, femaleValues } = resolveStageMeans(summary?.stage_means ?? null);

  const allValues = [...maleValues, ...femaleValues].filter(isValidNumber);
  const maxVal = allValues.length > 0 ? Math.max(...allValues) : 1;

  const hasData = stages.length > 0 && (maleValues.some(v => v > 0) || femaleValues.some(v => v > 0));

  if (!hasData) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Sex Comparison Radar: no stage means data available</Text>
      </Paper>
    );
  }

  const rMale = maleValues.map(v => (maxVal > 0 ? v / maxVal : 0));
  const rFemale = femaleValues.map(v => (maxVal > 0 ? v / maxVal : 0));

  const traces: any[] = [
    {
      type: "scatterpolar",
      r: rMale,
      theta: stages,
      name: "Male",
      fill: "toself",
      fillcolor: "rgba(34, 139, 230, 0.25)",
      line: { color: "#228BE6", width: 2 },
      marker: { size: 5 },
      text: maleValues.map(v => v.toFixed(2)),
      hovertemplate: "%{theta}: %{r:.2f} (raw: %{text})<extra>Male</extra>",
    },
    {
      type: "scatterpolar",
      r: rFemale,
      theta: stages,
      name: "Female",
      fill: "toself",
      fillcolor: "rgba(230, 73, 128, 0.25)",
      line: { color: "#E64980", width: 2 },
      marker: { size: 5 },
      text: femaleValues.map(v => v.toFixed(2)),
      hovertemplate: "%{theta}: %{r:.2f} (raw: %{text})<extra>Female</extra>",
    },
  ];

  const layout: any = {
    polar: {
      radialaxis: {
        visible: true,
        range: [0, 1],
        tickfont: { size: 8 },
        gridcolor: "#f0f0f0",
        title: { text: "Relative Expression", font: { size: 9 } },
      },
      angularaxis: { tickfont: { size: 9 }, gridcolor: "#f8f8f8" },
      bgcolor: "white",
    },
    showlegend: true,
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.1, font: { size: 9 } },
    margin: { t: 8, b: 8, l: 8, r: 8 },
    ...PAPER_STYLE,
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          Male vs Female Radar — {getDatasetDisplayName(dataset)}
        </Text>
        <Box w="100%">
          <Plot
            data={traces}
            layout={layout}
            config={PLOT_CONFIG}
            style={{ width: "100%", height: 300 }}
            useResizeHandler
          />
        </Box>
      </Stack>
    </Paper>
  );
}
