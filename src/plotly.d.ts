/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "plotly.js-dist-min" {
  export default any;
}

declare module "react-plotly.js/factory" {
  import { ComponentType, ComponentClass } from "react";
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
