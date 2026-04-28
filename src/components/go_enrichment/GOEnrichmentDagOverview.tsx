/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Box,
  Text,
  Group,
  Badge,
  SegmentedControl,
  NumberInput,
  ActionIcon,
  Tooltip,
  Stack,
  Alert,
  Button,
} from "@mantine/core";
import {
  IconMaximize,
  IconZoomIn,
  IconZoomOut,
  IconFocusCentered,
  IconDownload,
  IconAlertTriangle,
  IconLayoutDashboard,
  IconX,
} from "@tabler/icons-react";
import {
  getEnrichmentDagOverview,
  type EnrichmentDagOverviewResponse,
  type EnrichmentTermItem,
} from "../../lib/goDagApi";
import type { GOEnrichmentResult } from "../../lib/goEnrichmentApi";

// ─── Significance color scale (mimics agriGO) ───────────────────────────────

const SIG_COLORS: Record<number, string> = {
  0: "#ffffff",
  1: "#fff733",
  2: "#ffd633",
  3: "#ffb533",
  4: "#ff9933",
  5: "#ff7a1a",
  6: "#ff5c1a",
  7: "#ff3b1a",
  8: "#f51a12",
  9: "#e60000",
};

// ─── Cytoscape Loader (reusing module-level singleton) ───────────────────────

type CyDeps = { cytoscape: any; dagreLayout: any };
let cyLoader: Promise<CyDeps> | null = null;
let dagreRegistered = false;

function loadCytoscape(): Promise<CyDeps> {
  if (!cyLoader) {
    cyLoader = (async () => {
      const cytoscape = (await import("cytoscape")).default;
      const dagreLayout = (await import("cytoscape-dagre")).default;
      return { cytoscape, dagreLayout };
    })();
  }
  return cyLoader;
}

// ─── Popup helpers ──────────────────────────────────────────────────────────

function removeDagPopups() {
  try {
    const popups = document.querySelectorAll(".cy-popup");
    for (let i = 0; i < popups.length; i++) {
      try { popups[i].remove(); } catch { /* already detached */ }
    }
  } catch { /* querySelectorAll failed */ }
}

function showNodePopup(node: any, clientX: number, clientY: number, onDetail?: () => void) {
  removeDagPopups();
  const d = node.data();
  const popup = document.createElement("div");
  popup.className = "cy-popup";
  popup.style.cssText = [
    "position:fixed",
    `top:${Math.min(clientY + 10, window.innerHeight - 280)}px`,
    `left:${Math.min(clientX + 10, window.innerWidth - 360)}px`,
    "background:#fff",
    "border:1px solid #ddd",
    "border-radius:8px",
    "padding:10px 14px",
    "font-size:12px",
    "max-width:320px",
    "z-index:99999",
    "box-shadow:0 4px 16px rgba(0,0,0,0.15)",
    "font-family:Inter,Arial,sans-serif",
    "pointer-events:auto",
  ].join(";");

  const mk = (t: string, s?: Partial<CSSStyleDeclaration>) => {
    const e = Object.assign(document.createElement("span"), { textContent: t });
    if (s) Object.assign(e.style, s);
    return e;
  };

  popup.appendChild(mk(d.id, { fontWeight: "700", fontSize: "13px", display: "block", marginBottom: "4px" }));

  if (d.isEnriched && d.fdr != null) {
    const pval = d.pValue != null ? `p=${d.pValue.toExponential(2)}` : "";
    const fdr = `FDR=${d.fdr.toExponential(2)}`;
    popup.appendChild(mk(`${pval} ${fdr}`, { color: "#666", display: "block", fontSize: "11px", marginBottom: "4px" }));
    if (d.queryCount != null && d.queryTotal != null) {
      popup.appendChild(mk(`Hits: ${d.queryCount}/${d.queryTotal}`, { color: "#333", display: "block", fontSize: "11px", marginBottom: "4px" }));
    }
  }

  popup.appendChild(mk(d.namespace ?? "", { color: "#888", display: "block", fontSize: "10px" }));

  if (d.isEnriched && onDetail) {
    const btn = document.createElement("button");
    btn.textContent = "View Detail";
    btn.style.cssText = [
      "margin-top:8px",
      "padding:4px 10px",
      "background:#1d4ed8",
      "color:#fff",
      "border:none",
      "border-radius:4px",
      "font-size:11px",
      "cursor:pointer",
    ].join(";");
    btn.onclick = () => { removeDagPopups(); onDetail(); };
    popup.appendChild(btn);
  }

  document.body.appendChild(popup);
}

