export type FullscreenChartType =
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

export interface FullscreenState {
  chartType: FullscreenChartType;
}