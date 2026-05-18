/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconDownload, IconX } from "@tabler/icons-react";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { FullscreenState } from "./chartFullscreen.types";
import type { GeneExpressionResponse, ExpressionSample } from "../../lib/geneApi";
import type { ResolvedChartStyle } from "./chartCustomizer.types";
import { CHART_TYPE_LABELS } from "./chartCustomizer.defaults";

const Plot = createPlotlyComponent(PlotlyModule);

const PLOT_CONFIG_FULLSCREEN: any = {
  responsive: true,
  displayModeBar: true,
  displayLogo: false,
  scrollZoom: true,
  locale: "en",
  modeBarButtonsToRemove: ["toImage"],
};

interface ChartFullscreenModalProps {
  fullscreenState: FullscreenState | null;
  onClose: () => void;
  summary: GeneExpressionResponse["summary"] | undefined;
  samples: ExpressionSample[];
  dataset: string;
  metric: string;
  resolveStyle: (chartType: string) => ResolvedChartStyle | undefined;
}

type ExportSizePreset = "1200x800" | "1600x1000" | "2000x1200" | "2400x1600";

const EXPORT_SIZE_OPTIONS = [
  { value: "1200x800", label: "1200×800" },
  { value: "1600x1000", label: "1600×1000" },
  { value: "2000x1200", label: "2000×1200" },
  { value: "2400x1600", label: "2400×1600" },
];

function parsePresetSize(preset: ExportSizePreset) {
  const [width, height] = preset.split("x").map(Number);
  return { width, height };
}

const CHART_LABELS = CHART_TYPE_LABELS;

