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

const NS_COLORS: Record<string, string> = {
  biological_process: "#228BE6",
  cellular_component: "#FA5252",
  molecular_function: "#40C057",
};

const NS_LABELS: Record<string, string> = {
  biological_process: "BP",
  cellular_component: "CC",
  molecular_function: "MF",
};

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

function buildCyElements(data: GoDagResponse): any[] {
  return [
    ...data.nodes.map((n) => ({
      data: {
        id: n.id,
        label: `${n.id}\n${n.label.length > 40 ? n.label.slice(0, 39) + "..." : n.label}`,
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

function buildCyStyle(): any[] {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "text-valign": "top",
        "text-halign": "center",
        "text-margin-y": 4,
        "font-size": "9px",
        "font-family": "monospace",
        color: "#333",
        "background-color": "#e8e8e8",
        "border-width": 1.5,
        "border-color": "#aaa",
        width: 120,
        height: 50,
      } as any,
    },
    {
      selector: "node[isCenter]",
      style: { "border-width": 3, "border-color": "#222", "background-color": "#fff3cd" },
    },
    {
      selector: 'node[namespace="biological_process"]',
      style: { "background-color": "#d0e8ff", "border-color": "#228BE6" },
    },
    {
      selector: 'node[namespace="cellular_component"]',
      style: { "background-color": "#ffd0d0", "border-color": "#FA5252" },
    },
    {
      selector: 'node[namespace="molecular_function"]',
      style: { "background-color": "#d0ffd0", "border-color": "#40C057" },
    },
    {
      selector: 'node[isCenter][namespace="biological_process"]',
      style: { "background-color": "#c8e6ff", "border-color": "#1e70bf" },
    },
    {
      selector: 'node[isCenter][namespace="cellular_component"]',
      style: { "background-color": "#ffbfbf", "border-color": "#c0392b" },
    },
    {
      selector: 'node[isCenter][namespace="molecular_function"]',
      style: { "background-color": "#bfffe0", "border-color": "#2b9e50" },
    },
    {
      selector: "edge",
      style: {
        width: 1.5,
        "line-color": "#666",
        "target-arrow-color": "#666",
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
      } as any,
    },
    {
      selector: 'edge[relation="part_of"]',
      style: { "line-style": "dashed", "line-dash-pattern": [6, 3] } as any,
    },
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

// ─── Mount Cytoscape into a container ──────────────────────────────────────
// Returns a destroy() function.

function mountCytoscape(opts: {
  container: HTMLDivElement;
  data: GoDagResponse;
  isFullscreen: boolean;
  onLayoutDone?: () => void;
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
      showNodePopup(evt.target, evt.originalEvent.clientX, evt.originalEvent.clientY);
    });

    cy.on("tap", "edge", (evt: any) => {
      showEdgePopup(evt.target, evt.originalEvent.clientX, evt.originalEvent.clientY);
    });

    cy.on("tap", (evt: any) => {
      if (evt.target === cy) removeDagPopups();
    });

    if (opts.isFullscreen) {
      // Fullscreen: stable init — no animation, explicit resize+fit
      cy.ready(() => {
        if (disposed) return;
        cy.resize();
        cy.layout({
          name: "dagre",
          rankDir: "TB",
          nodeSep: 55,
          rankSep: 80,
          fit: true,
          padding: 50,
          animate: false,
        } as any).run();
        requestAnimationFrame(() => {
          if (!disposed) { cy.resize(); cy.fit(undefined, 50); }
          if (!disposed && opts.onLayoutDone) opts.onLayoutDone();
        });
      });
    } else {
      cy.one("layoutstop", () => {
        if (!disposed) { cy.resize(); cy.fit(undefined, 30); }
        if (!disposed && opts.onLayoutDone) opts.onLayoutDone();
      });
      cy.layout({
        name: "dagre",
        rankDir: "TB",
        nodeSep: 40,
        rankSep: 60,
        fit: true,
        padding: 30,
        animate: true,
        animationDuration: 400,
      } as any).run();

      setTimeout(() => {
        if (!disposed) { cy.resize(); cy.fit(undefined, 30); }
        if (!disposed && opts.onLayoutDone) opts.onLayoutDone();
      }, 2000);
    }
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
// Rendered via createPortal into document.body — completely outside
// the GOTermDagViewer component tree, so closing the parent Drawer
// never races with Cytoscape's unmount.

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
        background: "rgba(0,0,0,0.7)",
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
        }}
      />

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

        const destroy = mountCytoscape({
          container,
          data: dagData!,
          isFullscreen: false,
          onLayoutDone: () => setRendering(false),
        });
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
    const destroy = mountCytoscape({
      container: el,
      data: dagData,
      isFullscreen: false,
      onLayoutDone: () => setRendering(false),
    });
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

        {/* Legend */}
        <Group gap="lg">
          {Object.entries(NS_LABELS).map(([ns, label]) => (
            <Group key={ns} gap={4}>
              <Box w={12} h={12} style={{ borderRadius: 3, background: NS_COLORS[ns] }} />
              <Text size="xs">{label}</Text>
            </Group>
          ))}
          <Group gap={4}><Box w={20} h={2} style={{ background: "#666" }} /><Text size="xs">is_a</Text></Group>
          <Group gap={4}><Box w={20} h={2} style={{ borderTop: "2px dashed #666" }} /><Text size="xs">part_of</Text></Group>
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
          <div
            ref={graphHostRef}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
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

      {/* Fullscreen overlay — rendered via portal into document.body, completely outside component tree */}
      {fullscreenOpen && dagData && (
        <FullscreenOverlay
          dagData={dagData}
          onClose={handleCloseFullscreen}
        />
      )}
    </>
  );
}
