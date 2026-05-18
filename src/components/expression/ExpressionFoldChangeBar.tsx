/* eslint-disable @typescript-eslint/no-explicit-any */
import { ActionIcon, Box, Group, Paper, Stack, Text } from "@mantine/core";
import { IconMaximize } from "@tabler/icons-react";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { GeneExpressionResponse } from "../../lib/geneApi";
import type { ResolvedChartStyle } from "./chartCustomizer.types";
import { isValidNumber, PLOT_CONFIG, PAPER_STYLE } from "./utils";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionFoldChangeBarProps {
  summary: GeneExpressionResponse["summary"];
  styleConfig?: ResolvedChartStyle;
  renderMode?: "card" | "fullscreen";
  onOpenFullscreen?: () => void;
}

export default function ExpressionFoldChangeBar({ summary, styleConfig, renderMode, onOpenFullscreen }: ExpressionFoldChangeBarProps) {
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

  // DB already stores log2 fold change values
  const hasData = isValidNumber(foldTop) || isValidNumber(foldBottom);

  if (!hasData) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Fold Change Bar: no fold change data available</Text>
      </Paper>
    );
  }

  const foldData: Array<{
    label: string;
    log2Value: number;
    displayValue: number;
    direction: "up" | "down";
  }> = [];

  if (isValidNumber(foldTop)) {
    // fold_change_top is already log2(max/mean), always positive
    foldData.push({
      label: topStage && topStage !== "—" ? `Top (${topStage})` : "Top Stage",
      log2Value: foldTop!,
      displayValue: Math.pow(2, foldTop!), // convert back to raw ratio for display
      direction: "up",
    });
  }

  if (isValidNumber(foldBottom)) {
    if (foldBottom! === -999) {
      // Special case: min value is 0, cannot compute log2
      foldData.push({
        label: "Bottom Stage",
        log2Value: -999,
        displayValue: 0,
        direction: "down",
      });
    } else if (foldBottom! < 0) {
      // fold_change_bottom is log2(min/mean), negative means down-regulation
      foldData.push({
        label: "Bottom Stage",
        log2Value: foldBottom!,
        displayValue: Math.pow(2, foldBottom!), // convert back to raw ratio for display
        direction: "down",
      });
    }
  }

  const traces: any[] = [
    {
      type: "bar",
      x: foldData.map(d => d.label),
      y: foldData.map(d => d.log2Value === -999 ? -10 : d.log2Value), // cap -999 at -10 for display
      text: showValueLabel ? foldData.map(d =>
        d.log2Value === -999 ? "0x" : `${d.displayValue.toFixed(2)}x`
      ) : undefined,
      textposition: showValueLabel ? "outside" : "none",
      textfont: { size: fontSize - 1, color: foldData.map(d => d.direction === "up" ? upColor : downColor) },
      marker: {
        color: foldData.map(d => d.direction === "up" ? upColor : downColor),
        opacity: 0.85,
        width: barWidth,
      },
      hovertemplate: foldData.map(d =>
        d.log2Value === -999
          ? "%{x}: Zero expression<extra></extra>"
          : "%{x}: %{text} (log2: %{y:.2f})<extra></extra>"
      ),
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

  const plotConfig = renderMode === "fullscreen"
    ? { displayModeBar: true, responsive: true, locale: "en" }
    : PLOT_CONFIG;

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Text size="xs" fw={600} c="dimmed">
            {titleOverride ?? "Fold Change (Stage vs Mean)"}
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
