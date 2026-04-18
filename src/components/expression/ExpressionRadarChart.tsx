/* eslint-disable @typescript-eslint/no-explicit-any */
import { ActionIcon, Box, Group, Paper, Stack, Text } from "@mantine/core";
import { IconMaximize } from "@tabler/icons-react";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { GeneExpressionResponse } from "../../lib/geneApi";
import type { ResolvedChartStyle } from "./chartCustomizer.types";
import { resolveStageMeans, getDatasetDisplayName, PLOT_CONFIG, PAPER_STYLE, isValidNumber } from "./utils";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionRadarChartProps {
  summary: GeneExpressionResponse["summary"];
  dataset: string;
  styleConfig?: ResolvedChartStyle;
  renderMode?: "card" | "fullscreen";
  onOpenFullscreen?: () => void;
}

export default function ExpressionRadarChart({ summary, dataset, styleConfig, renderMode, onOpenFullscreen }: ExpressionRadarChartProps) {
  const fontSize = styleConfig?.fontSize ?? 10;
  const chartHeight = styleConfig?.chartHeight ?? 300;
  const showLegend = styleConfig?.showLegend ?? true;
  const fillOpacity = styleConfig?.chartSpecific?.fillOpacity ?? 0.25;
  const maleColor = styleConfig?.colors?.male ?? "#228BE6";
  const femaleColor = styleConfig?.colors?.female ?? "#E64980";
  const titleOverride = styleConfig?.title;

  const { stages, maleValues, femaleValues } = resolveStageMeans(summary?.stage_means ?? null);

  const allValues = [...maleValues, ...femaleValues].filter(isValidNumber);
  const maxVal = allValues.length > 0 ? Math.max(...allValues) : 1;

  // Helper for rgba
  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

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
      fillcolor: hexToRgba(maleColor, fillOpacity),
      line: { color: maleColor, width: 2 },
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
      fillcolor: hexToRgba(femaleColor, fillOpacity),
      line: { color: femaleColor, width: 2 },
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
        tickfont: { size: fontSize - 2 },
        gridcolor: "#f0f0f0",
        title: { text: "Relative Expression", font: { size: fontSize - 1 } },
      },
      angularaxis: { tickfont: { size: fontSize - 1 }, gridcolor: "#f8f8f8" },
      bgcolor: "white",
    },
    showlegend: showLegend,
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.1, font: { size: fontSize - 1 } },
    margin: { t: 8, b: 8, l: 8, r: 8 },
    ...PAPER_STYLE,
  };

  const plotConfig = renderMode === "fullscreen"
    ? { displayModeBar: true, responsive: true, locale: "en" }
    : PLOT_CONFIG;

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Text size="xs" fw={600} c="dimmed">
            {titleOverride ?? `Male vs Female Radar — ${getDatasetDisplayName(dataset)}`}
          </Text>
          {renderMode !== "fullscreen" && onOpenFullscreen && (
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={onOpenFullscreen}>
              <IconMaximize size={14} />
            </ActionIcon>
          )}
        </Group>
        <Box w="100%">
          <Plot
            data={traces}
            layout={layout}
            config={plotConfig}
            style={{ width: "100%", height: chartHeight }}
            useResizeHandler
          />
        </Box>
      </Stack>
    </Paper>
  );
}
