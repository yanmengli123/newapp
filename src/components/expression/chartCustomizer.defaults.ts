import type { ChartCustomizerConfig, ChartPreset, SharedChartTheme } from "./chartCustomizer.types";

export const PRESET_COLORS: Record<ChartPreset, SharedChartTheme["colors"]> = {
  default: {
    male: "#228BE6",
    female: "#E64980",
    neutral: "#9CA3AF",
    up: "#FA5252",
    down: "#4C6EF5",
    grid: "#f0f0f0",
    text: "#212529",
  },
  print: {
    male: "#000000",
    female: "#404040",
    neutral: "#808080",
    up: "#000000",
    down: "#404040",
    grid: "#E0E0E0",
    text: "#000000",
  },
  highContrast: {
    male: "#0055AA",
    female: "#CC0000",
    neutral: "#666666",
    up: "#CC0000",
    down: "#0055AA",
    grid: "#CCCCCC",
    text: "#000000",
  },
  colorblindSafe: {
    male: "#0077BB",
    female: "#EE7733",
    neutral: "#999999",
    up: "#EE7733",
    down: "#0077BB",
    grid: "#DDDDDD",
    text: "#333333",
  },
};

export const DEFAULT_THEME: SharedChartTheme = {
  preset: "default",
  fontSize: 10,
  chartHeight: 220,
  showLegend: true,
  showGrid: true,
  colors: { ...PRESET_COLORS.default },
};

export const DEFAULT_CHART_CUSTOMIZER_CONFIG: ChartCustomizerConfig = {
  theme: { ...DEFAULT_THEME, colors: { ...PRESET_COLORS.default } },
  charts: {},
};

export const CHART_TYPE_LABELS: Record<string, string> = {
  stage: "Stage Means (Bar)",
  line: "Expression Profile (Line)",
  violin: "Expression Distribution (Violin)",
  area: "Stacked Area",
  radar: "Male vs Female Radar",
  heatmap: "Stage × Sex Heatmap",
  zscore: "Z-Score Profile",
  fcbar: "Fold Change (Max vs Min)",
  fctraj: "Fold Change Trajectory",
  dendrogram: "Sample Clustering",
};

export const CHART_TYPE_CHARTJS_MAP: Record<string, string> = {
  stage: "bar",
  line: "line",
  violin: "violin",
  area: "line",
  radar: "radar",
  heatmap: "heatmap",
  zscore: "line",
  fcbar: "bar",
  fctraj: "bar",
  dendrogram: "scatter",
};