// ─── Build Cytoscape elements ────────────────────────────────────────────────

function buildCyElements(data: EnrichmentDagOverviewResponse): any[] {
  const nodes = data.nodes.map((n) => ({
    data: {
      id: n.id,
      label: n.label,
      fullLabel: n.label,
      namespace: n.namespace,
      depth: n.depth,
      isRoot: n.is_root,
      isEnriched: n.is_enriched,
      significanceLevel: n.significance_level,
      pValue: n.p_value,
      fdr: n.fdr,
      queryCount: n.query_count,
      queryTotal: n.query_total,
      backgroundCount: n.background_count,
      backgroundTotal: n.background_total,
    },
  }));

  const edges = data.edges.map((e) => ({
    data: {
      id: `${e.source}-${e.target}-${e.relation}`,
      source: e.source,
      target: e.target,
      relation: e.relation,
      bothSignificant: e.both_significant,
      oneSignificant: e.one_significant,
    },
  }));

  return [...nodes, ...edges];
}

function buildCyStyle(): any[] {
  return [
    // ── Base node ───────────────────────────────────────────────────────────
    {
      selector: "node",
      style: {
        shape: "roundrectangle",
        label: "data(label)",
        "text-wrap": "wrap",
        "text-max-width": 140,
        "text-valign": "center",
        "text-halign": "center",
        "text-justification": "center",
        width: "label",
        height: "label",
        padding: "10px",
        "font-size": "9px",
        "font-family": "Inter, Arial, sans-serif",
        color: "#334155",
        "background-color": "#ffffff",
        "border-width": 1.5,
        "border-color": "#94a3b8",
      } as any,
    },
    // ── Root node: special look ────────────────────────────────────────────
    {
      selector: "node[isRoot]",
      style: {
        "background-color": "#f1f5f9",
        "border-color": "#475569",
        "border-width": 2,
        "font-weight": "600",
        color: "#1e293b",
      } as any,
    },
    // ── Enriched nodes: significance color ─────────────────────────────────
    ...Object.entries(SIG_COLORS).map(([level, color]) => ({
      selector: `node[significanceLevel=${level}][isEnriched]`,
      style: {
        "background-color": color,
        "border-color": color === "#ffffff" ? "#94a3b8" : color,
        "border-width": color === "#ffffff" ? 1.5 : 1.5,
        "font-weight": "600",
        color: color === "#ffffff" ? "#334155" : "#111827",
      } as any,
    })),
    // ── Edges: taxi style ───────────────────────────────────────────────────
    {
      selector: "edge",
      style: {
        width: 1.5,
        "curve-style": "taxi",
        "taxi-direction": "downward",
        "taxi-turn": 15,
        "line-color": "#94a3b8",
        "target-arrow-color": "#94a3b8",
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.8,
        opacity: 0.7,
      } as any,
    },
    // ── Both-significant edges: darker ─────────────────────────────────────
    {
      selector: "edge[bothSignificant]",
      style: {
        width: 2,
        "line-color": "#475569",
        "target-arrow-color": "#475569",
        opacity: 1.0,
      } as any,
    },
    // ── One-significant edges ──────────────────────────────────────────────
    {
      selector: "edge[oneSignificant]",
      style: {
        width: 1.5,
        "line-color": "#94a3b8",
        "target-arrow-color": "#94a3b8",
        opacity: 0.8,
      } as any,
    },
    // ── part_of edges: dashed ──────────────────────────────────────────────
    {
      selector: 'edge[relation="part_of"]',
      style: {
        "line-style": "dashed",
        "line-dash-pattern": [6, 4],
        "line-color": "#f59e0b",
        "target-arrow-color": "#f59e0b",
        width: 1.2,
      } as any,
    },
    // ── Selection ───────────────────────────────────────────────────────────
    {
      selector: "node:selected",
      style: { "border-width": 3, "border-color": "#1d4ed8" },
    },
    {
      selector: "edge:selected",
      style: { "line-color": "#1d4ed8", "target-arrow-color": "#1d4ed8", width: 2.5 },
    },
  ];
}

