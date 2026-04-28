/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Box,
  NumberInput,
  Stack,
  Text,
  Group,
  Badge,
  Switch,
  Tooltip,
  ActionIcon,
  Alert,
  SegmentedControl,
} from "@mantine/core";
import {
  IconZoomIn,
  IconZoomOut,
  IconFocusCentered,
  IconAlertTriangle,
  IconArrowUp,
  IconArrowDown,
  IconArrowsExchange,
  IconMaximize,
  IconX,
} from "@tabler/icons-react";
import {
  getGOTermDag,
  getGODagMetadata,
  type GoDagResponse,
  type GoDagMetadata,
  type DagDirection,
} from "../../lib/goDagApi";

// ─── Label / text helpers ────────────────────────────────────────────────────

const MAX_CHARS_MAIN = 55;
const MAX_CHARS_FULLSCREEN = 80;

function truncateName(name: string, maxChars: number): string {
  return name.length > maxChars ? `${name.slice(0, maxChars - 1)}...` : name;
}

// ─── Cytoscape Loader ────────────────────────────────────────────────────────

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

// ─── Popup helpers ─────────────────────────────────────────────────────────

function removeDagPopups() {
  try {
    const popups = document.querySelectorAll(".cy-popup");
    for (let i = 0; i < popups.length; i++) {
      try { popups[i].remove(); } catch { /* already detached */ }
    }
  } catch { /* querySelectorAll failed */ }
}

function showNodePopup(node: any, clientX: number, clientY: number) {
  removeDagPopups();
  const d = node.data();
  const popup = document.createElement("div");
  popup.className = "cy-popup";
  popup.style.cssText = [
    "position:fixed",
    `top:${Math.min(clientY + 10, window.innerHeight - 230)}px`,
    `left:${Math.min(clientX + 10, window.innerWidth - 330)}px`,
    "background:#fff;border:1px solid #ddd;border-radius:6px",
    "padding:8px 12px;font-size:12px;max-width:300px;z-index:99999",
    "box-shadow:0 2px 8px rgba(0,0,0,0.15);font-family:monospace",
    "pointer-events:none",
  ].join(";");

  const mk = (t: string, s?: Partial<CSSStyleDeclaration>) => {
    const e = Object.assign(document.createElement("span"), { textContent: t });
    if (s) Object.assign(e.style, s);
    return e;
  };

  popup.appendChild(mk(d.id, { fontWeight: "bold", fontSize: "11px" }));
  popup.appendChild(document.createElement("br"));
  popup.appendChild(mk(d.fullLabel, { color: "#555" }));
  popup.appendChild(document.createElement("br"));
  popup.appendChild(mk(`${NS_LABELS[d.namespace] ?? d.namespace}  depth=${d.depth}`, { color: "#888" }));
  popup.appendChild(document.createElement("br"));
  popup.appendChild(mk("Direct: "));
  popup.appendChild(Object.assign(document.createElement("b"), { textContent: String(d.geneCountDirect) }));
  popup.appendChild(document.createElement("br"));
  popup.appendChild(mk("Propagated: "));
  popup.appendChild(Object.assign(document.createElement("b"), { textContent: String(d.geneCountPropagated) }));
  popup.appendChild(Object.assign(document.createElement("span"), {
    textContent: " (via full closure)", style: { color: "#aaa", fontSize: "10px" }
  }));
  document.body.appendChild(popup);
}

function showEdgePopup(edge: any, clientX: number, clientY: number) {
  removeDagPopups();
  const d = edge.data();
  const popup = document.createElement("div");
  popup.className = "cy-popup";
  popup.style.cssText = [
    "position:fixed",
    `top:${Math.min(clientY + 10, window.innerHeight - 80)}px`,
    `left:${Math.min(clientX + 10, window.innerWidth - 240)}px`,
    "background:#fff;border:1px solid #ddd;border-radius:6px",
    "padding:6px 10px;font-size:12px;z-index:99999",
    "box-shadow:0 2px 8px rgba(0,0,0,0.15);font-family:monospace",
    "pointer-events:none",
  ].join(";");
  const label = d.relation === "is_a" ? "is_a (inheritance)" : "part_of (partonomy)";
  popup.appendChild(Object.assign(document.createElement("b"), { textContent: label }));
  popup.appendChild(document.createTextNode(" relationship"));
  document.body.appendChild(popup);
}

