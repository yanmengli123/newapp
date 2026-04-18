/* eslint-disable @typescript-eslint/no-explicit-any */
import { ActionIcon, Box, Group, Paper, Stack, Text } from "@mantine/core";
import { IconMaximize } from "@tabler/icons-react";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { GeneExpressionResponse } from "../../lib/geneApi";
import type { ResolvedChartStyle } from "./chartCustomizer.types";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionStageChartProps {
  summary: GeneExpressionResponse["summary"];
  dataset: string;
  metric: string;
  styleConfig?: ResolvedChartStyle;
  renderMode?: "card" | "fullscreen";
  onOpenFullscreen?: () => void;
}

const DATASET_DISPLAY_NAMES: Record<string, string> = {
  day_deseq2_36: "DESeq2 NC — 36 发育阶段样本",
  raw_ballgown_36: "Ballgown TPM/FPKM — 36 发育阶段样本",
  esc_srr_23: "ESC SRR Runs — 23 个 SRA Runs",
};

function getDatasetDisplayName(code: string): string {
  return DATASET_DISPLAY_NAMES[code] ?? code;
}

function isValidNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function resolveStageMeans(
  stageMeans: Record<string, Record<string, number> | number | null> | null | undefined
): {
  stages: string[];
  maleValues: number[];
  femaleValues: number[];
  meanValues: number[];
} {
  if (!stageMeans || typeof stageMeans !== "object") {
    return { stages: [], maleValues: [], femaleValues: [], meanValues: [] };
  }

  const STAGE_ORDER = ["E0", "E3.5", "E7", "E11", "E14", "E18.5", "P0", "Adult"];

  const entries = Object.entries(stageMeans as Record<string, unknown>);
  entries.sort(([a], [b]) => {
    const ai = STAGE_ORDER.indexOf(a);
    const bi = STAGE_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const stages: string[] = [];
  const maleValues: number[] = [];
  const femaleValues: number[] = [];
  const meanValues: number[] = [];

  for (const [stage, val] of entries) {
    if (!stage) continue;
    stages.push(stage);

    if (val != null && typeof val === "object") {
      const obj = val as Record<string, unknown>;
      maleValues.push(isValidNumber(obj["male"]) ? (obj["male"] as number) : 0);
      femaleValues.push(isValidNumber(obj["female"]) ? (obj["female"] as number) : 0);
      const meanVal = isValidNumber(obj["mean"])
        ? (obj["mean"] as number)
        : Object.values(obj).find(isValidNumber) ?? 0;
      meanValues.push(meanVal);
    } else if (isValidNumber(val)) {
      maleValues.push(0);
      femaleValues.push(0);
      meanValues.push(val);
    } else {
      maleValues.push(0);
      femaleValues.push(0);
      meanValues.push(0);
    }
  }

  return { stages, maleValues, femaleValues, meanValues };
}

export default function ExpressionStageChart({
  summary,
  dataset,
  metric,
  styleConfig,
  renderMode,
  onOpenFullscreen,
}: ExpressionStageChartProps) {
  const { stages, maleValues, femaleValues, meanValues } = resolveStageMeans(summary?.stage_means ?? null);

  // Resolve style config with defaults
  const fontSize = styleConfig?.fontSize ?? 10;
  const chartHeight = styleConfig?.chartHeight ?? 220;
  const showLegend = styleConfig?.showLegend ?? true;
  const showGrid = styleConfig?.showGrid ?? true;
  const showMeanLine = styleConfig?.chartSpecific?.showMeanLine ?? true;
  const showValueLabel = styleConfig?.chartSpecific?.showValueLabel ?? false;
  const maleColor = styleConfig?.colors?.male ?? "#228BE6";
  const femaleColor = styleConfig?.colors?.female ?? "#E64980";
  const gridColor = styleConfig?.colors?.grid ?? "#f0f0f0";
  const titleOverride = styleConfig?.title;

  const hasData = stages.length > 0 && (
    maleValues.some(v => v > 0) ||
    femaleValues.some(v => v > 0) ||
    meanValues.some(v => v > 0)
  );

  if (!hasData) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Stage means chart: no data available</Text>
      </Paper>
    );
  }

  const traces: any[] = [
    {
      x: stages,
      y: maleValues.map(v => isValidNumber(v) ? v : 0),
      name: "Male",
      type: "bar",
      marker: { color: maleColor, opacity: 0.85 },
      text: showValueLabel ? maleValues.map(v => (isValidNumber(v) ? v : 0).toFixed(2)) : undefined,
      textposition: showValueLabel ? "outside" : "none",
      textfont: { size: fontSize - 1, color: maleColor },
    },
    {
      x: stages,
      y: femaleValues.map(v => isValidNumber(v) ? v : 0),
      name: "Female",
      type: "bar",
      marker: { color: femaleColor, opacity: 0.85 },
      text: showValueLabel ? femaleValues.map(v => (isValidNumber(v) ? v : 0).toFixed(2)) : undefined,
      textposition: showValueLabel ? "outside" : "none",
      textfont: { size: fontSize - 1, color: femaleColor },
    },
    ...(showMeanLine ? [{
      x: stages,
      y: meanValues.map(v => isValidNumber(v) ? v : 0),
      name: "Total Mean",
      type: "scatter" as const,
      mode: "lines+markers" as const,
      line: { color: "#7950F2", width: 2, dash: "dot" },
      marker: { color: "#7950F2", size: 7 },
      yaxis: "y2",
    }] : []),
  ];

  const layout: any = {
    barmode: "group",
    margin: { t: 8, b: 48, l: 56, r: 16 },
    yaxis: {
      title: { text: metric === "tpm" || metric === "fpkm" ? metric.toUpperCase() : "Normalized Count", font: { size: fontSize } },
      gridcolor: showGrid ? gridColor : "transparent",
      tickfont: { size: fontSize - 1 },
      domain: [0, 0.72],
    },
    yaxis2: {
      title: { text: "Mean (dot)", font: { size: fontSize, color: "#7950F2" } },
      gridcolor: showGrid ? gridColor : "transparent",
      tickfont: { size: fontSize - 1, color: "#7950F2" },
      anchor: "free",
      side: "right",
      overlaying: "y",
      position: 0.98,
      domain: [0, 1],
    },
    xaxis: {
      tickfont: { size: fontSize - 1 },
      gridcolor: "transparent",
    },
    legend: {
      orientation: "h",
      x: 0.5,
      xanchor: "center",
      y: -0.22,
      font: { size: fontSize - 1 },
    },
    font: { family: "sans-serif", size: fontSize },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    showlegend: showLegend,
    hovermode: "x unified",
  };

  const config: any = {
    displayModeBar: renderMode === "fullscreen",
    responsive: true,
    locale: "en",
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Text size="xs" fw={600} c="dimmed">
            {titleOverride ?? `Stage Means — ${getDatasetDisplayName(dataset)}`}
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
            config={config}
            style={{ width: "100%", height: chartHeight }}
            useResizeHandler
          />
        </Box>
      </Stack>
    </Paper>
  );
}