function getLayoutOptions(rankDir: string, isFullscreen: boolean): any {
  return {
    name: "dagre",
    rankDir,
    nodeSep: isFullscreen ? 60 : 35,
    rankSep: isFullscreen ? 100 : 75,
    edgeSep: 10,
    ranker: "network-simplex",
    fit: true,
    padding: isFullscreen ? 80 : 40,
    animate: false,
  };
}

// ─── Mount Cytoscape ─────────────────────────────────────────────────────────

function mountCytoscape(opts: {
  container: HTMLDivElement;
  data: EnrichmentDagOverviewResponse;
  rankDir: string;
  isFullscreen: boolean;
  onNodeClick?: (goId: string) => void;
}): () => void {
  let disposed = false;
  let resolvedCy: any = null;

  loadCytoscape()
    .then(({ cytoscape, dagreLayout }) => {
      if (disposed || !opts.container) return;

      if (!dagreRegistered) {
        cytoscape.use(dagreLayout);
        dagreRegistered = true;
      }

      const elements = buildCyElements(opts.data);

      const cy = cytoscape({
        container: opts.container,
        elements,
        style: buildCyStyle(),
        layout: { name: "preset" } as any,
        minZoom: 0.1,
        maxZoom: opts.isFullscreen ? 5 : 4,
      });

      resolvedCy = cy;
      (opts.container as any)._cy = cy;

      if (disposed) { cy.destroy(); return; }

      cy.on("tap", "node", (evt: any) => {
        const nodeData = evt.target.data();
        showNodePopup(
          evt.target,
          evt.originalEvent.clientX,
          evt.originalEvent.clientY,
          opts.onNodeClick ? () => opts.onNodeClick!(nodeData.id) : undefined
        );
      });

      cy.on("tap", (evt: any) => {
        if (evt.target === cy) removeDagPopups();
      });

      cy.layout(getLayoutOptions(opts.rankDir, opts.isFullscreen)).run();

      requestAnimationFrame(() => {
        if (!disposed) { cy.resize(); cy.fit(undefined, opts.isFullscreen ? 60 : 40); }
      });
    })
    .catch((err) => {
      console.error("[GOEnrichmentDagOverview] Cytoscape mount failed:", err);
    });

  return function destroy() {
    disposed = true;
    if (opts.container) (opts.container as any)._cy = null;
    if (resolvedCy) {
      try { resolvedCy.destroy(); } catch { /* already destroyed */ }
    }
  };
}

// ─── Fullscreen Portal (single implementation) ─────────────────────────────

