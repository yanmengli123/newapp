/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Paper, Stack, Text } from "@mantine/core";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { ExpressionSample } from "../../lib/geneApi";
import type { ResolvedChartStyle } from "./chartCustomizer.types";
import {
  groupSamplesByStageSex, sortStages, isValidNumber,
  getDatasetDisplayName, PLOT_CONFIG, PAPER_STYLE,
} from "./utils";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionDendrogramProps {
  samples: ExpressionSample[];
  dataset: string;
  styleConfig?: ResolvedChartStyle;
}

export default function ExpressionDendrogram({ samples, dataset, styleConfig }: ExpressionDendrogramProps) {
  const fontSize = styleConfig?.fontSize ?? 10;
  const chartHeight = styleConfig?.chartHeight ?? 200;
  const showLegend = styleConfig?.showLegend ?? true;
  const showGrid = styleConfig?.showGrid ?? true;
  const pointSize = styleConfig?.chartSpecific?.pointSize ?? 8;
  const showLabels = styleConfig?.chartSpecific?.showLabels ?? true;
  const maleColor = styleConfig?.colors?.male ?? "#228BE6";
  const femaleColor = styleConfig?.colors?.female ?? "#E64980";
  const gridColor = styleConfig?.colors?.grid ?? "#f0f0f0";
  const titleOverride = styleConfig?.title;

  const grouped = groupSamplesByStageSex(samples);
  const stages = sortStages(Object.keys(grouped));

  let groupCount = 0;
  for (const stage of stages) {
    if (grouped[stage].male.length > 0) groupCount++;
    if (grouped[stage].female.length > 0) groupCount++;
  }

  if (groupCount < 2) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Sample Clustering: need at least 2 stage/sex groups</Text>
      </Paper>
    );
  }

  // Build per-group mean values
  const maleData: { stage: string; mean: number; count: number }[] = [];
  const femaleData: { stage: string; mean: number; count: number }[] = [];

  for (const stage of stages) {
    const maleVals = grouped[stage].male.filter(isValidNumber);
    const femaleVals = grouped[stage].female.filter(isValidNumber);

    if (maleVals.length > 0) {
      maleData.push({
        stage,
        mean: maleVals.reduce((a, b) => a + b, 0) / maleVals.length,
        count: maleVals.length,
      });
    }
    if (femaleVals.length > 0) {
      femaleData.push({
        stage,
        mean: femaleVals.reduce((a, b) => a + b, 0) / femaleVals.length,
        count: femaleVals.length,
      });
    }
  }

  // Use stage index for x positions
  const STAGE_X: Record<string, number> = {};
  stages.forEach((s, i) => { STAGE_X[s] = i; });

  // Hover text
  const hoverMale = maleData.map(d =>
    `<b>${d.stage} Male</b><br>Mean: ${d.mean.toFixed(3)}<br>n = ${d.count}`
  );
  const hoverFemale = femaleData.map(d =>
    `<b>${d.stage} Female</b><br>Mean: ${d.mean.toFixed(3)}<br>n = ${d.count}`
  );

  const traces: any[] = [
    // Male — line + scatter
    {
      type: "scatter",
      mode: showLabels ? "lines+markers" : "lines",
      x: maleData.map(d => STAGE_X[d.stage]),
      y: maleData.map(d => d.mean),
      line: { color: maleColor, width: 1.5, dash: "solid" },
      marker: { color: maleColor, size: pointSize, symbol: "circle" },
      text: hoverMale,
      hovertemplate: "%{text}<extra>Male</extra>",
      name: "Male",
    },
    // Female — line + scatter
    {
      type: "scatter",
      mode: showLabels ? "lines+markers" : "lines",
      x: femaleData.map(d => STAGE_X[d.stage]),
      y: femaleData.map(d => d.mean),
      line: { color: femaleColor, width: 1.5, dash: "solid" },
      marker: { color: femaleColor, size: pointSize, symbol: "circle" },
      text: hoverFemale,
      hovertemplate: "%{text}<extra>Female</extra>",
      name: "Female",
    },
  ];

  const layout: any = {
    margin: { t: 8, b: 52, l: 56, r: 16 },
    xaxis: {
      tickmode: "array",
      tickvals: stages.map((_, i) => i),
      ticktext: stages,
      tickfont: { size: fontSize - 1 },
      title: { text: "Stage", font: { size: fontSize } },
      gridcolor: showGrid ? gridColor : "transparent",
      showgrid: showGrid,
      dtick: 1,
    },
    yaxis: {
      title: { text: "Mean Expression", font: { size: fontSize } },
      gridcolor: showGrid ? gridColor : "transparent",
      tickfont: { size: fontSize - 1 },
      zeroline: false,
    },
    showlegend: showLegend,
    legend: {
      orientation: "h",
      x: 0.5, xanchor: "center", y: -0.22,
      font: { size: fontSize - 1 },
    },
    hovermode: "closest" as const,
    ...PAPER_STYLE,
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          {titleOverride ?? `Sample Clustering by Stage/Sex — ${getDatasetDisplayName(dataset)}`}
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
