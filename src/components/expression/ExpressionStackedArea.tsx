/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Paper, Stack, Text } from "@mantine/core";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { GeneExpressionResponse } from "../../lib/geneApi";
import type { ResolvedChartStyle } from "./chartCustomizer.types";
import { resolveStageMeans, getDatasetDisplayName, getMetricLabel, PLOT_CONFIG, PAPER_STYLE } from "./utils";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionStackedAreaProps {
  summary: GeneExpressionResponse["summary"];
  dataset: string;
  metric: string;
  styleConfig?: ResolvedChartStyle;
}

export default function ExpressionStackedArea({ summary, dataset, metric, styleConfig }: ExpressionStackedAreaProps) {
  const fontSize = styleConfig?.fontSize ?? 10;
  const chartHeight = styleConfig?.chartHeight ?? 220;
  const showLegend = styleConfig?.showLegend ?? true;
  const showGrid = styleConfig?.showGrid ?? true;
  const showMeanLine = styleConfig?.chartSpecific?.showMeanLine ?? true;
  const areaOpacity = styleConfig?.chartSpecific?.opacity ?? 0.35;
  const maleColor = styleConfig?.colors?.male ?? "#228BE6";
  const femaleColor = styleConfig?.colors?.female ?? "#E64980";
  const gridColor = styleConfig?.colors?.grid ?? "#f0f0f0";
  const titleOverride = styleConfig?.title;

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

  // Helper to convert hex to rgba
  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const traces: any[] = [
    {
      type: "scatter",
      mode: "lines",
      x: stages,
      y: femaleValues,
      name: "Female",
      fill: "tozeroy",
      fillcolor: hexToRgba(femaleColor, areaOpacity),
      line: { color: femaleColor, width: 1.5 },
      hoverinfo: "x+y+name",
    },
    {
      type: "scatter",
      mode: "lines",
      x: stages,
      y: maleValues,
      name: "Male",
      fill: "tonexty",
      fillcolor: hexToRgba(maleColor, areaOpacity),
      line: { color: maleColor, width: 1.5 },
      hoverinfo: "x+y+name",
    },
    ...(showMeanLine ? [{
      type: "scatter" as const,
      mode: "lines+markers" as const,
      x: stages,
      y: meanValues,
      name: "Total Mean",
      line: { color: "#7950F2", width: 2, dash: "dot" },
      marker: { color: "#7950F2", size: 6 },
      yaxis: "y2",
    }] : []),
  ];

  const layout: any = {
    margin: { t: 8, b: 48, l: 56, r: 32 },
    xaxis: { tickfont: { size: fontSize - 1 }, gridcolor: "transparent" },
    yaxis: {
      title: { text: getMetricLabel(metric), font: { size: fontSize } },
      gridcolor: showGrid ? gridColor : "transparent",
      tickfont: { size: fontSize - 1 },
      domain: [0, 0.85],
    },
    yaxis2: {
      title: { text: "Mean (dot)", font: { size: fontSize, color: "#7950F2" } },
      anchor: "free",
      side: "right",
      overlaying: "y",
      position: 0.98,
      domain: [0, 1],
      tickfont: { size: fontSize - 1, color: "#7950F2" },
      gridcolor: showGrid ? gridColor : "transparent",
    },
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.22, font: { size: fontSize - 1 } },
    hovermode: "x unified",
    showlegend: showLegend,
    ...PAPER_STYLE,
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          {titleOverride ?? `Stacked Area — ${getDatasetDisplayName(dataset)}`}
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
