import type {
  ChartCustomizerConfig,
  ChartType,
  ResolvedChartStyle,
} from "./chartCustomizer.types";
import { DEFAULT_THEME, PRESET_COLORS } from "./chartCustomizer.defaults";

function getChartInternalDefaults(type: ChartType): Record<string, unknown> {
  switch (type) {
    case "stage":
      return { showMeanLine: true, barRadius: 0, showValueLabel: false };
    case "line":
      return { lineWidth: 2.5, markerSize: 8, showReplicates: true, showCIBand: false };
    case "violin":
      return { showPoints: true, opacity: 0.7 };
    case "area":
      return { opacity: 0.6, showMeanLine: true };
    case "radar":
      return { fillOpacity: 0.25, normalizeMode: "linear" as const };
    case "heatmap":
      return { showValues: true, colorScale: "blues", colorMin: null, colorMax: null, labelFontSize: 9 };
    case "zscore":
      return { zeroLineStyle: "dashed" as const, showCIBand: true, thresholdLines: [1.96, -1.96] };
    case "fcbar":
      return { showValueLabel: true, barWidth: 0.6 };
    case "fctraj":
      return { showReferenceLines: true, thresholdLines: [1, -1], showValueLabel: true };
    case "dendrogram":
      return { pointSize: 8, showLabels: true };
    default:
      return {};
  }
}

export function resolveChartStyle(
  chartType: ChartType,
  config: ChartCustomizerConfig | undefined
): ResolvedChartStyle {
  const presetColors = PRESET_COLORS[config?.theme?.preset ?? "default"] ?? PRESET_COLORS.default;
  const theme = config?.theme ?? DEFAULT_THEME;
  const chartSpecific = config?.charts?.[chartType] ?? {};

  const chartDefaults = getChartInternalDefaults(chartType);

  return {
    fontSize: theme.fontSize,
    chartHeight: theme.chartHeight,
    showLegend: theme.showLegend,
    showGrid: theme.showGrid,
    title: theme.title,
    subtitle: theme.subtitle,
    colors: theme.colors ?? presetColors,
    chartSpecific: {
      ...chartDefaults,
      ...chartSpecific,
    },
  };
}

export function buildPlotlyLayout(
  chartType: ChartType,
  resolved: ResolvedChartStyle,
  baseLayout: Record<string, unknown>
): Record<string, unknown> {
  const fontSize = resolved.fontSize;
  const gridColor = resolved.colors.grid;
  const textColor = resolved.colors.text;

  const base = {
    ...baseLayout,
    font: { size: fontSize, color: textColor },
    showlegend: resolved.showLegend,
    paper_bgcolor: "white",
    plot_bgcolor: "white",
  };

  switch (chartType) {
    case "stage":
    case "fcbar":
    case "fctraj":
      return {
        ...base,
        xaxis: {
          ...(baseLayout.xaxis as object ?? {}),
          gridcolor: gridColor,
          showgrid: resolved.showGrid,
          font: { size: fontSize, color: textColor },
        },
        yaxis: {
          ...(baseLayout.yaxis as object ?? {}),
          gridcolor: gridColor,
          showgrid: resolved.showGrid,
          font: { size: fontSize, color: textColor },
        },
      };

    case "line":
    case "zscore":
    case "area":
      return {
        ...base,
        xaxis: {
          ...(baseLayout.xaxis as object ?? {}),
          gridcolor: gridColor,
          showgrid: resolved.showGrid,
          font: { size: fontSize, color: textColor },
        },
        yaxis: {
          ...(baseLayout.yaxis as object ?? {}),
          gridcolor: gridColor,
          showgrid: resolved.showGrid,
          font: { size: fontSize, color: textColor },
        },
      };

    case "heatmap":
      return {
        ...base,
        xaxis: {
          ...(baseLayout.xaxis as object ?? {}),
          gridcolor: gridColor,
          showgrid: false,
          font: { size: resolved.chartSpecific?.labelFontSize ?? fontSize, color: textColor },
        },
        yaxis: {
          ...(baseLayout.yaxis as object ?? {}),
          gridcolor: gridColor,
          showgrid: false,
          font: { size: resolved.chartSpecific?.labelFontSize ?? fontSize, color: textColor },
        },
      };

    case "violin":
    case "radar":
    case "dendrogram":
    default:
      return base;
  }
}