// ─── Graph builders ──────────────────────────────────────────────────────────

function buildCyElements(data: GoDagResponse, isFullscreen: boolean): any[] {
  const maxChars = isFullscreen ? MAX_CHARS_FULLSCREEN : MAX_CHARS_MAIN;
  return [
    ...data.nodes.map((n) => ({
      data: {
        id: n.id,
        label: `${n.id}\n${truncateName(n.label, maxChars)}`,
        fullLabel: n.label,
        namespace: n.namespace,
        isCenter: n.is_center,
        depth: n.depth,
        geneCountDirect: n.gene_count_direct ?? 0,
        geneCountPropagated: n.gene_count_propagated ?? 0,
      },
    })),
    ...data.edges.map((e) => ({
      data: {
        id: `${e.source}-${e.target}-${e.relation}`,
        source: e.source,
        target: e.target,
        relation: e.relation,
      },
    })),
  ];
}

function buildCyStyle(isFullscreen: boolean): any[] {
  const textMaxWidth = isFullscreen ? 220 : 160;

  return [
    // ── Base node: roundrectangle, label-wrap, size auto-fitted ──────────────
    {
      selector: "node",
      style: {
        shape: "roundrectangle",
        label: "data(label)",
        "text-wrap": "wrap",
        "text-max-width": textMaxWidth,
        "text-valign": "center",
        "text-halign": "center",
        "text-justification": "center",
        width: "label",
        height: "label",
        padding: "12px",
        "font-size": "10px",
        "font-family": "Inter, Arial, sans-serif",
        color: "#475569",
        "background-color": "#f8fafc",
        "border-width": 1.5,
        "border-color": "#cbd5e1",
      } as any,
    },
    // ── Namespace: white background, colored border only (ancestor nodes stay neutral) ──
    {
      selector: 'node[namespace="biological_process"]',
      style: { "border-color": "#3b82f6" },
    },
    {
      selector: 'node[namespace="cellular_component"]',
      style: { "border-color": "#ef4444" },
    },
    {
      selector: 'node[namespace="molecular_function"]',
      style: { "border-color": "#22c55e" },
    },
    // ── Center node: amber highlight — target of the query ─────────────────
    {
      selector: "node[isCenter]",
      style: {
        "background-color": "#fef08a",
        "border-color": "#ca8a04",
        "border-width": 3,
        "font-weight": "700",
        color: "#111827",
      },
    },
    // ── Edges: taxi routing, gray for is_a ─────────────────────────────────
    {
      selector: "edge",
      style: {
        width: 2,
        "curve-style": "taxi",
        "taxi-direction": "upward",
        "taxi-turn": 20,
        "line-color": "#94a3b8",
        "target-arrow-color": "#94a3b8",
        "target-arrow-shape": "triangle",
        "arrow-scale": 1.0,
      } as any,
    },
    // ── part_of: dashed orange (distinct from is_a) ─────────────────────────
    {
      selector: 'edge[relation="part_of"]',
      style: {
        "line-style": "dashed",
        "line-dash-pattern": [6, 4],
        "line-color": "#f59e0b",
        "target-arrow-color": "#f59e0b",
        "target-arrow-shape": "triangle",
        width: 1.5,
      } as any,
    },
    // ── Selection state ─────────────────────────────────────────────────────
    {
      selector: "node:selected",
      style: { "border-width": 3, "border-color": "#e67700" },
    },
    {
      selector: "edge:selected",
      style: { "line-color": "#e67700", "target-arrow-color": "#e67700", width: 2.5 },
    },
  ];
}

function getLayoutOptions(isFullscreen: boolean): any {
  if (isFullscreen) {
    return {
      name: "dagre",
      rankDir: "BT",
      nodeSep: 140,
      rankSep: 180,
      edgeSep: 30,
      ranker: "network-simplex",
      fit: true,
      padding: 60,
      animate: false,
    };
  }
  return {
    name: "dagre",
    rankDir: "BT",
    nodeSep: 80,
    rankSep: 120,
    edgeSep: 20,
    ranker: "network-simplex",
    fit: true,
    padding: 30,
    animate: false,
  };
}