function FullscreenPortal({
  dagData,
  rankDir,
  onClose,
  onNodeClick,
}: {
  dagData: EnrichmentDagOverviewResponse;
  rankDir: string;
  onClose: () => void;
  onNodeClick?: (goId: string) => void;
}) {
  function FullscreenContent() {
    const innerRef = useRef<HTMLDivElement>(null);
    const fsDestroyRef = useRef<(() => void) | null>(null);

    /* eslint-disable react-hooks/exhaustive-deps */
    useEffect(() => {
      const el = innerRef.current;
      if (!el) return;
      removeDagPopups();
      if (fsDestroyRef.current) { fsDestroyRef.current(); fsDestroyRef.current = null; }
      const destroy = mountCytoscape({ container: el, data: dagData, rankDir, isFullscreen: true, onNodeClick });
      fsDestroyRef.current = destroy;
      return () => { if (fsDestroyRef.current) { fsDestroyRef.current(); fsDestroyRef.current = null; } };
    }, [dagData, rankDir, onNodeClick]);
    /* eslint-enable react-hooks/exhaustive-deps */

    const doZoom = (factor: number) => {
      const el = innerRef.current;
      if (!el) return;
      const cy = (el as any)._cy;
      if (cy) cy.zoom(cy.zoom() * factor);
    };

    const doFit = (padding: number) => {
      const el = innerRef.current;
      if (!el) return;
      const cy = (el as any)._cy;
      if (cy) { cy.resize(); cy.fit(undefined, padding); }
    };

    const doExportPng = () => {
      const el = innerRef.current;
      if (!el) return;
      const cy = (el as any)._cy;
      if (!cy) return;
      const png = cy.png({ full: true, scale: 2, bg: "#ffffff" });
      const a = document.createElement("a");
      a.href = png;
      a.download = `enrichment_dag_${dagData.ontology}_${Date.now()}.png`;
      a.click();
    };

    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 10000,
          background: "rgba(0,0,0,0.75)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 16px",
            background: "#fff",
            borderBottom: "1px solid #e0e0e0",
            flexShrink: 0,
          }}
        >
          <Group gap="xs">
            <Text fw={700}>Enrichment DAG Overview</Text>
            <Badge size="xs" variant="light" color="blue">{dagData.ontology === "P" ? "Biological Process" : dagData.ontology === "C" ? "Cellular Component" : "Molecular Function"}</Badge>
            <Text size="xs" c="dimmed">{dagData.node_count_returned} nodes</Text>
          </Group>
          <Group gap="xs">
            <Button size="xs" variant="light" leftSection={<IconDownload size={14} />} onClick={doExportPng}>Export PNG</Button>
            <ActionIcon variant="subtle" size="lg" onClick={onClose}>
              <IconX size={18} />
            </ActionIcon>
          </Group>
        </div>

        {/* Graph area */}
        <div
          ref={innerRef}
          style={{
            flex: 1,
            width: "100%",
            minHeight: 0,
            background: "#fafafa",
            position: "relative",
            paddingTop: 40,
          }}
        >
          {/* Title */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              padding: "8px 16px",
              background: "rgba(255,255,255,0.96)",
              borderBottom: "1px solid #e5e7eb",
              zIndex: 5,
              fontSize: 12,
              fontWeight: 600,
              color: "#374151",
              fontFamily: "Inter, Arial, sans-serif",
            }}
          >
            Enrichment DAG — {dagData.ontology === "P" ? "Biological Process" : dagData.ontology === "C" ? "Cellular Component" : "Molecular Function"}
            {dagData.truncated && <span style={{ color: "#f59e0b", marginLeft: 8 }}>⚠ truncated</span>}
          </div>
        </div>

        {/* Toolbar */}
        <div
          style={{
            position: "absolute",
            bottom: 24,
            right: 24,
            zIndex: 10,
            background: "#fff",
            borderRadius: 8,
            padding: "8px 10px",
            boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
            display: "flex",
            gap: 6,
          }}
        >
          <Tooltip label="Zoom in">
            <ActionIcon variant="light" size="md" onClick={() => doZoom(1.3)}>
              <IconZoomIn size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Zoom out">
            <ActionIcon variant="light" size="md" onClick={() => doZoom(1 / 1.3)}>
              <IconZoomOut size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Fit to view">
            <ActionIcon variant="light" size="md" onClick={() => doFit(60)}>
              <IconFocusCentered size={16} />
            </ActionIcon>
          </Tooltip>
        </div>
      </div>
    );
  }

  return createPortal(<FullscreenContent />, document.body);
}

