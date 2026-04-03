/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Paper, Stack, Text } from "@mantine/core";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { ExpressionSample } from "../../lib/geneApi";
import {
  groupSamplesByStageSex, sortStages,
  getDatasetDisplayName, getMetricLabel, PLOT_CONFIG, PAPER_STYLE,
} from "./utils";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionViolinPlotProps {
  samples: ExpressionSample[];
  dataset: string;
  metric: string;
}

export default function ExpressionViolinPlot({ samples, dataset, metric }: ExpressionViolinPlotProps) {
  const grouped = groupSamplesByStageSex(samples);
  const stages = sortStages(Object.keys(grouped));

  // Count usable (stage, sex) groups with at least 1 point
  let usableCount = 0;
  for (const stage of stages) {
    if (grouped[stage].male.length > 0) usableCount++;
    if (grouped[stage].female.length > 0) usableCount++;
  }

  if (usableCount < 2) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Expression Distribution: insufficient replicate data (need ≥2 stage groups with values)</Text>
      </Paper>
    );
  }

  const traces: any[] = [];

  for (const stage of stages) {
    const maleVals = grouped[stage].male;
    const femaleVals = grouped[stage].female;

    if (maleVals.length > 0) {
      traces.push({
        type: "violin",
        y: maleVals,
        x: Array(maleVals.length).fill(stage),
        name: `${stage} Male`,
        box: { visible: true },
        meanline: { visible: true },
        points: maleVals.length > 3 ? "all" : "all",
        jitter: 0.25,
        marker: { color: "#228BE6", size: 4, opacity: 0.7 },
        hoverinfo: "y+name",
        span: [Math.min(...maleVals) * 0.9, Math.max(...maleVals) * 1.1],
      });
    }

    if (femaleVals.length > 0) {
      traces.push({
        type: "violin",
        y: femaleVals,
        x: Array(femaleVals.length).fill(stage),
        name: `${stage} Female`,
        box: { visible: true },
        meanline: { visible: true },
        points: femaleVals.length > 3 ? "all" : "all",
        jitter: 0.25,
        marker: { color: "#E64980", size: 4, opacity: 0.7 },
        hoverinfo: "y+name",
        span: [Math.min(...femaleVals) * 0.9, Math.max(...femaleVals) * 1.1],
      });
    }
  }

  const layout: any = {
    violinmode: "group",
    margin: { t: 8, b: 52, l: 56, r: 16 },
    yaxis: {
      title: { text: getMetricLabel(metric), font: { size: 10 } },
      gridcolor: "#f0f0f0",
      tickfont: { size: 9 },
    },
    xaxis: {
      tickfont: { size: 9 },
      gridcolor: "#f8f8f8",
    },
    showlegend: true,
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.28, font: { size: 9 } },
    boxpoints: "all",
    ...PAPER_STYLE,
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          Expression Distribution — {getDatasetDisplayName(dataset)}
        </Text>
        <Box w="100%">
          <Plot
            data={traces}
            layout={layout}
            config={PLOT_CONFIG}
            style={{ width: "100%", height: 280 }}
            useResizeHandler
          />
        </Box>
      </Stack>
    </Paper>
  );
}
