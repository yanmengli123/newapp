/* eslint-disable @typescript-eslint/no-explicit-any */
import { Paper, Text } from "@mantine/core";
import type { ExpressionSample } from "../../lib/geneApi";
import InteractiveChart from "./InteractiveChart";

interface ExpressionLineChartProps {
  samples: ExpressionSample[];
  dataset: string;
  metric: string;
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

function exportCsv(samples: ExpressionSample[], dataset: string) {
  const headers = [
    "Sample Name",
    "Stage",
    "Stage Label",
    "Sex",
    "Replicate",
    "SRR Run",
    "Batch",
    "Tissue",
    "Value",
    "Z-Score",
    "Log2FC",
  ];
  const rows = samples.map((s) => [
    s.sample_name ?? "",
    s.stage ?? "",
    s.stage_label ?? "",
    s.sex ?? "",
    s.replicate?.toString() ?? "",
    s.srr_run_id ?? "",
    s.batch ?? "",
    s.tissue ?? "",
    s.value.toString(),
    s.z_score?.toString() ?? "",
    s.log2fc?.toString() ?? "",
  ]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `expression_profile_${dataset}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExpressionLineChart({
  samples,
  dataset,
  metric,
}: ExpressionLineChartProps) {
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

  const traces: any[] = [
    {
      x: xLabels,
      y: values,
      type: "scatter",
      mode: "lines+markers",
      name: "All Samples",
      line: { color: "#7950F2", width: 0.8, dash: "dot" },
      marker: { color: "#7950F2", size: 4, opacity: 0.45 },
      text: sorted.map((s) => `${s.sample_name ?? s.stage ?? "?"}\n${isValidNumber(s.value) ? s.value.toFixed(3) : "?"}`),
      hoverinfo: "text+x",
    },
  ];

  if (maleIdx.length > 0 && femaleIdx.length > 0) {
    traces.push({
      x: maleIdx.map((i) => xLabels[i]),
      y: maleIdx.map((i) => values[i]),
      type: "scatter",
      mode: "lines+markers",
      name: "Male",
      line: { color: "#228BE6", width: 2 },
      marker: { color: "#228BE6", size: 6 },
      text: maleIdx.map((i) => `${sorted[i].sample_name ?? "?"}: ${isValidNumber(values[i]) ? values[i].toFixed(3) : "?"}`),
      hoverinfo: "text+x",
    });
    traces.push({
      x: femaleIdx.map((i) => xLabels[i]),
      y: femaleIdx.map((i) => values[i]),
      type: "scatter",
      mode: "lines+markers",
      name: "Female",
      line: { color: "#E64980", width: 2 },
      marker: { color: "#E64980", size: 6 },
      text: femaleIdx.map((i) => `${sorted[i].sample_name ?? "?"}: ${isValidNumber(values[i]) ? values[i].toFixed(3) : "?"}`),
      hoverinfo: "text+x",
    });
  }

  const layout: any = {
    margin: { t: 8, b: 52, l: 56, r: 16 },
    xaxis: {
      tickangle: -40,
      tickfont: { size: 8 },
      gridcolor: "#f8f8f8",
      showgrid: true,
      dtick: 1,
    },
    yaxis: {
      title: { text: metric === "tpm" || metric === "fpkm" ? metric.toUpperCase() : "Normalized Count", font: { size: 10 } },
      gridcolor: "#f0f0f0",
      tickfont: { size: 9 },
      zeroline: false,
    },
    legend: {
      orientation: "h" as const,
      x: 0.5,
      xanchor: "center" as const,
      y: -0.26,
      font: { size: 9 },
    },
    font: { family: "sans-serif", size: 10 },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    showlegend: true,
    hovermode: "closest" as const,
  };

  const config: any = {
    displayModeBar: false,
    responsive: true,
    locale: "en",
  };

  const chartTitle = `Expression Profile — ${getDatasetDisplayName(dataset)}`;

  return (
    <InteractiveChart
      title={chartTitle}
      datasetCode={dataset}
      traces={traces}
      layout={layout}
      config={config}
      onExportCsv={() => exportCsv(sorted, dataset)}
    />
  );
}
