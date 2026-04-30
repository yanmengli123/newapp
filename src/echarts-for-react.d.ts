declare module "echarts-for-react" {
  import type { ComponentType } from "react";

  export interface ReactEChartsProps {
    option: unknown;
    style?: React.CSSProperties;
    opts?: Record<string, unknown>;
    notMerge?: boolean;
    lazyUpdate?: boolean;
    onEvents?: Record<string, (params: any) => void>;
  }

  const ReactECharts: ComponentType<ReactEChartsProps>;
  export default ReactECharts;
}