// ─── Mount Cytoscape into a container ──────────────────────────────────────

function mountCytoscape(opts: {
  container: HTMLDivElement;
  data: GoDagResponse;
  isFullscreen: boolean;
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

    const elements = buildCyElements(opts.data, opts.isFullscreen);

    const cy = cytoscape({
      container: opts.container,
      elements,
      style: buildCyStyle(opts.isFullscreen),
      layout: { name: "preset" } as any,
      minZoom: 0.1,
      maxZoom: opts.isFullscreen ? 5 : 4,
    });

    resolvedCy = cy;
    (opts.container as any)._cy = cy;

    if (disposed) { cy.destroy(); return; }

    cy.on("tap", "node", (evt: any) => {
      showNodePopup(evt.target, evt.originalEvent.clientX, evt.originalEvent.clientY);
    });

    cy.on("tap", "edge", (evt: any) => {
      showEdgePopup(evt.target, evt.originalEvent.clientX, evt.originalEvent.clientY);
    });

    cy.on("tap", (evt: any) => {
      if (evt.target === cy) removeDagPopups();
    });

    // Init layout with no animation — avoids first-render white screen
    cy.layout(getLayoutOptions(opts.isFullscreen)).run();

    // Ensure graph fits after layout
    requestAnimationFrame(() => {
      if (!disposed) { cy.resize(); cy.fit(undefined, opts.isFullscreen ? 50 : 30); }
    });
  })
  .catch((err) => {
    console.error("[GOTermDagViewer] Cytoscape mount failed:", err);
  });

  return function destroy() {
    disposed = true;
    if (opts.container) (opts.container as any)._cy = null;
    if (resolvedCy) {
      try { resolvedCy.destroy(); } catch { /* already destroyed */ }
    }
  };
}

// ─── Fullscreen Portal Overlay ──────────────────────────────────────────────

function FullscreenOverlay({
  dagData,
  onClose,
}: {
  dagData: GoDagResponse;
  onClose: () => void;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const fsDestroyRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;

    removeDagPopups();
    if (fsDestroyRef.current) { fsDestroyRef.current(); fsDestroyRef.current = null; }

    const destroy = mountCytoscape({ container: el, data: dagData, isFullscreen: true });
    fsDestroyRef.current = destroy;

    return () => {
      if (fsDestroyRef.current) { fsDestroyRef.current(); fsDestroyRef.current = null; }
    };
  }, [dagData]);

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

  return createPortal(
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
      {/* Header bar */}
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
          <Text fw={700}>DAG View — Fullscreen</Text>
          <Badge size="xs" variant="light" color="gray">{dagData.center}</Badge>
        </Group>
        <ActionIcon variant="subtle" size="lg" onClick={onClose}>
          <IconX size={18} />
        </ActionIcon>
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
          paddingTop: 44,
        }}
      >
        {/* DAG title bar */}
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
          Ancestor Chart for&nbsp;
          <span style={{ color: "#1d4ed8" }}>{dagData?.center}</span>
        </div>
      </div>

      {/* Floating toolbar */}
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
          <ActionIcon variant="light" size="md" onClick={() => doFit(50)}>
            <IconFocusCentered size={16} />
          </ActionIcon>
        </Tooltip>
      </div>
    </div>,
    document.body
  );
}

// ─── Legend colours (pastel to match new node palette) ─────────────────────

const LEGEND_COLORS: Record<string, string> = {
  biological_process: "#3b82f6",
  cellular_component: "#ef4444",
  molecular_function: "#22c55e",
};

const NS_LABELS: Record<string, string> = {
  biological_process: "BP",
  cellular_component: "CC",
  molecular_function: "MF",
};

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  goId: string;
}

