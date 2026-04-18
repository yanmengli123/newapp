/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Paper, Stack, Text } from "@mantine/core";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { GeneExpressionResponse } from "../../lib/geneApi";
import type { ResolvedChartStyle } from "./chartCustomizer.types";
import { isValidNumber, PLOT_CONFIG, PAPER_STYLE } from "./utils";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionFoldChangeBarProps {
  summary: GeneExpressionResponse["summary"];
  styleConfig?: ResolvedChartStyle;
}

export default function ExpressionFoldChangeBar({ summary, styleConfig }: ExpressionFoldChangeBarProps) {
  const fontSize = styleConfig?.fontSize ?? 10;
  const chartHeight = styleConfig?.chartHeight ?? 220;
  const showGrid = styleConfig?.showGrid ?? true;
  const showValueLabel = styleConfig?.chartSpecific?.showValueLabel ?? true;
  const barWidth = styleConfig?.chartSpecific?.barWidth ?? 0.6;
  const upColor = styleConfig?.colors?.up ?? "#12b886";
  const downColor = styleConfig?.colors?.down ?? "#fa5252";
  const gridColor = styleConfig?.colors?.grid ?? "#f0f0f0";
  const titleOverride = styleConfig?.title;

  const foldTop = summary?.fold_change_top;
  const foldBottom = summary?.fold_change_bottom;
  const topStage = summary?.top_stage;

  const hasData = (
    isValidNumber(foldTop) && foldTop > 0
  ) || (
    isValidNumber(foldBottom) && foldBottom > 0
  );

  if (!hasData) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Fold Change Bar: no fold change data available</Text>
      </Paper>
    );
  }

  const foldData: Array<{
    label: string;
    raw: number;
    log2: number;
    direction: "up" | "down";
  }> = [];

  if (isValidNumber(foldTop) && foldTop! > 0) {
    const raw = foldTop!;
    foldData.push({
      label: topStage && topStage !== "—" ? `Top (${topStage})` : "Top Stage",
      raw,
      log2: Math.log2(raw),
      direction: "up",
    });
  }

  if (isValidNumber(foldBottom) && foldBottom! > 0) {
    const raw = foldBottom!;
    foldData.push({
      label: "Bottom Stage",
      raw,
      log2: -Math.log2(raw), // negative for down
      direction: "down",
    });
  }

  const traces: any[] = [
    {
      type: "bar",
      x: foldData.map(d => d.label),
      y: foldData.map(d => d.log2),
      text: showValueLabel ? foldData.map(d => `${d.raw.toFixed(2)}x`) : undefined,
      textposition: showValueLabel ? "outside" : "none",
      textfont: { size: fontSize - 1, color: foldData.map(d => d.direction === "up" ? upColor : downColor) },
      marker: {
        color: foldData.map(d => d.direction === "up" ? upColor : downColor),
        opacity: 0.85,
        width: barWidth,
      },
      hovertemplate: "%{x}: %{text} (log2: %{y:.2f})<extra></extra>",
      orientation: "v" as const,
    },
  ];

  const layout: any = {
    margin: { t: 8, b: 52, l: 80, r: 16 },
    yaxis: {
      title: { text: "log2(Fold Change)", font: { size: fontSize } },
      gridcolor: showGrid ? gridColor : "transparent",
      zeroline: true,
      zerolinecolor: "#ccc",
      tickfont: { size: fontSize - 1 },
    },
    xaxis: { tickfont: { size: fontSize - 1 }, gridcolor: "transparent" },
    showlegend: false,
    ...PAPER_STYLE,
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          {titleOverride ?? "Fold Change (Max vs Min Stage)"}
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
