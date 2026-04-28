declare module "cytoscape-dagre" {
  import { Core, LayoutOptions } from "cytoscape";

  interface DagreLayoutOptions extends LayoutOptions {
    name: "dagre";
    rankDir?: "TB" | "BT" | "LR" | "RL";
    rankSep?: number;
    nodeSep?: number;
    edgeSep?: number;
    marginX?: number;
    marginY?: number;
    acyclicer?: "greedy" | "allow";
    ranker?: "network-simplex" | "tight-verts" | "longest-path";
    animate?: boolean | "end";
    animationDuration?: number;
    animationEasing?: string;
    fit?: boolean;
    padding?: number;
    nodeDimensionsIncludeLabels?: boolean;
  }

  function dagreLayout(cytoscape: Core): DagreLayoutOptions;
  export = dagreLayout;
}
