/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "plotly.js-dist-min" {
  // plotly.js-dist-min is a UMD bundle that exports Plotly as default
  const Plotly: any;
  export default Plotly;
}

declare module "react-plotly.js/factory" {
  import { ComponentClass } from "react";
  interface PlotParams {
    data: any[];
    layout?: any;
    config?: any;
    frames?: any[];
    onInitialized?: (figure: any, graphDiv: any) => void;
    onPurge?: () => void;
    onError?: (err: any) => void;
    revision?: number;
    useResizeHandler?: boolean;
    className?: string;
    style?: any;
  }
  function createPlotlyComponent(plotly: any): ComponentClass<PlotParams>;
  export default createPlotlyComponent;
  export { createPlotlyComponent };
}