export default function ChartFullscreenModal({
  fullscreenState,
  onClose,
  summary,
  samples,
  dataset,
  metric,
  resolveStyle,
}: ChartFullscreenModalProps) {
  const graphDivRef = useRef<any>(null);
  const [plotReady, setPlotReady] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [sizePreset, setSizePreset] = useState<ExportSizePreset>("2000x1200");
  const [background, setBackground] = useState<"white" | "transparent">("white");
  const [filename, setFilename] = useState("");

  useEffect(() => {
    if (!fullscreenState) {
      graphDivRef.current = null;
      setPlotReady(false);
      setIsDownloading(false);
      setSizePreset("2000x1200");
      setBackground("white");
      setFilename("");
      return;
    }

    setPlotReady(false);
    setIsDownloading(false);
    setSizePreset("2000x1200");
    setBackground("white");
    setFilename(`chart-${fullscreenState.chartType}`);
  }, [fullscreenState]);

  if (!fullscreenState) return null;

  const { chartType } = fullscreenState;
  const styleConfig = resolveStyle(chartType);
  const titleOverride = styleConfig?.title;
  const { width: exportWidth, height: exportHeight } = parsePresetSize(sizePreset);

  const bindPlotLifecycle = {
    onInitialized: (_figure: any, graphDiv: any) => {
      graphDivRef.current = graphDiv;
      setPlotReady(true);
    },
    onUpdate: (_figure: any, graphDiv: any) => {
      graphDivRef.current = graphDiv;
      setPlotReady(true);
    },
  };

  const handleDownload = async () => {
    const gd = graphDivRef.current;
    if (!gd || isDownloading) return;

    setIsDownloading(true);

    const originalPaperBg = gd.layout?.paper_bgcolor ?? "white";
    const originalPlotBg = gd.layout?.plot_bgcolor ?? "white";

    try {
      if (background === "transparent") {
        await (window as any).Plotly.relayout(gd, {
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(0,0,0,0)",
        });
      } else {
        await (window as any).Plotly.relayout(gd, {
          paper_bgcolor: "white",
          plot_bgcolor: "white",
        });
      }

      if (typeof (PlotlyModule as any).downloadImage === "function") {
        await (PlotlyModule as any).downloadImage(gd, {
          format: "png",
          width: exportWidth,
          height: exportHeight,
          filename: filename.trim() || `chart-${chartType}`,
          scale: 2,
        });
      } else if (typeof (PlotlyModule as any).toImage === "function") {
        const url = await (PlotlyModule as any).toImage(gd, {
          format: "png",
          width: exportWidth,
          height: exportHeight,
          scale: 2,
        });

        const a = document.createElement("a");
        a.href = url;
        a.download = `${filename.trim() || `chart-${chartType}`}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error("Failed to export plot image:", error);
    } finally {
      try {
        await (window as any).Plotly.relayout(gd, {
          paper_bgcolor: originalPaperBg,
          plot_bgcolor: originalPlotBg,
        });
      } catch {
        // ignore restore failure
      }
      setIsDownloading(false);
    }
  };

  // Fullscreen chart height — use nearly all remaining viewport height
  const chartHeight = "calc(100vh - 220px)";

  const commonProps = {
    style: { width: "100%", height: chartHeight } as const,
    useResizeHandler: true as const,
    config: PLOT_CONFIG_FULLSCREEN,
    ...bindPlotLifecycle,
  };

  const renderPlotContent = () => {
    switch (chartType) {
      case "stage":
        return <StageChart summary={summary} dataset={dataset} metric={metric} styleConfig={styleConfig} {...commonProps} />;
      case "line":
        return <LineChart samples={samples} dataset={dataset} metric={metric} styleConfig={styleConfig} {...commonProps} />;
      case "violin":
        return <ViolinChart samples={samples} dataset={dataset} metric={metric} styleConfig={styleConfig} {...commonProps} />;
      case "area":
        return <AreaChart summary={summary} dataset={dataset} metric={metric} styleConfig={styleConfig} {...commonProps} />;
      case "radar":
        return <RadarChart summary={summary} dataset={dataset} styleConfig={styleConfig} {...commonProps} />;
      case "heatmap":
        return <HeatmapChart summary={summary} dataset={dataset} metric={metric} styleConfig={styleConfig} {...commonProps} />;
      case "zscore":
        return <ZScoreChart samples={samples} dataset={dataset} styleConfig={styleConfig} {...commonProps} />;
      case "fcbar":
        return <FCBarChart summary={summary} styleConfig={styleConfig} {...commonProps} />;
      case "fctraj":
        return <FCTrajectoryChart samples={samples} dataset={dataset} styleConfig={styleConfig} {...commonProps} />;
      case "dendrogram":
        return <DendrogramChart samples={samples} dataset={dataset} styleConfig={styleConfig} {...commonProps} />;
      default:
        return <Text>Unknown chart type</Text>;
    }
  };

  return (
    <Modal
      opened
      onClose={onClose}
      fullScreen
      withCloseButton={false}
      styles={{
        header: { padding: "12px 20px 8px", borderBottom: "1px solid #e9ecef" },
        body: { padding: 0, display: "flex", flexDirection: "column", height: "100vh" },
        content: { display: "flex", flexDirection: "column" },
      }}
      title={
        <Group gap="xs">
          <Text size="sm" fw={600}>
            {CHART_LABELS[chartType] ?? chartType}
          </Text>
          <Text size="xs" c="dimmed">
            {titleOverride || "Fullscreen View"}
          </Text>
        </Group>
      }
    >
      {/* Toolbar row */}
      <Box
        style={{
          borderBottom: "1px solid #e9ecef",
          padding: "10px 20px",
          background: "#fafafa",
          flexShrink: 0,
        }}
      >
        <Group justify="space-between" wrap="wrap" gap="md">
          <Group gap="md" wrap="wrap">
            <Text size="xs" c="dimmed" style={{ alignSelf: "center" }}>
              {plotReady ? "Interactive: scroll to zoom, drag to pan" : "Loading chart..."}
            </Text>
          </Group>

          <Group gap="sm">
            {/* Background toggle */}
            <SegmentedControl
              size="xs"
              value={background}
              onChange={(value) => setBackground(value as "white" | "transparent")}
              data={[
                { value: "white", label: "White BG" },
                { value: "transparent", label: "Transparent BG" },
              ]}
            />

            {/* Export size */}
            <Select
              size="xs"
              w={130}
              data={EXPORT_SIZE_OPTIONS}
              value={sizePreset}
              onChange={(value) => value && setSizePreset(value as ExportSizePreset)}
              styles={{ input: { fontSize: 12 } }}
            />

            {/* Filename */}
            <TextInput
              size="xs"
              w={180}
              value={filename}
              onChange={(event) => setFilename(event.currentTarget.value)}
              placeholder={`chart-${chartType}`}
              styles={{ input: { fontSize: 12 } }}
            />

            {/* Download */}
            <Tooltip label={!plotReady ? "Chart loading..." : ""}>
              <Button
                size="sm"
                leftSection={<IconDownload size={15} />}
                onClick={handleDownload}
                disabled={!plotReady || isDownloading}
                loading={isDownloading}
              >
                Export PNG
              </Button>
            </Tooltip>

            {/* Close */}
            <ActionIcon variant="subtle" color="gray" size="lg" onClick={onClose}>
              <IconX size={18} />
            </ActionIcon>
          </Group>
        </Group>
      </Box>

      {/* Chart area — fills all remaining space */}
      <Box
        style={{
          flex: 1,
          minHeight: 0,
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {renderPlotContent()}
      </Box>
    </Modal>
  );
}

// ─── Helper functions ──────────────────────────────────────────────────────────

function isValidNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function normalizeSex(sex: string | null | undefined): "Male" | "Female" | null {
  if (sex === "Male" || sex === "M" || sex === "m") return "Male";
  if (sex === "Female" || sex === "F" || sex === "f") return "Female";
  return null;
}

function getMetricLabel(metric: string): string {
  const MAP: Record<string, string> = { tpm: "TPM", fpkm: "FPKM", normcount: "Normalized Count", raw_count: "Raw Count" };
  return MAP[metric] ?? metric;
}

const STAGE_ORDER_MAP: Record<string, number> = { E0: 1, "E3.5": 2, "E4.5": 3, "E5.5": 4, "E6.5": 5, "E18.5": 6 };

function resolveStageMeans(
  stageMeans: Record<string, Record<string, number> | number | null> | null | undefined
) {
  if (!stageMeans || typeof stageMeans !== "object") {
    return { stages: [], maleValues: [], femaleValues: [], meanValues: [] };
  }
  const STAGE_ORDER = ["E0", "E3.5", "E4.5", "E5.5", "E6.5", "E18.5"];
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

function groupSamplesByStageSex(samples: ExpressionSample[]) {
  const groups: Record<string, { male: number[]; female: number[] }> = {};
  for (const s of samples) {
    const stage = s.stage || "?";
    if (!groups[stage]) groups[stage] = { male: [], female: [] };
    if (normalizeSex(s.sex) === "Male" && isValidNumber(s.value)) {
      groups[stage].male.push(s.value);
    } else if (normalizeSex(s.sex) === "Female" && isValidNumber(s.value)) {
      groups[stage].female.push(s.value);
    }
  }
  return groups;
}

function sortStages(stages: string[]): string[] {
  return [...stages].sort((a, b) => {
    const ai = STAGE_ORDER_MAP[a] ?? 99;
    const bi = STAGE_ORDER_MAP[b] ?? 99;
    return ai - bi;
  });
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const PAPER_STYLE_FULLSCREEN = {
  paper_bgcolor: "white",
  plot_bgcolor: "white",
};

// ─── Chart components ────────────────────────────────────────────────────────

// Stage Chart
function StageChart({ summary, metric, styleConfig, ...plotProps }: { summary: any; dataset: string; metric: string; styleConfig: any; style: any; useResizeHandler: boolean; config: any }) {
  const { stages, maleValues, femaleValues, meanValues } = resolveStageMeans(summary?.stage_means ?? null);
  const fontSize = styleConfig?.fontSize ?? 13;
  const showMeanLine = styleConfig?.chartSpecific?.showMeanLine ?? true;
  const showValueLabel = styleConfig?.chartSpecific?.showValueLabel ?? false;
  const maleColor = styleConfig?.colors?.male ?? "#228BE6";
  const femaleColor = styleConfig?.colors?.female ?? "#E64980";

  const hasData = stages.length > 0 && (maleValues.some(v => v > 0) || femaleValues.some(v => v > 0) || meanValues.some(v => v > 0));
  if (!hasData) return <Text>No data</Text>;

  const traces: any[] = [
    { x: stages, y: maleValues, name: "Male", type: "bar", marker: { color: maleColor, opacity: 0.85 }, text: showValueLabel ? maleValues.map((v: number) => (isValidNumber(v) ? v : 0).toFixed(2)) : undefined, textposition: showValueLabel ? "outside" : "none" },
    { x: stages, y: femaleValues, name: "Female", type: "bar", marker: { color: femaleColor, opacity: 0.85 }, text: showValueLabel ? femaleValues.map((v: number) => (isValidNumber(v) ? v : 0).toFixed(2)) : undefined, textposition: showValueLabel ? "outside" : "none" },
    ...(showMeanLine ? [{ x: stages, y: meanValues, name: "Total Mean", type: "scatter" as const, mode: "lines+markers" as const, line: { color: "#7950F2", width: 2, dash: "dot" }, marker: { color: "#7950F2", size: 7 }, yaxis: "y2" }] : []),
  ];
  const layout: any = { barmode: "group", margin: { t: 16, b: 72, l: 72, r: 48 }, yaxis: { title: { text: getMetricLabel(metric), font: { size: fontSize } }, gridcolor: "#f0f0f0", tickfont: { size: fontSize - 1 }, domain: [0, 0.72] }, yaxis2: { title: { text: "Mean (dot)", font: { size: fontSize, color: "#7950F2" } }, gridcolor: "#f0f0f0", tickfont: { size: fontSize - 1, color: "#7950F2" }, anchor: "free", side: "right", overlaying: "y", position: 0.98, domain: [0, 1] }, xaxis: { tickfont: { size: fontSize - 1 }, gridcolor: "transparent" }, legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.16, font: { size: fontSize - 1 } }, font: { family: "sans-serif", size: fontSize }, showlegend: true, hovermode: "x unified", ...PAPER_STYLE_FULLSCREEN };
  return <Plot data={traces} layout={layout} {...plotProps} />;
}

// Line Chart
function LineChart({ samples, metric, styleConfig, ...plotProps }: { samples: ExpressionSample[]; dataset: string; metric: string; styleConfig: any; style: any; useResizeHandler: boolean; config: any }) {
  const fontSize = styleConfig?.fontSize ?? 13;
  const showGrid = styleConfig?.showGrid ?? true;
  const showReplicates = styleConfig?.chartSpecific?.showReplicates ?? true;
  const lineWidth = styleConfig?.chartSpecific?.lineWidth ?? 2.5;
  const markerSize = styleConfig?.chartSpecific?.markerSize ?? 8;
  const maleColor = styleConfig?.colors?.male ?? "#228BE6";
  const femaleColor = styleConfig?.colors?.female ?? "#E64980";
  const neutralColor = styleConfig?.colors?.neutral ?? "#7950F6";

  const sorted = [...samples].sort((a: ExpressionSample, b: ExpressionSample) => {
    const sa = a.stage_order ?? STAGE_ORDER_MAP[a.stage ?? ""] ?? 99;
    const sb = b.stage_order ?? STAGE_ORDER_MAP[b.stage ?? ""] ?? 99;
    if (sa !== sb) return sa - sb;
    const sexA = a.sex === "Male" ? 0 : a.sex === "Female" ? 1 : 2;
    const sexB = b.sex === "Male" ? 0 : b.sex === "Female" ? 1 : 2;
    if (sexA !== sexB) return sexA - sexB;
    return (a.replicate ?? 0) - (b.replicate ?? 0);
  });
  const xLabels = sorted.map((s: ExpressionSample) => {
    const sexChar = normalizeSex(s.sex) === "Male" ? "M" : normalizeSex(s.sex) === "Female" ? "F" : "?";
    const rep = s.replicate != null ? `R${s.replicate}` : "";
    return `${s.stage ?? "?"}${rep}(${sexChar})`;
  });
  const values = sorted.map((s: ExpressionSample) => isValidNumber(s.value) ? s.value : null);
  const maleIdx = sorted.map((s: ExpressionSample, idx: number) => (normalizeSex(s.sex) === "Male" ? idx : -1)).filter((i: number) => i >= 0);
  const femaleIdx = sorted.map((s: ExpressionSample, idx: number) => (normalizeSex(s.sex) === "Female" ? idx : -1)).filter((i: number) => i >= 0);
  const traces: any[] = showReplicates ? [{ x: xLabels, y: values, type: "scatter", mode: "lines+markers", name: "All Samples", line: { color: neutralColor, width: 0.8, dash: "dot" }, marker: { color: neutralColor, size: 4, opacity: 0.45 } }] : [];
  if (maleIdx.length > 0 && femaleIdx.length > 0) {
    traces.push({ type: "scatter", mode: "lines+markers", x: maleIdx.map((i: number) => xLabels[i]), y: maleIdx.map((i: number) => values[i]), name: "Male", line: { color: maleColor, width: lineWidth }, marker: { color: maleColor, size: markerSize } });
    traces.push({ type: "scatter", mode: "lines+markers", x: femaleIdx.map((i: number) => xLabels[i]), y: femaleIdx.map((i: number) => values[i]), name: "Female", line: { color: femaleColor, width: lineWidth }, marker: { color: femaleColor, size: markerSize } });
  }
  const layout: any = { margin: { t: 16, b: 72, l: 72, r: 24 }, xaxis: { tickangle: -40, tickfont: { size: fontSize - 1 }, gridcolor: showGrid ? "#f0f0f0" : "transparent", showgrid: showGrid, dtick: 1 }, yaxis: { title: { text: getMetricLabel(metric), font: { size: fontSize } }, gridcolor: showGrid ? "#f0f0f0" : "transparent", tickfont: { size: fontSize - 1 }, zeroline: false }, legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.18, font: { size: fontSize - 1 } }, font: { family: "sans-serif", size: fontSize }, showlegend: true, hovermode: "closest" as const, ...PAPER_STYLE_FULLSCREEN };
  return <Plot data={traces} layout={layout} {...plotProps} />;
}

// Violin Chart
function ViolinChart({ samples, metric, styleConfig, ...plotProps }: { samples: ExpressionSample[]; dataset: string; metric: string; styleConfig: any; style: any; useResizeHandler: boolean; config: any }) {
  const fontSize = styleConfig?.fontSize ?? 13;
  const showGrid = styleConfig?.showGrid ?? true;
  const showPoints = styleConfig?.chartSpecific?.showPoints ?? true;
  const opacity = styleConfig?.chartSpecific?.opacity ?? 0.7;
  const maleColor = styleConfig?.colors?.male ?? "#228BE6";
  const femaleColor = styleConfig?.colors?.female ?? "#E64980";
  const gridColor = styleConfig?.colors?.grid ?? "#f0f0f0";
  const grouped = groupSamplesByStageSex(samples);
  const stages = sortStages(Object.keys(grouped));
  let usableCount = 0;
  for (const stage of stages) {
    if (grouped[stage].male.length > 0) usableCount++;
    if (grouped[stage].female.length > 0) usableCount++;
  }
  if (usableCount < 2) return <Text>Need ≥2 stage groups</Text>;
  const traces: any[] = [];
  for (const stage of stages) {
    const maleVals = grouped[stage].male;
    const femaleVals = grouped[stage].female;
    if (maleVals.length > 0) traces.push({ type: "violin", y: maleVals, x: Array(maleVals.length).fill(stage), name: `${stage} Male`, box: { visible: true }, meanline: { visible: true }, points: showPoints ? "all" : false, jitter: 0.25, marker: { color: maleColor, size: 4, opacity }, span: [Math.min(...maleVals) * 0.9, Math.max(...maleVals) * 1.1] });
    if (femaleVals.length > 0) traces.push({ type: "violin", y: femaleVals, x: Array(femaleVals.length).fill(stage), name: `${stage} Female`, box: { visible: true }, meanline: { visible: true }, points: showPoints ? "all" : false, jitter: 0.25, marker: { color: femaleColor, size: 4, opacity }, span: [Math.min(...femaleVals) * 0.9, Math.max(...femaleVals) * 1.1] });
  }
  const layout: any = { violinmode: "group", margin: { t: 16, b: 72, l: 72, r: 24 }, yaxis: { title: { text: getMetricLabel(metric), font: { size: fontSize } }, gridcolor: showGrid ? gridColor : "transparent", tickfont: { size: fontSize - 1 } }, xaxis: { tickfont: { size: fontSize - 1 }, gridcolor: "transparent" }, showlegend: true, legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.18, font: { size: fontSize - 1 } }, boxpoints: showPoints ? "all" : false, ...PAPER_STYLE_FULLSCREEN };
  return <Plot data={traces} layout={layout} {...plotProps} />;
}

// Area Chart
function AreaChart({ summary, metric, styleConfig, ...plotProps }: { summary: any; dataset: string; metric: string; styleConfig: any; style: any; useResizeHandler: boolean; config: any }) {
  const fontSize = styleConfig?.fontSize ?? 13;
  const showGrid = styleConfig?.showGrid ?? true;
  const showMeanLine = styleConfig?.chartSpecific?.showMeanLine ?? true;
  const areaOpacity = styleConfig?.chartSpecific?.opacity ?? 0.35;
  const maleColor = styleConfig?.colors?.male ?? "#228BE6";
  const femaleColor = styleConfig?.colors?.female ?? "#E64980";
  const gridColor = styleConfig?.colors?.grid ?? "#f0f0f0";
  const { stages, maleValues, femaleValues, meanValues } = resolveStageMeans(summary?.stage_means ?? null);
  const hasData = stages.length > 0 && (maleValues.some(v => v > 0) || femaleValues.some(v => v > 0) || meanValues.some(v => v > 0));
  if (!hasData) return <Text>No data</Text>;
  const traces: any[] = [
    { type: "scatter", mode: "lines", x: stages, y: femaleValues, name: "Female", fill: "tozeroy", fillcolor: hexToRgba(femaleColor, areaOpacity), line: { color: femaleColor, width: 1.5 }, hoverinfo: "x+y+name" },
    { type: "scatter", mode: "lines", x: stages, y: maleValues, name: "Male", fill: "tonexty", fillcolor: hexToRgba(maleColor, areaOpacity), line: { color: maleColor, width: 1.5 }, hoverinfo: "x+y+name" },
    ...(showMeanLine ? [{ type: "scatter" as const, mode: "lines+markers" as const, x: stages, y: meanValues, name: "Total Mean", line: { color: "#7950F2", width: 2, dash: "dot" }, marker: { color: "#7950F2", size: 6 }, yaxis: "y2" }] : []),
  ];
  const layout: any = { margin: { t: 16, b: 56, l: 72, r: 48 }, xaxis: { tickfont: { size: fontSize - 1 }, gridcolor: "transparent" }, yaxis: { title: { text: getMetricLabel(metric), font: { size: fontSize } }, gridcolor: showGrid ? gridColor : "transparent", tickfont: { size: fontSize - 1 }, domain: [0, 0.85] }, yaxis2: { title: { text: "Mean (dot)", font: { size: fontSize, color: "#7950F2" } }, anchor: "free", side: "right", overlaying: "y", position: 0.98, domain: [0, 1], tickfont: { size: fontSize - 1, color: "#7950F2" }, gridcolor: showGrid ? gridColor : "transparent" }, legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.14, font: { size: fontSize - 1 } }, hovermode: "x unified", showlegend: true, ...PAPER_STYLE_FULLSCREEN };
  return <Plot data={traces} layout={layout} {...plotProps} />;
}

// Radar Chart
function RadarChart({ summary, styleConfig, ...plotProps }: { summary: any; dataset: string; styleConfig: any; style: any; useResizeHandler: boolean; config: any }) {
  const fontSize = styleConfig?.fontSize ?? 13;
  const showLegend = styleConfig?.showLegend ?? true;
  const fillOpacity = styleConfig?.chartSpecific?.fillOpacity ?? 0.25;
  const maleColor = styleConfig?.colors?.male ?? "#228BE6";
  const femaleColor = styleConfig?.colors?.female ?? "#E64980";
  const { stages, maleValues, femaleValues } = resolveStageMeans(summary?.stage_means ?? null);
  const allValues = [...maleValues, ...femaleValues].filter(isValidNumber);
  const maxVal = allValues.length > 0 ? Math.max(...allValues) : 1;
  const hasData = stages.length > 0 && (maleValues.some(v => v > 0) || femaleValues.some(v => v > 0));
  if (!hasData) return <Text>No data</Text>;
  const rMale = maleValues.map((v: number) => (maxVal > 0 ? v / maxVal : 0));
  const rFemale = femaleValues.map((v: number) => (maxVal > 0 ? v / maxVal : 0));
  const traces: any[] = [
    { type: "scatterpolar", r: rMale, theta: stages, name: "Male", fill: "toself", fillcolor: hexToRgba(maleColor, fillOpacity), line: { color: maleColor, width: 2 }, marker: { size: 6 }, text: maleValues.map((v: number) => v.toFixed(2)), hovertemplate: "%{theta}: %{r:.2f} (raw: %{text})<extra>Male</extra>" },
    { type: "scatterpolar", r: rFemale, theta: stages, name: "Female", fill: "toself", fillcolor: hexToRgba(femaleColor, fillOpacity), line: { color: femaleColor, width: 2 }, marker: { size: 6 }, text: femaleValues.map((v: number) => v.toFixed(2)), hovertemplate: "%{theta}: %{r:.2f} (raw: %{text})<extra>Female</extra>" },
  ];
  const layout: any = { polar: { radialaxis: { visible: true, range: [0, 1], tickfont: { size: fontSize - 1 }, gridcolor: "#f0f0f0", title: { text: "Relative Expression", font: { size: fontSize } } }, angularaxis: { tickfont: { size: fontSize - 1 }, gridcolor: "#f8f8f8" }, bgcolor: "white" }, showlegend: showLegend, legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.06, font: { size: fontSize - 1 } }, margin: { t: 16, b: 16, l: 16, r: 16 }, ...PAPER_STYLE_FULLSCREEN };
  return <Plot data={traces} layout={layout} {...plotProps} />;
}

// Heatmap Chart
function HeatmapChart({ summary, metric, styleConfig, ...plotProps }: { summary: any; dataset: string; metric: string; styleConfig: any; style: any; useResizeHandler: boolean; config: any }) {
  const fontSize = styleConfig?.fontSize ?? 13;
  const showValues = styleConfig?.chartSpecific?.showValues ?? true;
  const labelFontSize = styleConfig?.chartSpecific?.labelFontSize ?? 11;
  const { stages, maleValues, femaleValues } = resolveStageMeans(summary?.stage_means ?? null);
  const hasData = stages.length > 0 && (maleValues.some(v => v > 0) || femaleValues.some(v => v > 0));
  if (!hasData) return <Text>No data</Text>;
  const z = [maleValues, femaleValues];
  const allVals = [...maleValues, ...femaleValues].filter(v => v > 0);
  const minVal = allVals.length > 0 ? Math.min(...allVals) : 0;
  const maxVal = allVals.length > 0 ? Math.max(...allVals) : 1;
  const zNormalized = z.map((row: number[]) => row.map((v: number) => (v > 0 ? (maxVal > minVal ? (v - minVal) / (maxVal - minVal) : 0) : 0)));
  const traces: any[] = [{ type: "heatmap", z: zNormalized, x: stages, y: ["Male", "Female"], colorscale: [[0, "#f8f8f8"], [0.25, "#b39ddb"], [0.5, "#7e57c2"], [0.75, "#5e35b1"], [1, "#311b92"]], showscale: true, colorbar: { title: { text: getMetricLabel(metric), side: "right", font: { size: 11 } }, tickfont: { size: 10 }, len: 0.7 }, text: z.map((row: number[]) => row.map((v: number) => (v > 0 ? v.toFixed(2) : "0"))), hoverongaps: false, hovertemplate: "%{y} %{x}: %{text}<extra></extra>" }];
  const annotations: any[] = [];
  if (showValues) {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < stages.length; j++) {
        const val = z[i][j];
        const norm = zNormalized[i][j];
        const textColor = norm > 0.5 ? "#ffffff" : "#212121";
        annotations.push({ x: stages[j], y: ["Male", "Female"][i], text: val > 0 ? val.toFixed(1) : "—", showarrow: false, font: { size: labelFontSize, color: textColor }, xanchor: "center", yanchor: "middle" });
      }
    }
  }
  const layout: any = { margin: { t: 16, b: 56, l: 80, r: 24 }, xaxis: { tickfont: { size: labelFontSize }, title: { text: "Stage", font: { size: fontSize } }, gridcolor: "#f8f8f8" }, yaxis: { tickfont: { size: labelFontSize }, title: { text: "", font: { size: fontSize } } }, annotations, ...PAPER_STYLE_FULLSCREEN };
  return <Plot data={traces} layout={layout} {...plotProps} />;
}

// ZScore Chart
function ZScoreChart({ samples, styleConfig, ...plotProps }: { samples: ExpressionSample[]; dataset: string; styleConfig: any; style: any; useResizeHandler: boolean; config: any }) {
  const fontSize = styleConfig?.fontSize ?? 13;
  const showGrid = styleConfig?.showGrid ?? true;
  const lineWidth = styleConfig?.chartSpecific?.lineWidth ?? 2;
  const markerSize = styleConfig?.chartSpecific?.markerSize ?? 6;
  const maleColor = styleConfig?.colors?.male ?? "#228BE6";
  const femaleColor = styleConfig?.colors?.female ?? "#E64980";
  const neutralColor = styleConfig?.colors?.neutral ?? "#7950F6";
  const gridColor = styleConfig?.colors?.grid ?? "#f0f0f0";
  const validSamples = samples.filter((s: ExpressionSample) => isValidNumber(s.z_score)).sort((a: ExpressionSample, b: ExpressionSample) => { const sa = a.stage_order ?? 99; const sb = b.stage_order ?? 99; if (sa !== sb) return sa - sb; const sexA = a.sex === "Male" ? 0 : a.sex === "Female" ? 1 : 2; const sexB = b.sex === "Male" ? 0 : b.sex === "Female" ? 1 : 2; return sexA - sexB; });
  if (validSamples.length === 0) return <Text>No z-score data</Text>;
  const labels = validSamples.map((s: ExpressionSample) => { const sexChar = normalizeSex(s.sex) === "Male" ? "M" : normalizeSex(s.sex) === "Female" ? "F" : "?"; const rep = s.replicate != null ? `R${s.replicate}` : ""; return `${s.stage}${rep}(${sexChar})`; });
  const zScores = validSamples.map((s: ExpressionSample) => s.z_score!);
  const maleIdx: number[] = []; const femaleIdx: number[] = [];
  validSamples.forEach((s: ExpressionSample, i: number) => { if (normalizeSex(s.sex) === "Male") maleIdx.push(i); else if (normalizeSex(s.sex) === "Female") femaleIdx.push(i); });
  const traces: any[] = [{ type: "scatter", mode: "lines+markers", x: labels, y: zScores, name: "All", line: { color: neutralColor, width: 0.8, dash: "dot" }, marker: { color: neutralColor, size: 4, opacity: 0.4 } }];
  if (maleIdx.length > 0 && femaleIdx.length > 0) { traces.push({ type: "scatter", mode: "lines+markers", x: maleIdx.map((i: number) => labels[i]), y: maleIdx.map((i: number) => zScores[i]), name: "Male", line: { color: maleColor, width: lineWidth }, marker: { color: maleColor, size: markerSize } }); traces.push({ type: "scatter", mode: "lines+markers", x: femaleIdx.map((i: number) => labels[i]), y: femaleIdx.map((i: number) => zScores[i]), name: "Female", line: { color: femaleColor, width: lineWidth }, marker: { color: femaleColor, size: markerSize } }); }
  const layout: any = { margin: { t: 16, b: 72, l: 72, r: 24 }, xaxis: { tickangle: -40, tickfont: { size: fontSize - 2 }, gridcolor: "transparent", dtick: 1 }, yaxis: { title: { text: "Z-Score", font: { size: fontSize } }, gridcolor: showGrid ? gridColor : "transparent", tickfont: { size: fontSize - 1 }, zeroline: true, zerolinecolor: "#ccc", zerolinewidth: 1 }, legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.2, font: { size: fontSize - 1 } }, font: { family: "sans-serif", size: fontSize }, showlegend: true, hovermode: "closest" as const, ...PAPER_STYLE_FULLSCREEN };
  return <Plot data={traces} layout={layout} {...plotProps} />;
}

// FCBar Chart
function FCBarChart({ summary, styleConfig, ...plotProps }: { summary: any; styleConfig: any; style: any; useResizeHandler: boolean; config: any }) {
  const fontSize = styleConfig?.fontSize ?? 13;
  const showGrid = styleConfig?.showGrid ?? true;
  const showValueLabel = styleConfig?.chartSpecific?.showValueLabel ?? true;
  const barWidth = styleConfig?.chartSpecific?.barWidth ?? 0.6;
  const upColor = styleConfig?.colors?.up ?? "#12b886";
  const downColor = styleConfig?.colors?.down ?? "#fa5252";
  const gridColor = styleConfig?.colors?.grid ?? "#f0f0f0";
  const foldTop = summary?.fold_change_top;
  const foldBottom = summary?.fold_change_bottom;
  const topStage = summary?.top_stage;
  // DB already stores log2 fold change values
  const hasData = isValidNumber(foldTop) || isValidNumber(foldBottom);
  if (!hasData) return <Text>No fold change data</Text>;
  const foldData: Array<{ label: string; log2Value: number; displayValue: number; direction: "up" | "down" }> = [];
  if (isValidNumber(foldTop)) {
    foldData.push({ label: topStage && topStage !== "—" ? `Top (${topStage})` : "Top Stage", log2Value: foldTop!, displayValue: Math.pow(2, foldTop!), direction: "up" });
  }
  if (isValidNumber(foldBottom) && foldBottom! < 0) {
    foldData.push({ label: "Bottom Stage", log2Value: foldBottom!, displayValue: Math.pow(2, foldBottom!), direction: "down" });
  }
  const traces: any[] = [{
    type: "bar",
    x: foldData.map(d => d.label),
    y: foldData.map(d => d.log2Value),
    text: showValueLabel ? foldData.map(d => `${d.displayValue.toFixed(2)}x`) : undefined,
    textposition: showValueLabel ? "outside" : "none",
    textfont: { size: fontSize - 1, color: foldData.map(d => d.direction === "up" ? upColor : downColor) },
    marker: { color: foldData.map(d => d.direction === "up" ? upColor : downColor), opacity: 0.85, width: barWidth },
    hovertemplate: foldData.map(d => "%{x}: %{text} (log2: %{y:.2f})<extra></extra>"),
    orientation: "v" as const
  }];
  const layout: any = { margin: { t: 16, b: 64, l: 96, r: 24 }, yaxis: { title: { text: "log2(Fold Change)", font: { size: fontSize } }, gridcolor: showGrid ? gridColor : "transparent", zeroline: true, zerolinecolor: "#ccc", tickfont: { size: fontSize - 1 } }, xaxis: { tickfont: { size: fontSize - 1 }, gridcolor: "transparent" }, showlegend: false, ...PAPER_STYLE_FULLSCREEN };
  return <Plot data={traces} layout={layout} {...plotProps} />;
}

// FCTrajectory Chart
function FCTrajectoryChart({ samples, styleConfig, ...plotProps }: { samples: ExpressionSample[]; dataset: string; styleConfig: any; style: any; useResizeHandler: boolean; config: any }) {
  const fontSize = styleConfig?.fontSize ?? 13;
  const showLegend = styleConfig?.showLegend ?? true;
  const showGrid = styleConfig?.showGrid ?? true;
  const showValueLabel = styleConfig?.chartSpecific?.showValueLabel ?? true;
  const barWidth = styleConfig?.chartSpecific?.barWidth ?? 0.6;
  const maleColor = styleConfig?.colors?.male ?? "#228BE6";
  const femaleColor = styleConfig?.colors?.female ?? "#E64980";
  const gridColor = styleConfig?.colors?.grid ?? "#f0f0f0";
  const grouped = groupSamplesByStageSex(samples);
  const stages = sortStages(Object.keys(grouped));
  const means: { stage: string; male: number; female: number }[] = [];
  for (const stage of stages) { const maleVals = grouped[stage].male; const femaleVals = grouped[stage].female; const maleMean = maleVals.length > 0 ? maleVals.reduce((a: number, b: number) => a + b, 0) / maleVals.length : 0; const femaleMean = femaleVals.length > 0 ? femaleVals.reduce((a: number, b: number) => a + b, 0) / femaleVals.length : 0; if (maleVals.length > 0 || femaleVals.length > 0) means.push({ stage, male: maleMean, female: femaleMean }); }
  if (means.length < 2) return <Text>Need ≥2 stages</Text>;
  const labels: string[] = []; const maleFc: (number | null)[] = []; const femaleFc: (number | null)[] = [];
  for (let i = 1; i < means.length; i++) { const curr = means[i]; const prev = means[i - 1]; labels.push(`${prev.stage} → ${curr.stage}`); maleFc.push(prev.male > 0 && curr.male > 0 ? Math.log2(curr.male / prev.male) : null); femaleFc.push(prev.female > 0 && curr.female > 0 ? Math.log2(curr.female / prev.female) : null); }
  const validMale = maleFc.filter(isValidNumber); const validFemale = femaleFc.filter(isValidNumber);
  if (validMale.length === 0 && validFemale.length === 0) return <Text>Insufficient non-zero values</Text>;
  const traces: any[] = [];
  if (validMale.length > 0) traces.push({ type: "bar", x: labels, y: maleFc, name: "Male", marker: { color: maleFc.map(v => v != null ? (v > 0 ? maleColor : maleColor + "99") : "#ccc"), width: barWidth }, text: showValueLabel ? maleFc.map(v => v != null ? `log2FC: ${v.toFixed(3)}` : "N/A") : undefined, hovertemplate: "%{text}<extra>Male</extra>", showlegend: true });
  if (validFemale.length > 0) traces.push({ type: "bar", x: labels, y: femaleFc, name: "Female", marker: { color: femaleFc.map(v => v != null ? (v > 0 ? femaleColor : femaleColor + "99") : "#ccc"), width: barWidth }, text: showValueLabel ? femaleFc.map(v => v != null ? `log2FC: ${v.toFixed(3)}` : "N/A") : undefined, hovertemplate: "%{text}<extra>Female</extra>", showlegend: true });
  const layout: any = { margin: { t: 16, b: 72, l: 72, r: 24 }, xaxis: { tickangle: -30, tickfont: { size: fontSize - 2 }, gridcolor: "transparent" }, yaxis: { title: { text: "log₂ Fold Change", font: { size: fontSize } }, gridcolor: showGrid ? gridColor : "transparent", tickfont: { size: fontSize - 1 }, zeroline: true, zerolinecolor: "#ccc", zerolinewidth: 1 }, legend: { orientation: "h" as const, x: 0.5, xanchor: "center" as const, y: -0.18, font: { size: fontSize - 1 } }, font: { family: "sans-serif", size: fontSize }, barmode: "group", hovermode: "closest" as const, showlegend: showLegend, ...PAPER_STYLE_FULLSCREEN };
  return <Plot data={traces} layout={layout} {...plotProps} />;
}

// Dendrogram Chart
function DendrogramChart({ samples, styleConfig, ...plotProps }: { samples: ExpressionSample[]; dataset: string; styleConfig: any; style: any; useResizeHandler: boolean; config: any }) {
  const fontSize = styleConfig?.fontSize ?? 13;
  const showLegend = styleConfig?.showLegend ?? true;
  const showGrid = styleConfig?.showGrid ?? true;
  const pointSize = styleConfig?.chartSpecific?.pointSize ?? 9;
  const showLabels = styleConfig?.chartSpecific?.showLabels ?? true;
  const maleColor = styleConfig?.colors?.male ?? "#228BE6";
  const femaleColor = styleConfig?.colors?.female ?? "#E64980";
  const gridColor = styleConfig?.colors?.grid ?? "#f0f0f0";
  const grouped = groupSamplesByStageSex(samples);
  const stages = sortStages(Object.keys(grouped));
  let groupCount = 0;
  for (const stage of stages) { if (grouped[stage].male.length > 0) groupCount++; if (grouped[stage].female.length > 0) groupCount++; }
  if (groupCount < 2) return <Text>Need at least 2 groups</Text>;
  const maleData: { stage: string; mean: number; count: number }[] = []; const femaleData: { stage: string; mean: number; count: number }[] = [];
  for (const stage of stages) { const maleVals = grouped[stage].male.filter(isValidNumber); const femaleVals = grouped[stage].female.filter(isValidNumber); if (maleVals.length > 0) maleData.push({ stage, mean: maleVals.reduce((a: number, b: number) => a + b, 0) / maleVals.length, count: maleVals.length }); if (femaleVals.length > 0) femaleData.push({ stage, mean: femaleVals.reduce((a: number, b: number) => a + b, 0) / femaleVals.length, count: femaleVals.length }); }
  const STAGE_X: Record<string, number> = {}; stages.forEach((s: string, i: number) => { STAGE_X[s] = i; });
  const hoverMale = maleData.map(d => `<b>${d.stage} Male</b><br>Mean: ${d.mean.toFixed(3)}<br>n = ${d.count}`);
  const hoverFemale = femaleData.map(d => `<b>${d.stage} Female</b><br>Mean: ${d.mean.toFixed(3)}<br>n = ${d.count}`);
  const traces: any[] = [
    { type: "scatter", mode: showLabels ? "lines+markers" : "lines", x: maleData.map(d => STAGE_X[d.stage]), y: maleData.map(d => d.mean), line: { color: maleColor, width: 1.5, dash: "solid" }, marker: { color: maleColor, size: pointSize, symbol: "circle" }, text: hoverMale, hovertemplate: "%{text}<extra>Male</extra>", name: "Male" },
    { type: "scatter", mode: showLabels ? "lines+markers" : "lines", x: femaleData.map(d => STAGE_X[d.stage]), y: femaleData.map(d => d.mean), line: { color: femaleColor, width: 1.5, dash: "solid" }, marker: { color: femaleColor, size: pointSize, symbol: "circle" }, text: hoverFemale, hovertemplate: "%{text}<extra>Female</extra>", name: "Female" },
  ];
  const layout: any = { margin: { t: 16, b: 60, l: 72, r: 24 }, xaxis: { tickmode: "array", tickvals: stages.map((_: string, i: number) => i), ticktext: stages, tickfont: { size: fontSize - 1 }, title: { text: "Stage", font: { size: fontSize } }, gridcolor: showGrid ? gridColor : "transparent", showgrid: showGrid, dtick: 1 }, yaxis: { title: { text: "Mean Expression", font: { size: fontSize } }, gridcolor: showGrid ? gridColor : "transparent", tickfont: { size: fontSize - 1 }, zeroline: false }, showlegend: showLegend, legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.14, font: { size: fontSize - 1 } }, hovermode: "closest" as const, ...PAPER_STYLE_FULLSCREEN };
  return <Plot data={traces} layout={layout} {...plotProps} />;
}