export default function GOTermDagViewer({ goId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphHostRef = useRef<HTMLDivElement>(null);

  const [direction, setDirection] = useState<DagDirection>("ancestors");
  const [depth, setDepth] = useState<number>(3);
  const [includeIsA, setIncludeIsA] = useState(true);
  const [includePartOf, setIncludePartOf] = useState(true);
  const [dagData, setDagData] = useState<GoDagResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dagMeta, setDagMeta] = useState<GoDagMetadata | null>(null);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  // Lifecycle refs
  const mainDestroyRef = useRef<(() => void) | null>(null);
  const fetchCountRef = useRef(0);

  // Load metadata once
  useEffect(() => {
    getGODagMetadata().then(setDagMeta).catch(() => {});
  }, []);

  // Preload cytoscape on mount
  useEffect(() => {
    loadCytoscape().catch(() => {});
  }, []);

  // ── Fetch ───────────────────────────────────────────────────────────────────

  const fetchDag = useCallback(
    (dir: DagDirection, d: number, isa: boolean, part: boolean) => {
      if (mainDestroyRef.current) { mainDestroyRef.current(); mainDestroyRef.current = null; }
      removeDagPopups();

      setLoading(true);
      setRendering(false);
      setErrorMsg(null);
      setDagData(null);

      const fetchId = ++fetchCountRef.current;

      getGOTermDag(goId, {
        direction: dir, depth: d,
        include_is_a: isa, include_part_of: part,
        max_nodes: 80,
      })
        .then((data) => {
          if (fetchId !== fetchCountRef.current) return;
          setDagData(data);
          setLoading(false);
        })
        .catch((err: Error) => {
          if (fetchId !== fetchCountRef.current) return;
          setErrorMsg(err.message ?? "Failed to load DAG");
          setLoading(false);
        });
    },
    [goId]
  );

  useEffect(() => {
    queueMicrotask(() => {
      fetchDag(direction, depth, includeIsA, includePartOf);
    });
  }, [fetchDag, direction, depth, includeIsA, includePartOf]);

  // ── Main graph effect ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!dagData || !graphHostRef.current) return;
    if (dagData.nodes.length === 0) return;

    const el = graphHostRef.current;
    if ((el as any)._cy) return;

    queueMicrotask(() => setRendering(true));

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

        const destroy = mountCytoscape({ container, data: dagData!, isFullscreen: false });
        mainDestroyRef.current = destroy;
      };

      tryInit();
      ro = new ResizeObserver(() => { if (!settled) tryInit(); });
      ro.observe(el);
      timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          if (ro) { ro.disconnect(); ro = null; }
          if (graphHostRef.current && !((graphHostRef.current as any)._cy)) tryInit();
        }
      }, 1500);

      return () => {
        settled = true;
        if (ro) { ro.disconnect(); ro = null; }
        if (timeout) clearTimeout(timeout);
        if (mainDestroyRef.current) { mainDestroyRef.current(); mainDestroyRef.current = null; }
      };
    }

    removeDagPopups();
    const destroy = mountCytoscape({ container: el, data: dagData, isFullscreen: false });
    mainDestroyRef.current = destroy;

    return () => {
      destroy();
      mainDestroyRef.current = null;
    };
  }, [dagData]);

  // ── Fullscreen ─────────────────────────────────────────────────────────────

  const handleOpenFullscreen = () => {
    setFullscreenOpen(true);
  };

  const handleCloseFullscreen = () => {
    removeDagPopups();
    setFullscreenOpen(false);
  };

  // ── Toolbar helpers ──────────────────────────────────────────────────────

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

  const version = dagMeta?.data_version ?? "--";
  const loadedAt = dagMeta?.loaded_at
    ? new Date(dagMeta.loaded_at).toLocaleDateString()
    : "--";

  return (
    <>
      <Stack gap="xs">
        {/* Metadata badge */}
        <Group gap="xs">
          <Text size="xs" c="dimmed">GO DAG:</Text>
          <Badge size="xs" variant="light" color="gray">
            go-basic.obo {version}
          </Badge>
          <Text size="xs" c="dimmed">Loaded: {loadedAt}</Text>
        </Group>

        {/* Controls */}
        <Group gap="xs" wrap="wrap" align="flex-end">
          <SegmentedControl
            size="xs"
            data={[
              { value: "ancestors", label: <Group gap={4}><IconArrowUp size={12} /><Text size="xs">Ancestors</Text></Group> },
              { value: "descendants", label: <Group gap={4}><IconArrowDown size={12} /><Text size="xs">Descendants</Text></Group> },
              { value: "both", label: <Group gap={4}><IconArrowsExchange size={12} /><Text size="xs">Both</Text></Group> },
            ]}
            value={direction}
            onChange={(v) => v && setDirection(v as DagDirection)}
          />
          <NumberInput
            label="Depth" size="xs" value={depth}
            onChange={(v) => setDepth(Number(v) || 3)}
            min={1} max={6} step={1} style={{ width: 65 }}
          />
          <Group gap={4} align="center" mt={4}>
            <Switch size="xs" label="is_a" checked={includeIsA} onChange={(e) => setIncludeIsA(e.currentTarget.checked)} />
            <Switch size="xs" label="part_of" checked={includePartOf} onChange={(e) => setIncludePartOf(e.currentTarget.checked)} />
          </Group>
          <Group gap={2} align="flex-end" mt={4}>
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
              <ActionIcon variant="light" size="sm" onClick={() => doFit(30)}>
                <IconFocusCentered size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Fullscreen">
              <ActionIcon variant="light" size="sm" onClick={handleOpenFullscreen}>
                <IconMaximize size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {/* Truncation warning */}
        {dagData?.truncated && (
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={14} />} py={4}>
            Graph truncated to {dagData.node_count_returned} of {dagData.node_count_total} nodes.
            Reduce depth or switch direction.
          </Alert>
        )}

        {/* Error display */}
        {errorMsg && (
          <Alert color="red" variant="light" py={4}>{errorMsg}</Alert>
        )}

        {/* Legend — updated to pastel palette + orange for part_of */}
        <Group gap="lg">
          {Object.entries(NS_LABELS).map(([ns, label]) => (
            <Group key={ns} gap={4}>
              <Box w={12} h={12} style={{ borderRadius: 3, border: `2px solid ${LEGEND_COLORS[ns]}`, background: `${LEGEND_COLORS[ns]}22` }} />
              <Text size="xs">{label}</Text>
            </Group>
          ))}
          <Group gap={4}><Box w={20} h={2} style={{ background: "#94a3b8" }} /><Text size="xs">is_a</Text></Group>
          <Group gap={4}><Box w={20} h={2} style={{ borderTop: "2px dashed #f59e0b" }} /><Text size="xs">part_of</Text></Group>
          <Group gap={4}>
            <Box w={12} h={12} style={{ borderRadius: 3, border: "2px solid #ca8a04", background: "#fef08a" }} />
            <Text size="xs">Target term</Text>
          </Group>
        </Group>

        {/* Main Cytoscape container */}
        <Box
          ref={containerRef}
          style={{
            height: 400,
            borderRadius: 8,
            border: "1px solid #e0e0e0",
            background: "#fafafa",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* DAG title bar */}
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
            Ancestor Chart for&nbsp;
            <span style={{ color: "#1d4ed8" }}>{dagData?.center ?? goId}</span>
          </div>
          <div
            ref={graphHostRef}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              paddingTop: 32,
            }}
          />
          {loading && (
            <Box
              style={{
                position: "absolute", inset: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(250,250,250,0.9)", zIndex: 3,
              }}
            >
              <Text c="dimmed" size="sm">Loading DAG...</Text>
            </Box>
          )}
          {!loading && rendering && (
            <Box
              style={{
                position: "absolute", inset: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(250,250,250,0.85)", zIndex: 2,
              }}
            >
              <Text c="dimmed" size="sm">Rendering graph...</Text>
            </Box>
          )}
          {!loading && !rendering && dagData && dagData.nodes.length === 0 && (
            <Box style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Text c="dimmed" size="sm">No DAG relationships found for this term with current filters.</Text>
            </Box>
          )}
        </Box>

        <Text size="xs" c="dimmed" ta="center">
          Click nodes/edges for details. Scroll to zoom.
        </Text>
      </Stack>

      {/* Fullscreen overlay */}
      {fullscreenOpen && dagData && (
        <FullscreenOverlay
          dagData={dagData}
          onClose={handleCloseFullscreen}
        />
      )}
    </>
  );
}
