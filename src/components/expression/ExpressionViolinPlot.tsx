/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Paper, Stack, Text } from "@mantine/core";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { ExpressionSample } from "../../lib/geneApi";
import type { ResolvedChartStyle } from "./chartCustomizer.types";
import {
  groupSamplesByStageSex, sortStages,
  getDatasetDisplayName, getMetricLabel, PLOT_CONFIG, PAPER_STYLE,
} from "./utils";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionViolinPlotProps {
  samples: ExpressionSample[];
  dataset: string;
  metric: string;
  styleConfig?: ResolvedChartStyle;
}

export default function ExpressionViolinPlot({ samples, dataset, metric, styleConfig }: ExpressionViolinPlotProps) {
  const fontSize = styleConfig?.fontSize ?? 10;
  const chartHeight = styleConfig?.chartHeight ?? 280;
  const showLegend = styleConfig?.showLegend ?? true;
  const showGrid = styleConfig?.showGrid ?? true;
  const showPoints = styleConfig?.chartSpecific?.showPoints ?? true;
  const opacity = styleConfig?.chartSpecific?.opacity ?? 0.7;
  const maleColor = styleConfig?.colors?.male ?? "#228BE6";
  const femaleColor = styleConfig?.colors?.female ?? "#E64980";
  const gridColor = styleConfig?.colors?.grid ?? "#f0f0f0";
  const titleOverride = styleConfig?.title;

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
        points: showPoints ? (maleVals.length > 3 ? "all" : "all") : false,
        jitter: 0.25,
        marker: { color: maleColor, size: 4, opacity },
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
        points: showPoints ? (femaleVals.length > 3 ? "all" : "all") : false,
        jitter: 0.25,
        marker: { color: femaleColor, size: 4, opacity },
        hoverinfo: "y+name",
        span: [Math.min(...femaleVals) * 0.9, Math.max(...femaleVals) * 1.1],
      });
    }
  }

  const layout: any = {
    violinmode: "group",
    margin: { t: 8, b: 52, l: 56, r: 16 },
    yaxis: {
      title: { text: getMetricLabel(metric), font: { size: fontSize } },
      gridcolor: showGrid ? gridColor : "transparent",
      tickfont: { size: fontSize - 1 },
    },
    xaxis: {
      tickfont: { size: fontSize - 1 },
      gridcolor: "transparent",
    },
    showlegend: showLegend,
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.28, font: { size: fontSize - 1 } },
    boxpoints: showPoints ? "all" : false,
    ...PAPER_STYLE,
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          {titleOverride ?? `Expression Distribution — ${getDatasetDisplayName(dataset)}`}
        </Text>
        <Box w="100%">
          <Plot
            data={traces}
            layout={layout}
            config={PLOT_CONFIG}
            style={{ width: "100%", height: chartHeight }}
            useResizeHandler
          />
        </Box>
      </Stack>
    </Paper>
  );
}
