/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, useCallback } from "react";
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
  Modal,
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

// ─── Cytoscape Module Loader ───────────────────────────────────────────────

type CyDeps = { cytoscape: any; dagreLayout: any };
let cyLoader: Promise<CyDeps> | null = null;

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

// Module-level dagre registration guard (once across all instances)
let dagreRegistered = false;

// ─── Popup Helpers ─────────────────────────────────────────────────────────

function removeDagPopups() {
  document.querySelectorAll(".cy-popup").forEach((p) => p.remove());
}

// ─── Styles ───────────────────────────────────────────────────────────────

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
        width: 1.5, "line-color": "#666", "target-arrow-color": "#666",
        "target-arrow-shape": "triangle", "curve-style": "bezier",
        "line-style": "solid",
      } as any,
    },
    {
      selector: 'edge[relation="part_of"]',
      style: { "line-style": "dashed", "line-dash-pattern": [4, 3] } as any,
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

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "..." : s;
}

// ─── Cytoscape Init (returns cy instance, caller manages lifecycle) ─────────

function initCytoscape(
  container: HTMLDivElement,
  data: GoDagResponse,
  isFullscreen: boolean,
  onLayoutDone: () => void
): any | null {
  let resolved = false;

  const deps = loadCytoscape().then(({ cytoscape, dagreLayout }) => {
    if (!dagreRegistered) {
      cytoscape.use(dagreLayout);
      dagreRegistered = true;
    }

    const elements: any[] = [
      ...data.nodes.map((n) => ({
        data: {
          id: n.id,
          label: `${n.id}\n${truncate(n.label, 40)}`,
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

    const cy = cytoscape({
      container,
      elements,
      style: buildCyStyle(),
      layout: { name: "preset" } as any,
      wheelSensitivity: 0.3,
      minZoom: 0.15,
      maxZoom: 5,
    });

    if (resolved) { cy.destroy(); return; }

    // Register layoutstop before running layout
    cy.one("layoutstop", () => {
      onLayoutDone();
    });

    // Run dagre layout after container is visible
    const layoutOptions = {
      name: "dagre" as const,
      rankDir: "TB" as const,
      nodeSep: isFullscreen ? 55 : 40,
      rankSep: isFullscreen ? 80 : 60,
      fit: true,
      padding: isFullscreen ? 50 : 30,
      animate: true,
      animationDuration: 350,
    };

    cy.layout(layoutOptions as any).run();

    // Fallback: ensure spinner hides even if layoutstop never fires
    setTimeout(() => { if (!resolved) onLayoutDone(); }, 1800);

    return cy;
  });

  // Attach to container synchronously so caller can hold reference
  // The actual cy instance is resolved after async module load
  return { waitForDeps: deps };
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  goId: string;
}

export default function GOTermDagViewer({ goId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);

  // Per-instance state
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

  // Live Cytoscape instances (controlled independently)
  const cyRef = useRef<any>(null);
  const cyFsRef = useRef<any>(null);

  // Cancel token for data fetching only (not rendering)
  const fetchCancelledRef = useRef(false);

  // Fullscreen init guard: ensure we only init once per open
  const fsInitRef = useRef(false);

  // Load DAG metadata once
  useEffect(() => {
    getGODagMetadata()
      .then(setDagMeta)
      .catch(() => {});
  }, []);

  // Preload Cytoscape modules on mount
  useEffect(() => {
    loadCytoscape().catch(() => {});
  }, []);

  // ── Fetch lifecycle (pure — only deals with data, not rendering) ──
  const fetchDag = useCallback(
    (dir: DagDirection, d: number, isa: boolean, part: boolean) => {
      fetchCancelledRef.current = true;

      // Destroy old instances
      if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; }
      if (cyFsRef.current) { cyFsRef.current.destroy(); cyFsRef.current = null; }
      removeDagPopups();

      setLoading(true);
      setRendering(false);
      setErrorMsg(null);
      setDagData(null);
      fetchCancelledRef.current = false;

      getGOTermDag(goId, {
        direction: dir, depth: d,
        include_is_a: isa, include_part_of: part,
        max_nodes: 80,
      })
        .then((data) => {
          if (fetchCancelledRef.current) return;
          setDagData(data);
          setLoading(false);
        })
        .catch((err: Error) => {
          if (fetchCancelledRef.current) return;
          setErrorMsg(err.message ?? "Failed to load DAG");
          setLoading(false);
        });
    },
    [goId]
  );

  // Trigger fetch on mount and when params change
  useEffect(() => {
    fetchDag(direction, depth, includeIsA, includePartOf);
  }, [fetchDag, direction, depth, includeIsA, includePartOf]);

  // ── Main graph rendering (triggered by dagData + container readiness) ──
  useEffect(() => {
    if (!dagData || !containerRef.current || loading) return;
    if (dagData.nodes.length === 0) return;
    if (cyRef.current) return; // already rendered

    setRendering(true);

    loadCytoscape().then(({ cytoscape, dagreLayout }) => {
      if (fetchCancelledRef.current) return;

      if (!dagreRegistered) {
        cytoscape.use(dagreLayout);
        dagreRegistered = true;
      }

      const elements: any[] = [
        ...dagData.nodes.map((n) => ({
          data: {
            id: n.id, label: `${n.id}\n${truncate(n.label, 40)}`,
            fullLabel: n.label, namespace: n.namespace,
            isCenter: n.is_center, depth: n.depth,
            geneCountDirect: n.gene_count_direct ?? 0,
            geneCountPropagated: n.gene_count_propagated ?? 0,
          },
        })),
        ...dagData.edges.map((e) => ({
          data: {
            id: `${e.source}-${e.target}-${e.relation}`,
            source: e.source, target: e.target, relation: e.relation,
          },
        })),
      ];

      const cy = cytoscape({
        container: containerRef.current,
        elements,
        style: buildCyStyle(),
        layout: { name: "preset" } as any,
        wheelSensitivity: 0.3,
        minZoom: 0.15,
        maxZoom: 4,
      });

      cy.one("layoutstop", () => setRendering(false));
      cy.layout({
        name: "dagre", rankDir: "TB",
        nodeSep: 40, rankSep: 60,
        fit: true, padding: 30,
        animate: true, animationDuration: 350,
      } as any).run();

      cyRef.current = cy;

      // Cleanup on unmount
      return () => {
        removeDagPopups();
        if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; }
      };
    });

    // Fallback hide spinner
    const t = setTimeout(() => setRendering(false), 1800);
    return () => clearTimeout(t);
  }, [dagData, loading]);

  // ── Toolbar handlers ──
  const handleFit = () => { cyRef.current?.fit(undefined, 30); };
  const handleZoomIn = () => { cyRef.current?.zoom(cyRef.current.zoom() * 1.3); };
  const handleZoomOut = () => { cyRef.current?.zoom(cyRef.current.zoom() / 1.3); };

  // ── Fullscreen Modal ──
  const handleOpenFullscreen = () => {
    fsInitRef.current = false;
    setFullscreenOpen(true);
  };

  // useElementSize-style approach: wait for container to have non-zero size
  // then initialize Cytoscape ONCE
  const tryInitFullscreen = useCallback(() => {
    if (fsInitRef.current) return;
    if (!fullscreenContainerRef.current) return;
    if (!dagData) return;

    const el = fullscreenContainerRef.current;
    if (el.offsetWidth === 0 || el.offsetHeight === 0) return; // keep waiting

    fsInitRef.current = true;
    removeDagPopups();
    if (cyFsRef.current) { cyFsRef.current.destroy(); cyFsRef.current = null; }

    loadCytoscape().then(({ cytoscape, dagreLayout }) => {
      if (!dagreRegistered) {
        cytoscape.use(dagreLayout);
        dagreRegistered = true;
      }

      const elements: any[] = [
        ...dagData.nodes.map((n) => ({
          data: {
            id: n.id, label: `${n.id}\n${truncate(n.label, 40)}`,
            fullLabel: n.label, namespace: n.namespace,
            isCenter: n.is_center, depth: n.depth,
            geneCountDirect: n.gene_count_direct ?? 0,
            geneCountPropagated: n.gene_count_propagated ?? 0,
          },
        })),
        ...dagData.edges.map((e) => ({
          data: {
            id: `${e.source}-${e.target}-${e.relation}`,
            source: e.source, target: e.target, relation: e.relation,
          },
        })),
      ];

      const cy = cytoscape({
        container: fullscreenContainerRef.current,
        elements,
        style: buildCyStyle(),
        layout: { name: "preset" } as any,
        wheelSensitivity: 0.3,
        minZoom: 0.1,
        maxZoom: 5,
      });

      // Attach popup handlers
      cy.on("tap", (evt: any) => {
        if (evt.target === cy) { removeDagPopups(); return; }
        if (evt.target.isNode()) {
          removeDagPopups();
          const d = evt.target.data();
          const popup = document.createElement("div");
          popup.className = "cy-popup";
          popup.style.cssText = `
            position:fixed; top:${Math.min(evt.originalEvent.clientY + 10, window.innerHeight - 230)}px;
            left:${Math.min(evt.originalEvent.clientX + 10, window.innerWidth - 330)}px;
            background:#fff; border:1px solid #ddd; border-radius:6px;
            padding:8px 12px; font-size:12px; max-width:300px; z-index:99999;
            box-shadow:0 2px 8px rgba(0,0,0,0.15); font-family:monospace;
            pointer-events:none;
          `;
          const mk = (txt: string, style?: Partial<CSSStyleDeclaration>) => {
            const el = document.createElement("span");
            if (style) Object.assign(el.style, style);
            el.textContent = txt;
            return el;
          };
          popup.appendChild(mk(d.id, { fontWeight: "bold", fontSize: "11px" }));
          popup.appendChild(document.createElement("br"));
          popup.appendChild(mk(d.fullLabel, { color: "#555" }));
          popup.appendChild(document.createElement("br"));
          popup.appendChild(mk(`${NS_LABELS[d.namespace] ?? d.namespace}  depth=${d.depth}`, { color: "#888" }));
          popup.appendChild(document.createElement("br"));
          popup.appendChild(mk("Direct: "));
          const db = document.createElement("b");
          db.textContent = String(d.geneCountDirect);
          popup.appendChild(db);
          popup.appendChild(document.createElement("br"));
          popup.appendChild(mk("Propagated: "));
          const pb = document.createElement("b");
          pb.textContent = String(d.geneCountPropagated);
          popup.appendChild(pb);
          const pn = document.createElement("span");
          pn.style.color = "#aaa";
          pn.style.fontSize = "10px";
          pn.textContent = " (via full closure)";
          popup.appendChild(pn);
          document.body.appendChild(popup);
          return;
        }
        if (evt.target.isEdge()) {
          removeDagPopups();
          const d = evt.target.data();
          const popup = document.createElement("div");
          popup.className = "cy-popup";
          popup.style.cssText = `
            position:fixed; top:${Math.min(evt.originalEvent.clientY + 10, window.innerHeight - 80)}px;
            left:${Math.min(evt.originalEvent.clientX + 10, window.innerWidth - 240)}px;
            background:#fff; border:1px solid #ddd; border-radius:6px;
            padding:6px 10px; font-size:12px; z-index:99999;
            box-shadow:0 2px 8px rgba(0,0,0,0.15); font-family:monospace;
            pointer-events:none;
          `;
          const b = document.createElement("b");
          b.textContent = d.relation === "is_a" ? "is_a (inheritance)" : "part_of (partonomy)";
          popup.appendChild(b);
          popup.appendChild(document.createTextNode(" relationship"));
          document.body.appendChild(popup);
        }
      });

      // Run dagre layout
      cy.layout({
        name: "dagre", rankDir: "TB",
        nodeSep: 55, rankSep: 80,
        fit: true, padding: 50,
        animate: true, animationDuration: 400,
      } as any).run();

      cyFsRef.current = cy;

      // Resize + fit after layout settles
      setTimeout(() => {
        if (cyFsRef.current) {
          cyFsRef.current.resize();
          cyFsRef.current.fit(undefined, 50);
        }
      }, 500);
    });
  }, [dagData]);

  // Poll fullscreen container size until ready
  useEffect(() => {
    if (!fullscreenOpen) return;

    // Reset init guard when modal closes
    fsInitRef.current = false;

    // Check size immediately
    tryInitFullscreen();

    // Poll every 100ms for up to 3 seconds
    const interval = setInterval(() => {
      if (!fullscreenOpen) { clearInterval(interval); return; }
      tryInitFullscreen();
    }, 100);

    const timeout = setTimeout(() => clearInterval(interval), 3000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [fullscreenOpen, dagData, tryInitFullscreen]);

  const handleCloseFullscreen = () => {
    if (cyFsRef.current) { cyFsRef.current.destroy(); cyFsRef.current = null; }
    removeDagPopups();
    setFullscreenOpen(false);
  };

  const version = dagMeta?.data_version ?? "--";
  const loadedAt = dagMeta?.loaded_at
    ? new Date(dagMeta.loaded_at).toLocaleDateString()
    : "--";

  return (
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
            <ActionIcon variant="light" size="sm" onClick={handleZoomIn}><IconZoomIn size={14} /></ActionIcon>
          </Tooltip>
          <Tooltip label="Zoom out">
            <ActionIcon variant="light" size="sm" onClick={handleZoomOut}><IconZoomOut size={14} /></ActionIcon>
          </Tooltip>
          <Tooltip label="Fit to view">
            <ActionIcon variant="light" size="sm" onClick={handleFit}><IconFocusCentered size={14} /></ActionIcon>
          </Tooltip>
          <Tooltip label="Fullscreen">
            <ActionIcon variant="light" size="sm" onClick={handleOpenFullscreen}><IconMaximize size={14} /></ActionIcon>
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
        }}
      >
        {(loading || rendering) && (
          <Box
            style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(250,250,250,0.9)", zIndex: 3,
            }}
          >
            <Text c="dimmed" size="sm">
              {loading ? "Loading DAG..." : "Rendering graph..."}
            </Text>
          </Box>
        )}
        {!loading && !rendering && !errorMsg && dagData && dagData.nodes.length === 0 && (
          <Box style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Text c="dimmed" size="sm">No DAG relationships found for this term with current filters.</Text>
          </Box>
        )}
      </Box>

      <Text size="xs" c="dimmed" ta="center">
        Click nodes/edges for details. Scroll to zoom.
      </Text>

      {/* Fullscreen Modal */}
      <Modal
        opened={fullscreenOpen}
        onClose={handleCloseFullscreen}
        title={
          <Group gap="xs">
            <Text fw={700}>DAG View</Text>
            <Badge size="xs" variant="light" color="gray">{dagData?.center}</Badge>
          </Group>
        }
        size="100%"
        styles={{
          content: { display: "flex", flexDirection: "column" },
          body: { flex: 1, display: "flex", flexDirection: "column", padding: 0 },
          header: { padding: "12px 16px" },
        }}
      >
        {/* Fullscreen container with popup-safe wrapper */}
        <Box
          ref={fullscreenContainerRef}
          style={{
            flex: 1,
            minHeight: 0,
            background: "#fafafa",
            position: "relative",
          }}
        />

        {/* Floating controls — inside the same position:relative container */}
        <Box
          style={{
            position: "absolute",
            bottom: 24,
            right: 24,
            zIndex: 10,
          }}
        >
          <Box
            style={{
              background: "#fff",
              borderRadius: 8,
              padding: "8px 10px",
              boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
            }}
          >
            <Group gap={6}>
              <Tooltip label="Zoom in">
                <ActionIcon variant="light" size="md" onClick={() => cyFsRef.current?.zoom(cyFsRef.current.zoom() * 1.3)}>
                  <IconZoomIn size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Zoom out">
                <ActionIcon variant="light" size="md" onClick={() => cyFsRef.current?.zoom(cyFsRef.current.zoom() / 1.3)}>
                  <IconZoomOut size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Fit">
                <ActionIcon variant="light" size="md" onClick={() => {
                  if (cyFsRef.current) {
                    cyFsRef.current.resize();
                    cyFsRef.current.fit(undefined, 50);
                  }
                }}>
                  <IconFocusCentered size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Box>
        </Box>
      </Modal>
    </Stack>
  );
}