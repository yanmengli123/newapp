/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Paper, Stack, Text } from "@mantine/core";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { ExpressionSample } from "../../lib/geneApi";
import type { ResolvedChartStyle } from "./chartCustomizer.types";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionLineChartProps {
  samples: ExpressionSample[];
  dataset: string;
  metric: string;
  styleConfig?: ResolvedChartStyle;
}

function isValidNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

const DATASET_DISPLAY_NAMES: Record<string, string> = {
  day_deseq2_36: "DESeq2 NC — 36 发育阶段样本",
  raw_ballgown_36: "Ballgown TPM/FPKM — 36 发育阶段样本",
  esc_srr_23: "ESC SRR Runs — 23 个 SRA Runs",
};

function getDatasetDisplayName(code: string): string {
  return DATASET_DISPLAY_NAMES[code] ?? code;
}

function normalizeSex(sex: string | null | undefined): "Male" | "Female" | null {
  if (sex === "Male" || sex === "M" || sex === "m") return "Male";
  if (sex === "Female" || sex === "F" || sex === "f") return "Female";
  return null;
}

function safeLabel(s: ExpressionSample): string {
  if (!s) return "?";
  const stage = s.stage && s.stage.trim() ? s.stage.trim() : "?";
  const sexEnum = normalizeSex(s.sex);
  const sexChar = sexEnum === "Male" ? "M" : sexEnum === "Female" ? "F" : "?";
  const rep =
    s.replicate != null && Number.isFinite(s.replicate) && s.replicate > 0
      ? `R${s.replicate}`
      : "";
  return rep ? `${stage}(${sexChar}${rep})` : `${stage}`;
}

function sortSamples(samples: ExpressionSample[]): ExpressionSample[] {
  const STAGE_ORDER: { [k: string]: number } = {
    E0: 1, "E3.5": 2, E7: 3, "E11": 4, "E14": 5, "E18.5": 6, P0: 7, Adult: 8,
  };
  return [...samples].sort((a, b) => {
    const sa = a.stage_order ?? STAGE_ORDER[a.stage ?? ""] ?? 99;
    const sb = b.stage_order ?? STAGE_ORDER[b.stage ?? ""] ?? 99;
    if (sa !== sb) return sa - sb;
    const sexA = a.sex === "Male" ? 0 : a.sex === "Female" ? 1 : 2;
    const sexB = b.sex === "Male" ? 0 : b.sex === "Female" ? 1 : 2;
    if (sexA !== sexB) return sexA - sexB;
    return (a.replicate ?? 0) - (b.replicate ?? 0);
  });
}

function buildXLabels(samples: ExpressionSample[]): string[] {
  return samples.map((s) => safeLabel(s));
}

export default function ExpressionLineChart({
  samples,
  dataset,
  metric,
  styleConfig,
}: ExpressionLineChartProps) {
  const fontSize = styleConfig?.fontSize ?? 10;
  const chartHeight = styleConfig?.chartHeight ?? 220;
  const showLegend = styleConfig?.showLegend ?? true;
  const showGrid = styleConfig?.showGrid ?? true;
  const showReplicates = styleConfig?.chartSpecific?.showReplicates ?? true;
  const lineWidth = styleConfig?.chartSpecific?.lineWidth ?? 2;
  const markerSize = styleConfig?.chartSpecific?.markerSize ?? 6;
  const maleColor = styleConfig?.colors?.male ?? "#228BE6";
  const femaleColor = styleConfig?.colors?.female ?? "#E64980";
  const gridColor = styleConfig?.colors?.grid ?? "#f0f0f0";
  const neutralColor = styleConfig?.colors?.neutral ?? "#7950F2";
  const titleOverride = styleConfig?.title;

  if (!samples || samples.length === 0) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Expression profile: no data available</Text>
      </Paper>
    );
  }

  const sorted = sortSamples(samples);
  const xLabels = buildXLabels(sorted);
  const values = sorted.map((s) => (isValidNumber(s.value) ? s.value : null));

  const maleIdx = sorted.map((s, idx) => (normalizeSex(s.sex) === "Male" ? idx : -1)).filter((i) => i >= 0);
  const femaleIdx = sorted.map((s, idx) => (normalizeSex(s.sex) === "Female" ? idx : -1)).filter((i) => i >= 0);

  const traces: any[] = showReplicates ? [
    {
      x: xLabels,
      y: values,
      type: "scatter",
      mode: "lines+markers",
      name: "All Samples",
      line: { color: neutralColor, width: 0.8, dash: "dot" },
      marker: { color: neutralColor, size: 4, opacity: 0.45 },
      text: sorted.map((s) => `${s.sample_name ?? s.stage ?? "?"}\n${isValidNumber(s.value) ? s.value.toFixed(3) : "?"}`),
      hoverinfo: "text+x",
    },
  ] : [];

  if (maleIdx.length > 0 && femaleIdx.length > 0) {
    traces.push({
      x: maleIdx.map((i) => xLabels[i]),
      y: maleIdx.map((i) => values[i]),
      type: "scatter",
      mode: "lines+markers",
      name: "Male",
      line: { color: maleColor, width: lineWidth },
      marker: { color: maleColor, size: markerSize },
      text: maleIdx.map((i) => `${sorted[i].sample_name ?? "?"}: ${isValidNumber(values[i]) ? values[i].toFixed(3) : "?"}`),
      hoverinfo: "text+x",
    });
    traces.push({
      x: femaleIdx.map((i) => xLabels[i]),
      y: femaleIdx.map((i) => values[i]),
      type: "scatter",
      mode: "lines+markers",
      name: "Female",
      line: { color: femaleColor, width: lineWidth },
      marker: { color: femaleColor, size: markerSize },
      text: femaleIdx.map((i) => `${sorted[i].sample_name ?? "?"}: ${isValidNumber(values[i]) ? values[i].toFixed(3) : "?"}`),
      hoverinfo: "text+x",
    });
  }

  const layout: any = {
    margin: { t: 8, b: 52, l: 56, r: 16 },
    xaxis: {
      tickangle: -40,
      tickfont: { size: fontSize - 1 },
      gridcolor: showGrid ? gridColor : "transparent",
      showgrid: showGrid,
      dtick: 1,
    },
    yaxis: {
      title: { text: metric === "tpm" || metric === "fpkm" ? metric.toUpperCase() : "Normalized Count", font: { size: fontSize } },
      gridcolor: showGrid ? gridColor : "transparent",
      tickfont: { size: fontSize - 1 },
      zeroline: false,
    },
    legend: {
      orientation: "h" as const,
      x: 0.5,
      xanchor: "center" as const,
      y: -0.26,
      font: { size: fontSize - 1 },
    },
    font: { family: "sans-serif", size: fontSize },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    showlegend: showLegend,
    hovermode: "closest" as const,
  };

  const config: any = {
    displayModeBar: false,
    responsive: true,
    locale: "en",
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          {titleOverride ?? `Expression Profile — ${getDatasetDisplayName(dataset)}`}
        </Text>
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
