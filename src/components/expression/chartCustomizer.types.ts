export type ChartType =
  | "stage"
  | "line"
  | "violin"
  | "area"
  | "radar"
  | "heatmap"
  | "zscore"
  | "fcbar"
  | "fctraj"
  | "dendrogram";

export type ChartPreset =
  | "default"
  | "print"
  | "highContrast"
  | "colorblindSafe";

export type ScopeLevel = "theme" | "current" | "advanced";

export interface SharedChartTheme {
  preset: ChartPreset;
  fontSize: number;
  chartHeight: number;
  showLegend: boolean;
  showGrid: boolean;
  title?: string;
  subtitle?: string;
  colors: {
    male: string;
    female: string;
    neutral: string;
    up: string;
    down: string;
    grid: string;
    text: string;
  };
}

export interface StageChartStyle {
  showMeanLine?: boolean;
  barRadius?: number;
  showValueLabel?: boolean;
  axisTitle?: string;
}

export interface LineChartStyle {
  lineWidth?: number;
  markerSize?: number;
  showReplicates?: boolean;
  showCIBand?: boolean;
}

export interface ViolinChartStyle {
  showPoints?: boolean;
  opacity?: number;
  axisTitle?: string;
}

export interface AreaChartStyle {
  opacity?: number;
  showMeanLine?: boolean;
}

export interface RadarChartStyle {
  fillOpacity?: number;
  normalizeMode?: "linear" | "log";
}

export interface HeatmapChartStyle {
  showValues?: boolean;
  colorScale?: string;
  colorMin?: number | null;
  colorMax?: number | null;
  labelFontSize?: number;
}

export interface ZScoreChartStyle {
  zeroLineStyle?: "solid" | "dashed";
  showCIBand?: boolean;
  thresholdLines?: number[];
}

export interface FCBarChartStyle {
  showValueLabel?: boolean;
  barWidth?: number;
}

export interface FCTrajectoryChartStyle {
  showReferenceLines?: boolean;
  thresholdLines?: number[];
  showValueLabel?: boolean;
}

export interface DendrogramChartStyle {
  pointSize?: number;
  showLabels?: boolean;
}

export interface PerChartConfig {
  stage?: StageChartStyle;
  line?: LineChartStyle;
  violin?: ViolinChartStyle;
  area?: AreaChartStyle;
  radar?: RadarChartStyle;
  heatmap?: HeatmapChartStyle;
  zscore?: ZScoreChartStyle;
  fcbar?: FCBarChartStyle;
  fctraj?: FCTrajectoryChartStyle;
  dendrogram?: DendrogramChartStyle;
}

export interface ChartCustomizerConfig {
  theme: SharedChartTheme;
  charts: PerChartConfig;
}

export interface ResolvedChartStyle {
  fontSize: number;
  chartHeight: number;
  showLegend: boolean;
  showGrid: boolean;
  title?: string;
  subtitle?: string;
  colors: SharedChartTheme["colors"];
  chartSpecific?: Partial<
    StageChartStyle &
    LineChartStyle &
    ViolinChartStyle &
    AreaChartStyle &
    RadarChartStyle &
    HeatmapChartStyle &
    ZScoreChartStyle &
    FCBarChartStyle &
    FCTrajectoryChartStyle &
    DendrogramChartStyle
  >;
}
