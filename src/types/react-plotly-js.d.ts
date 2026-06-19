declare module "react-plotly.js" {
  import type { ComponentType } from "react";

  type PlotProps = {
    data?: unknown[];
    layout?: Record<string, unknown>;
    config?: Record<string, unknown>;
    style?: Record<string, string | number>;
    onClick?: (event: { points?: Array<{ customdata?: unknown }> }) => void;
  };

  const Plot: ComponentType<PlotProps>;
  export default Plot;
}
