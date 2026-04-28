import { apiFetch } from "./apiClient";

export interface GoDagNode {
  id: string;
  label: string;
  namespace: string;
  depth: number;
  is_center: boolean;
  gene_count_direct?: number;
  gene_count_propagated?: number;
}

export interface GoDagEdge {
  source: string;
  target: string;
  relation: "is_a" | "part_of";
}

export interface GoDagResponse {
  center: string;
  resolved_center: string;
  direction: string;
  depth: number;
  nodes: GoDagNode[];
  edges: GoDagEdge[];
  truncated: boolean;
  node_count_total: number;
  node_count_returned: number;
  metadata: Record<string, unknown>;
}

export interface GoDagMetadata {
  ready: boolean;
  term_count: number;
  edge_count: number;
  closure_count: number;
  data_version: string | null;
  loaded_at: string | null;
  include_part_of: string | null;
  obo_path: string | null;
}

export type DagDirection = "ancestors" | "descendants" | "both";

export interface GetDagOptions {
  direction?: DagDirection;
  depth?: number;
  include_is_a?: boolean;
  include_part_of?: boolean;
  max_nodes?: number;
}

export async function getGOTermDag(
  goId: string,
  options: GetDagOptions = {}
): Promise<GoDagResponse> {
  const params = new URLSearchParams();
  if (options.direction) params.set("direction", options.direction);
  if (options.depth != null) params.set("depth", String(options.depth));
  if (options.include_is_a != null)
    params.set("include_is_a", String(options.include_is_a));
  if (options.include_part_of != null)
    params.set("include_part_of", String(options.include_part_of));
  if (options.max_nodes != null)
    params.set("max_nodes", String(options.max_nodes));

  const qs = params.toString();
  const path = qs
    ? `/go-enrichment/term/${goId}/dag?${qs}`
    : `/go-enrichment/term/${goId}/dag`;

  return apiFetch<GoDagResponse>(path);
}

export async function getGODagMetadata(): Promise<GoDagMetadata> {
  return apiFetch<GoDagMetadata>("/go-enrichment/dag/metadata");
}
