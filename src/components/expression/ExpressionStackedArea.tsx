/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Paper, Stack, Text } from "@mantine/core";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { GeneExpressionResponse } from "../../lib/geneApi";
import { resolveStageMeans, getDatasetDisplayName, getMetricLabel, PLOT_CONFIG, PAPER_STYLE } from "./utils";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionStackedAreaProps {
  summary: GeneExpressionResponse["summary"];
  dataset: string;
  metric: string;
}

export default function ExpressionStackedArea({ summary, dataset, metric }: ExpressionStackedAreaProps) {
  const { stages, maleValues, femaleValues, meanValues } = resolveStageMeans(summary?.stage_means ?? null);

  const hasData = stages.length > 0 && (
    maleValues.some(v => v > 0) || femaleValues.some(v => v > 0) || meanValues.some(v => v > 0)
  );

  if (!hasData) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Stacked Area: no stage means data available</Text>
      </Paper>
    );
  }

  const traces: any[] = [
    {
      type: "scatter",
      mode: "lines",
      x: stages,
      y: femaleValues,
      name: "Female",
      fill: "tozeroy",
      fillcolor: "rgba(230, 73, 128, 0.35)",
      line: { color: "#E64980", width: 1.5 },
      hoverinfo: "x+y+name",
    },
    {
      type: "scatter",
      mode: "lines",
      x: stages,
      y: maleValues,
      name: "Male",
      fill: "tonexty",
      fillcolor: "rgba(34, 139, 230, 0.35)",
      line: { color: "#228BE6", width: 1.5 },
      hoverinfo: "x+y+name",
    },
    {
      type: "scatter",
      mode: "lines+markers",
      x: stages,
      y: meanValues,
      name: "Total Mean",
      line: { color: "#7950F2", width: 2, dash: "dot" },
      marker: { color: "#7950F2", size: 6 },
      yaxis: "y2",
    },
  ];

  const layout: any = {
    margin: { t: 8, b: 48, l: 56, r: 32 },
    xaxis: { tickfont: { size: 9 }, gridcolor: "#f8f8f8" },
    yaxis: {
      title: { text: getMetricLabel(metric), font: { size: 10 } },
      gridcolor: "#f0f0f0",
      tickfont: { size: 9 },
      domain: [0, 0.85],
    },
    yaxis2: {
      title: { text: "Mean (dot)", font: { size: 10, color: "#7950F2" } },
      anchor: "free",
      side: "right",
      overlaying: "y",
      position: 0.98,
      domain: [0, 1],
      tickfont: { size: 9, color: "#7950F2" },
      gridcolor: "#f0f0f0",
    },
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.22, font: { size: 9 } },
    hovermode: "x unified",
    showlegend: true,
    ...PAPER_STYLE,
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          Stacked Area — {getDatasetDisplayName(dataset)}
        </Text>
        <Box w="100%">
          <Plot
            data={traces}
            layout={layout}
            config={PLOT_CONFIG}
            style={{ width: "100%", height: 220 }}
            useResizeHandler
          />
        </Box>
      </Stack>
    </Paper>
  );
}
