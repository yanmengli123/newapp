/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Paper, Stack, Text } from "@mantine/core";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { ExpressionSample } from "../../lib/geneApi";
import {
  groupSamplesByStageSex, sortStages, isValidNumber,
  getDatasetDisplayName, PLOT_CONFIG, PAPER_STYLE,
} from "./utils";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionDendrogramProps {
  samples: ExpressionSample[];
  dataset: string;
}

export default function ExpressionDendrogram({ samples, dataset }: ExpressionDendrogramProps) {
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

  // Marker sizes proportional to replicate count (within reasonable range)
  const sizeMale = maleData.map(d => Math.min(6 + d.count * 3, 18));
  const sizeFemale = femaleData.map(d => Math.min(6 + d.count * 3, 18));

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
      mode: "lines+markers",
      x: maleData.map(d => STAGE_X[d.stage]),
      y: maleData.map(d => d.mean),
      line: { color: "#228BE6", width: 1.5, dash: "solid" },
      marker: { color: "#228BE6", size: sizeMale, symbol: "circle" },
      text: hoverMale,
      hovertemplate: "%{text}<extra>Male</extra>",
      name: "Male",
    },
    // Female — line + scatter
    {
      type: "scatter",
      mode: "lines+markers",
      x: femaleData.map(d => STAGE_X[d.stage]),
      y: femaleData.map(d => d.mean),
      line: { color: "#E64980", width: 1.5, dash: "solid" },
      marker: { color: "#E64980", size: sizeFemale, symbol: "circle" },
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
      tickfont: { size: 9 },
      title: { text: "Stage", font: { size: 10 } },
      gridcolor: "#f8f8f8",
      showgrid: true,
      dtick: 1,
    },
    yaxis: {
      title: { text: "Mean Expression", font: { size: 10 } },
      gridcolor: "#f0f0f0",
      tickfont: { size: 9 },
      zeroline: false,
    },
    showlegend: true,
    legend: {
      orientation: "h",
      x: 0.5, xanchor: "center", y: -0.22,
      font: { size: 9 },
    },
    hovermode: "closest" as const,
    ...PAPER_STYLE,
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          Sample Clustering by Stage/Sex — {getDatasetDisplayName(dataset)}
        </Text>
        <Box w="100%">
          <Plot
            data={traces}
            layout={layout}
            config={PLOT_CONFIG}
            style={{ width: "100%", height: 200 }}
            useResizeHandler
          />
        </Box>
      </Stack>
    </Paper>
  );
}