// ─── Legend ──────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <Group gap="lg" style={{ flexWrap: "wrap" }}>
      {/* Significance scale */}
      <Group gap={4}>
        <Text size="xs" c="dimmed">FDR:</Text>
        {Object.entries(SIG_COLORS).slice(1).map(([level, color]) => (
          <Box
            key={level}
            w={12}
            h={12}
            style={{
              borderRadius: 2,
              background: color,
              border: `1px solid ${color === "#ffffff" ? "#e2e8f0" : color}`,
              cursor: "default",
            }}
            title={`Level ${level}`}
          />
        ))}
        <Box w={12} h={12} style={{ borderRadius: 2, background: "#ffffff", border: "1px solid #e2e8f0" }} title="Not significant" />
        <Text size="xs" c="dimmed">ns</Text>
      </Group>
      {/* Edge types */}
      <Group gap={4}>
        <Box w={20} h={2} style={{ background: "#94a3b8" }} />
        <Text size="xs">is_a</Text>
      </Group>
      <Group gap={4}>
        <Box w={20} h={2} style={{ borderTop: "2px dashed #f59e0b" }} />
        <Text size="xs">part_of</Text>
      </Group>
      {/* Root indicator */}
      <Group gap={4}>
        <Box w={12} h={12} style={{ borderRadius: 3, background: "#f1f5f9", border: "2px solid #475569" }} />
        <Text size="xs">Root</Text>
      </Group>
    </Group>
  );
}

// ─── Component Props ─────────────────────────────────────────────────────────

