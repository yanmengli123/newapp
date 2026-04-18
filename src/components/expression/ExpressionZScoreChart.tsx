/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Paper, Stack, Text } from "@mantine/core";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { ExpressionSample } from "../../lib/geneApi";
import type { ResolvedChartStyle } from "./chartCustomizer.types";
import { normalizeSex, isValidNumber, getDatasetDisplayName, PLOT_CONFIG, PAPER_STYLE } from "./utils";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionZScoreChartProps {
  samples: ExpressionSample[];
  dataset: string;
  styleConfig?: ResolvedChartStyle;
}

export default function ExpressionZScoreChart({ samples, dataset, styleConfig }: ExpressionZScoreChartProps) {
  const fontSize = styleConfig?.fontSize ?? 10;
  const chartHeight = styleConfig?.chartHeight ?? 220;
  const showLegend = styleConfig?.showLegend ?? true;
  const showGrid = styleConfig?.showGrid ?? true;
  const lineWidth = styleConfig?.chartSpecific?.lineWidth ?? 2;
  const markerSize = styleConfig?.chartSpecific?.markerSize ?? 6;
  const maleColor = styleConfig?.colors?.male ?? "#228BE6";
  const femaleColor = styleConfig?.colors?.female ?? "#E64980";
  const neutralColor = styleConfig?.colors?.neutral ?? "#7950F6";
  const gridColor = styleConfig?.colors?.grid ?? "#f0f0f0";
  const titleOverride = styleConfig?.title;

  // Filter samples with valid z_score
  const validSamples = samples
    .filter(s => isValidNumber(s.z_score))
    .sort((a, b) => {
      const sa = a.stage_order ?? 99;
      const sb = b.stage_order ?? 99;
      if (sa !== sb) return sa - sb;
      const sexA = a.sex === "Male" ? 0 : a.sex === "Female" ? 1 : 2;
      const sexB = b.sex === "Male" ? 0 : b.sex === "Female" ? 1 : 2;
      return sexA - sexB;
    });

  if (validSamples.length === 0) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Z-Score Profile: no z-score data available</Text>
      </Paper>
    );
  }

  const labels = validSamples.map(s => {
    const sexChar = normalizeSex(s.sex) === "Male" ? "M" : normalizeSex(s.sex) === "Female" ? "F" : "?";
    const rep = s.replicate != null ? `R${s.replicate}` : "";
    return `${s.stage}${rep}(${sexChar})`;
  });

  const zScores = validSamples.map(s => s.z_score!);

  // Split into Male / Female traces for clarity
  const maleIdx: number[] = [];
  const femaleIdx: number[] = [];
  validSamples.forEach((s, i) => {
    if (normalizeSex(s.sex) === "Male") maleIdx.push(i);
    else if (normalizeSex(s.sex) === "Female") femaleIdx.push(i);
  });

  const traces: any[] = [
    {
      type: "scatter",
      mode: "lines+markers",
      x: labels,
      y: zScores,
      name: "All",
      line: { color: neutralColor, width: 0.8, dash: "dot" },
      marker: { color: neutralColor, size: 4, opacity: 0.4 },
      text: validSamples.map(s =>
        `${s.sample_name ?? s.stage}\nz = ${s.z_score!.toFixed(3)}`
      ),
      hovertemplate: "%{text}<extra>Sample</extra>",
    },
  ];

  if (maleIdx.length > 0 && femaleIdx.length > 0) {
    traces.push({
      type: "scatter",
      mode: "lines+markers",
      x: maleIdx.map(i => labels[i]),
      y: maleIdx.map(i => zScores[i]),
      name: "Male",
      line: { color: maleColor, width: lineWidth },
      marker: { color: maleColor, size: markerSize },
      text: maleIdx.map(i =>
        `${validSamples[i].sample_name}\nz = ${zScores[i].toFixed(3)}`
      ),
      hovertemplate: "%{text}<extra>Male</extra>",
    });
    traces.push({
      type: "scatter",
      mode: "lines+markers",
      x: femaleIdx.map(i => labels[i]),
      y: femaleIdx.map(i => zScores[i]),
      name: "Female",
      line: { color: femaleColor, width: lineWidth },
      marker: { color: femaleColor, size: markerSize },
      text: femaleIdx.map(i =>
        `${validSamples[i].sample_name}\nz = ${zScores[i].toFixed(3)}`
      ),
      hovertemplate: "%{text}<extra>Female</extra>",
    });
  }

  const layout: any = {
    margin: { t: 8, b: 56, l: 56, r: 16 },
    xaxis: {
      tickangle: -40,
      tickfont: { size: fontSize - 2 },
      gridcolor: "transparent",
      dtick: 1,
    },
    yaxis: {
      title: { text: "Z-Score", font: { size: fontSize } },
      gridcolor: showGrid ? gridColor : "transparent",
      tickfont: { size: fontSize - 1 },
      zeroline: true,
      zerolinecolor: "#ccc",
      zerolinewidth: 1,
    },
    legend: {
      orientation: "h" as const,
      x: 0.5, xanchor: "center" as const,
      y: -0.3,
      font: { size: fontSize - 1 },
    },
    font: { family: "sans-serif", size: fontSize },
    showlegend: showLegend && maleIdx.length > 0 && femaleIdx.length > 0,
    hovermode: "closest" as const,
    ...PAPER_STYLE,
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          {titleOverride ?? `Z-Score Profile — ${getDatasetDisplayName(dataset)}`}
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
