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

  const STAGE_X: Record<string, number> = {};
  stages.forEach((s, i) => { STAGE_X[s] = i; });

  // Scatter traces: Male circles, Female diamonds
  const traces: any[] = [
    {
      type: "scatter",
      mode: "markers+text",
      x: maleData.map(d => STAGE_X[d.stage]),
      y: maleData.map(d => d.mean),
      text: maleData.map(d => `${d.stage} Male\n${d.mean.toFixed(2)} (n=${d.count})`),
      textposition: "top center",
      textfont: { size: 8, color: "#228BE6" },
      marker: {
        color: "#228BE6",
        size: maleData.map(d => Math.min(6 + d.count * 2, 18)),
        symbol: "circle",
        opacity: 0.8,
      },
      name: "Male",
      hovertemplate: "%{text}<extra>Male</extra>",
    },
    {
      type: "scatter",
      mode: "markers+text",
      x: femaleData.map(d => STAGE_X[d.stage]),
      y: femaleData.map(d => d.mean),
      text: femaleData.map(d => `${d.stage} Female\n${d.mean.toFixed(2)} (n=${d.count})`),
      textposition: "bottom center",
      textfont: { size: 8, color: "#E64980" },
      marker: {
        color: "#E64980",
        size: femaleData.map(d => Math.min(6 + d.count * 2, 18)),
        symbol: "diamond",
        opacity: 0.8,
      },
      name: "Female",
      hovertemplate: "%{text}<extra>Female</extra>",
    },
    // Connect male points within same stage group
    {
      type: "scatter",
      mode: "lines",
      x: maleData.map(d => STAGE_X[d.stage]),
      y: maleData.map(d => d.mean),
      line: { color: "#228BE6", width: 1, dash: "dot" },
      opacity: 0.4,
      showlegend: false,
      hoverinfo: "skip",
    },
    // Connect female points
    {
      type: "scatter",
      mode: "lines",
      x: femaleData.map(d => STAGE_X[d.stage]),
      y: femaleData.map(d => d.mean),
      line: { color: "#E64980", width: 1, dash: "dot" },
      opacity: 0.4,
      showlegend: false,
      hoverinfo: "skip",
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
    },
    yaxis: {
      title: { text: "Mean Expression", font: { size: 10 } },
      gridcolor: "#f0f0f0",
      tickfont: { size: 9 },
      zeroline: false,
    },
    showlegend: true,
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.22, font: { size: 9 } },
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