interface Props {
  results: GOEnrichmentResult[];
  fdrCutoff: number;
  onTermClick?: (term: GOEnrichmentResult) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function GOEnrichmentDagOverview({ results, fdrCutoff, onTermClick }: Props) {
  const graphHostRef = useRef<HTMLDivElement>(null);
  const mainDestroyRef = useRef<(() => void) | null>(null);
  const fetchCountRef = useRef(0);

  const [activeOntology, setActiveOntology] = useState<"P" | "C" | "F">("P");
  const [rankDir, setRankDir] = useState<"TB" | "BT">("TB");
  const [maxNodes, setMaxNodes] = useState<number>(150);

  const [dagData, setDagData] = useState<EnrichmentDagOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  // Preload cytoscape
  useEffect(() => {
    loadCytoscape().catch(() => {});
  }, []);

  // Fetch DAG data
  const fetchDag = useCallback(
    (ontology: "P" | "C" | "F") => {
      if (mainDestroyRef.current) { mainDestroyRef.current(); mainDestroyRef.current = null; }
      removeDagPopups();

      setLoading(true);
      setErrorMsg(null);
      setDagData(null);

      const termsForApi: EnrichmentTermItem[] = results.map((r) => ({
        go_id: r.go_id,
        term_name: r.term_name,
        namespace: r.namespace,
        ontology: r.ontology,
        query_count: r.query_count,
        query_total: r.query_total,
        background_count: r.background_count,
        background_total: r.background_total,
        p_value: r.p_value,
        fdr: r.fdr,
        significant: r.significant,
      }));

      const fetchId = ++fetchCountRef.current;

      getEnrichmentDagOverview({
        terms: termsForApi,
        ontology,
        fdr_cutoff: fdrCutoff,
        include_is_a: true,
        include_part_of: true,
        max_nodes: maxNodes,
      })
        .then((data) => {
          if (fetchId !== fetchCountRef.current) return;
          setDagData(data);
          setLoading(false);
        })
        .catch((err: Error) => {
          if (fetchId !== fetchCountRef.current) return;
          setErrorMsg(err.message ?? "Failed to load DAG overview");
          setLoading(false);
        });
    },
    [results, fdrCutoff, maxNodes]
  );

  // Fetch when ontology or params change
  useEffect(() => {
    if (results.length === 0) return;
    queueMicrotask(() => {
      fetchDag(activeOntology);
    });
  }, [fetchDag, activeOntology, results.length]);

  // Mount Cytoscape when data arrives
  useEffect(() => {
    if (!dagData || !graphHostRef.current || dagData.nodes.length === 0) return;
    const el = graphHostRef.current;
    if ((el as any)._cy) return;

    if (el.offsetWidth === 0 || el.offsetHeight === 0) {
      let ro: ResizeObserver | null = null;
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const tryInit = () => {
        if (settled || !graphHostRef.current) return;
        const container = graphHostRef.current;
        if (container.offsetWidth === 0 || container.offsetHeight === 0) return;
        settled = true;
        if (ro) { ro.disconnect(); ro = null; }
        if (timeout) clearTimeout(timeout);
        if (mainDestroyRef.current) { mainDestroyRef.current(); mainDestroyRef.current = null; }
        removeDagPopups();
        const destroy = mountCytoscape({
          container,
          data: dagData,
          rankDir,
          isFullscreen: false,
          onNodeClick: (goId) => {
            const term = results.find((r) => r.go_id === goId);
            if (term && onTermClick) onTermClick(term);
          },
        });
        mainDestroyRef.current = destroy;
      };

      tryInit();
      ro = new ResizeObserver(() => { if (!settled) tryInit(); });
      ro.observe(el);
      timeout = setTimeout(() => {
        if (!settled && graphHostRef.current && !((graphHostRef.current as any)._cy)) tryInit();
      }, 1500);

      return () => {
        settled = true;
        if (ro) { ro.disconnect(); }
        if (timeout) clearTimeout(timeout);
        if (mainDestroyRef.current) { mainDestroyRef.current(); mainDestroyRef.current = null; }
      };
    }

    removeDagPopups();
    const destroy = mountCytoscape({
      container: el,
      data: dagData,
      rankDir,
      isFullscreen: false,
      onNodeClick: (goId) => {
        const term = results.find((r) => r.go_id === goId);
        if (term && onTermClick) onTermClick(term);
      },
    });
    mainDestroyRef.current = destroy;

    return () => {
      if (mainDestroyRef.current) { mainDestroyRef.current(); mainDestroyRef.current = null; }
    };
  }, [dagData, rankDir, onTermClick, results]);

  const doZoom = (factor: number) => {
    const el = graphHostRef.current;
    if (!el) return;
    const cy = (el as any)._cy;
    if (cy) cy.zoom(cy.zoom() * factor);
  };

  const doFit = (padding: number) => {
    const el = graphHostRef.current;
    if (!el) return;
    const cy = (el as any)._cy;
    if (cy) { cy.resize(); cy.fit(undefined, padding); }
  };

  const doExportPng = () => {
    const el = graphHostRef.current;
    if (!el) return;
    const cy = (el as any)._cy;
    if (!cy) return;
    const png = cy.png({ full: true, scale: 2, bg: "#ffffff" });
    const a = document.createElement("a");
    a.href = png;
    a.download = `enrichment_dag_${activeOntology}_${Date.now()}.png`;
    a.click();
  };

  const sigCounts = {
    P: results.filter(r => r.ontology === "P" && r.significant && r.fdr <= fdrCutoff).length,
    C: results.filter(r => r.ontology === "C" && r.significant && r.fdr <= fdrCutoff).length,
    F: results.filter(r => r.ontology === "F" && r.significant && r.fdr <= fdrCutoff).length,
  };

  return (
    <>
      <Stack gap="xs">
        {/* Controls */}
        <Group gap="xs" wrap="wrap" align="flex-end">
          {/* Ontology tabs with counts */}
          <SegmentedControl
            size="xs"
            data={[
              { value: "P", label: `BP (${sigCounts.P})` },
              { value: "C", label: `CC (${sigCounts.C})` },
              { value: "F", label: `MF (${sigCounts.F})` },
            ]}
            value={activeOntology}
            onChange={(v) => v && setActiveOntology(v as "P" | "C" | "F")}
          />
          <SegmentedControl
            size="xs"
            data={[
              { value: "TB", label: "Top→Bottom" },
              { value: "BT", label: "Bottom→Top" },
            ]}
            value={rankDir}
            onChange={(v) => v && setRankDir(v as "TB" | "BT")}
          />
          <NumberInput
            label="Max nodes"
            size="xs"
            value={maxNodes}
            onChange={(v) => setMaxNodes(Number(v) || 150)}
            min={20}
            max={500}
            step={20}
            style={{ width: 80 }}
          />
          <Group gap={2} align="center" mt={4}>
            <Tooltip label="Zoom in">
              <ActionIcon variant="light" size="sm" onClick={() => doZoom(1.3)}>
                <IconZoomIn size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Zoom out">
              <ActionIcon variant="light" size="sm" onClick={() => doZoom(1 / 1.3)}>
                <IconZoomOut size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Fit to view">
              <ActionIcon variant="light" size="sm" onClick={() => doFit(40)}>
                <IconFocusCentered size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Export PNG">
              <ActionIcon variant="light" size="sm" onClick={doExportPng} disabled={!dagData}>
                <IconDownload size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Fullscreen">
              <ActionIcon variant="light" size="sm" onClick={() => setFullscreenOpen(true)} disabled={!dagData}>
                <IconMaximize size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {/* Truncation warning */}
        {dagData?.truncated && (
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={14} />} py={4}>
            Graph truncated to {dagData.node_count_returned} of {dagData.node_count_total} nodes.
            Increase max nodes or reduce FDR cutoff.
          </Alert>
        )}

        {/* Error */}
        {errorMsg && (
          <Alert color="red" variant="light" py={4}>{errorMsg}</Alert>
        )}

        {/* Legend */}
        {dagData && dagData.nodes.length > 0 && <Legend />}

        {/* Cytoscape container */}
        <Box
          style={{
            height: 500,
            borderRadius: 8,
            border: "1px solid #e0e0e0",
            background: "#fafafa",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            ref={graphHostRef}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              paddingTop: 36,
            }}
          />
          {/* Title bar */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              padding: "6px 12px",
              background: "rgba(255,255,255,0.96)",
              borderBottom: "1px solid #e5e7eb",
              zIndex: 5,
              fontSize: 11,
              fontWeight: 600,
              color: "#374151",
              fontFamily: "Inter, Arial, sans-serif",
            }}
          >
            Enrichment DAG Overview —&nbsp;
            {activeOntology === "P" ? "Biological Process" : activeOntology === "C" ? "Cellular Component" : "Molecular Function"}
            {dagData && ` (${dagData.node_count_returned} nodes)`}
            {dagData?.truncated && <span style={{ color: "#f59e0b", marginLeft: 6 }}>⚠ truncated</span>}
          </div>
          {loading && (
            <Box
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(250,250,250,0.9)",
                zIndex: 3,
              }}
            >
              <Text c="dimmed" size="sm">Loading DAG overview...</Text>
            </Box>
          )}
          {!loading && dagData && dagData.nodes.length === 0 && (
            <Box
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 3,
              }}
            >
              <Stack align="center" gap={4}>
                <IconLayoutDashboard size={28} color="#adb5bd" />
                <Text c="dimmed" size="sm">No significant terms for {activeOntology === "P" ? "Biological Process" : activeOntology === "C" ? "Cellular Component" : "Molecular Function"}</Text>
              </Stack>
            </Box>
          )}
        </Box>

        <Text size="xs" c="dimmed" ta="center">
          Click nodes for details. Click "View Detail" in popup to open term drawer.
        </Text>
      </Stack>

      {/* Fullscreen */}
      {fullscreenOpen && dagData && (
        <FullscreenPortal
          dagData={dagData}
          rankDir={rankDir}
          onClose={() => setFullscreenOpen(false)}
          onNodeClick={(goId: string) => {
            const term = results.find((r) => r.go_id === goId);
            if (term && onTermClick) {
              onTermClick(term);
              setFullscreenOpen(false);
            }
          }}
        />
      )}
    </>
  );
}
