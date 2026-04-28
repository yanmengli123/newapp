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
} from "@mantine/core";
import {
  IconZoomIn,
  IconZoomOut,
  IconFocusCentered,
  IconAlertTriangle,
  IconArrowUp,
  IconArrowDown,
  IconArrowsExchange,
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

// Module-level guard: register dagre layout only once
let dagreRegistered = false;

interface Props {
  goId: string;
}

export default function GOTermDagViewer({ goId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<any>(null);
  const [direction, setDirection] = useState<DagDirection>("ancestors");
  const [depth, setDepth] = useState<number>(3);
  const [includeIsA, setIncludeIsA] = useState(true);
  const [includePartOf, setIncludePartOf] = useState(true);
  const [dagData, setDagData] = useState<GoDagResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dagMeta, setDagMeta] = useState<GoDagMetadata | null>(null);

  // Load DAG metadata once
  useEffect(() => {
    getGODagMetadata()
      .then(setDagMeta)
      .catch(() => {});
  }, []);

  // Fetch DAG data
  const fetchDag = useCallback(
    (dir: DagDirection, d: number, isa: boolean, part: boolean) => {
      setLoading(true);
      setErrorMsg(null);
      setDagData(null);
      // Destroy existing Cytoscape instance before fetching new data
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
      getGOTermDag(goId, {
        direction: dir,
        depth: d,
        include_is_a: isa,
        include_part_of: part,
        max_nodes: 80,
      })
        .then((data) => {
          setDagData(data);
        })
        .catch((err: Error) => {
          setErrorMsg(err.message ?? "Failed to load DAG");
        })
        .finally(() => setLoading(false));
    },
    [goId]
  );

  // Initial + param-change fetch
  useEffect(() => {
    fetchDag(direction, depth, includeIsA, includePartOf);
    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [fetchDag, direction, depth, includeIsA, includePartOf]);

  // Build and render Cytoscape graph
  useEffect(() => {
    if (!dagData || !containerRef.current) return;
    if (dagData.nodes.length === 0) return;

    let cleanupPopup: (() => void) | null = null;

    const initCy = async () => {
      const cytoscape = (await import("cytoscape")).default;
      const dagreLayout = (await import("cytoscape-dagre")).default;

      if (!dagreRegistered) {
        (cytoscape as any).use(dagreLayout);
        dagreRegistered = true;
      }

      const elements: any[] = [
        ...dagData.nodes.map((n) => ({
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
        ...dagData.edges.map((e) => ({
          data: {
            id: `${e.source}-${e.target}-${e.relation}`,
            source: e.source,
            target: e.target,
            relation: e.relation,
          },
        })),
      ];

      if (cyRef.current) {
        cyRef.current.destroy();
      }

      const cy = cytoscape({
        container: containerRef.current!,
        elements,
        style: buildCyStyle(),
        layout: {
          name: "dagre",
          rankDir: "BT",
          nodeSep: 40,
          rankSep: 60,
        } as any,
        wheelSensitivity: 0.3,
        minZoom: 0.3,
        maxZoom: 3,
      });

      // Cleanup old popup helper
      const removePopup = () => {
        const old = document.querySelector(".cy-popup");
        if (old) old.remove();
      };
      cleanupPopup = removePopup;

      // Tap background → close popup
      cy.on("tap", (evt: any) => {
        if (evt.target === cy) removePopup();
      });

      // Node tap → show popup
      cy.on("tap", "node", (evt: any) => {
        removePopup();
        const node = evt.target;
        const d = node.data();
        const popup = document.createElement("div");
        popup.className = "cy-popup";
        popup.style.cssText = `
          position:fixed; top:${Math.min(evt.originalEvent.clientY + 10, window.innerHeight - 200)}px;
          left:${Math.min(evt.originalEvent.clientX + 10, window.innerWidth - 300)}px;
          background:#fff; border:1px solid #ddd; border-radius:6px;
          padding:8px 12px; font-size:12px; max-width:280px; z-index:9999;
          box-shadow:0 2px 8px rgba(0,0,0,0.15); font-family:monospace;
          pointer-events:none;
        `;
        popup.innerHTML = `
          <b style="font-size:11px">${d.id}</b><br/>
          <span style="color:#555">${d.fullLabel}</span><br/>
          <span style="color:#888">${NS_LABELS[d.namespace] ?? d.namespace}</span>
          &nbsp;depth=${d.depth}<br/>
          Direct genes: <b>${d.geneCountDirect}</b><br/>
          Propagated (all): <b>${d.geneCountPropagated}</b>
          <span style="color:#aaa;font-size:10px">(via full closure)</span>
        `;
        document.body.appendChild(popup);
      });

      // Edge tap → show popup
      cy.on("tap", "edge", (evt: any) => {
        removePopup();
        const edge = evt.target;
        const d = edge.data();
        const popup = document.createElement("div");
        popup.className = "cy-popup";
        popup.style.cssText = `
          position:fixed; top:${Math.min(evt.originalEvent.clientY + 10, window.innerHeight - 80)}px;
          left:${Math.min(evt.originalEvent.clientX + 10, window.innerWidth - 220)}px;
          background:#fff; border:1px solid #ddd; border-radius:6px;
          padding:6px 10px; font-size:12px; z-index:9999;
          box-shadow:0 2px 8px rgba(0,0,0,0.15); font-family:monospace;
          pointer-events:none;
        `;
        const relLabel = d.relation === "is_a" ? "is_a (inheritance)" : "part_of (partonomy)";
        popup.innerHTML = `<b>${relLabel}</b> relationship`;
        document.body.appendChild(popup);
      });

      // Fit after render
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          cy.resize();
          cy.fit(undefined, 30);
        });
      });

      cyRef.current = cy;
    };

    initCy();

    return () => {
      if (cleanupPopup) cleanupPopup();
      const p = document.querySelector(".cy-popup");
      if (p) p.remove();
    };
  }, [dagData]);

  const handleFit = () => cyRef.current?.fit(undefined, 30);
  const handleZoomIn = () => {
    const cy = cyRef.current;
    if (cy) cy.zoom(cy.zoom() * 1.3);
  };
  const handleZoomOut = () => {
    const cy = cyRef.current;
    if (cy) cy.zoom(cy.zoom() / 1.3);
  };

  const version = dagMeta?.data_version ?? "—";
  const loadedAt = dagMeta?.loaded_at
    ? new Date(dagMeta.loaded_at).toLocaleDateString()
    : "—";

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
            {
              value: "ancestors",
              label: (
                <Group gap={4}><IconArrowUp size={12} /><Text size="xs">Ancestors</Text></Group>
              ),
            },
            {
              value: "descendants",
              label: (
                <Group gap={4}><IconArrowDown size={12} /><Text size="xs">Descendants</Text></Group>
              ),
            },
            {
              value: "both",
              label: (
                <Group gap={4}><IconArrowsExchange size={12} /><Text size="xs">Both</Text></Group>
              ),
            },
          ]}
          value={direction}
          onChange={(v) => v && setDirection(v as DagDirection)}
        />
        <NumberInput
          label="Depth"
          size="xs"
          value={depth}
          onChange={(v) => setDepth(Number(v) || 3)}
          min={1}
          max={6}
          step={1}
          style={{ width: 65 }}
        />
        <Group gap={4} align="center" mt={4}>
          <Switch
            size="xs"
            label="is_a"
            checked={includeIsA}
            onChange={(e) => setIncludeIsA(e.currentTarget.checked)}
          />
          <Switch
            size="xs"
            label="part_of"
            checked={includePartOf}
            onChange={(e) => setIncludePartOf(e.currentTarget.checked)}
          />
        </Group>
        <Group gap={2} align="flex-end" mt={4}>
          <Tooltip label="Zoom in">
            <ActionIcon variant="light" size="sm" onClick={handleZoomIn}>
              <IconZoomIn size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Zoom out">
            <ActionIcon variant="light" size="sm" onClick={handleZoomOut}>
              <IconZoomOut size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Fit to view">
            <ActionIcon variant="light" size="sm" onClick={handleFit}>
              <IconFocusCentered size={14} />
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
        <Alert color="red" variant="light" py={4}>
          {errorMsg}
        </Alert>
      )}

      {/* Legend */}
      <Group gap="lg">
        {Object.entries(NS_LABELS).map(([ns, label]) => (
          <Group key={ns} gap={4}>
            <Box w={12} h={12} style={{ borderRadius: 3, background: NS_COLORS[ns] }} />
            <Text size="xs">{label}</Text>
          </Group>
        ))}
        <Group gap={4}>
          <Box w={20} h={2} style={{ background: "#666" }} />
          <Text size="xs">is_a</Text>
        </Group>
        <Group gap={4}>
          <Box w={20} h={2} style={{ borderTop: "2px dashed #666" }} />
          <Text size="xs">part_of</Text>
        </Group>
      </Group>

      {/* Cytoscape container */}
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
        {loading && (
          <Box
            style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(250,250,250,0.85)", zIndex: 2,
            }}
          >
            <Text c="dimmed" size="sm">Loading DAG...</Text>
          </Box>
        )}
        {!loading && !errorMsg && dagData && dagData.nodes.length === 0 && (
          <Box
            style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <Text c="dimmed" size="sm">
              No DAG relationships found for this term with current filters.
            </Text>
          </Box>
        )}
      </Box>

      <Text size="xs" c="dimmed" ta="center">
        Click nodes/edges for details. Scroll to zoom.
      </Text>
    </Stack>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
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
      style: {
        "border-width": 3,
        "border-color": "#222",
        "background-color": "#fff3cd",
      },
    },
    {
      selector: 'node[namespace="biological_process"]',
      style: {
        "background-color": "#d0e8ff",
        "border-color": "#228BE6",
      },
    },
    {
      selector: 'node[namespace="cellular_component"]',
      style: {
        "background-color": "#ffd0d0",
        "border-color": "#FA5252",
      },
    },
    {
      selector: 'node[namespace="molecular_function"]',
      style: {
        "background-color": "#d0ffd0",
        "border-color": "#40C057",
      },
    },
    {
      selector: "node[isCenter][namespace=\"biological_process\"]",
      style: { "background-color": "#c8e6ff", "border-color": "#1e70bf" },
    },
    {
      selector: "node[isCenter][namespace=\"cellular_component\"]",
      style: { "background-color": "#ffbfbf", "border-color": "#c0392b" },
    },
    {
      selector: "node[isCenter][namespace=\"molecular_function\"]",
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
        "line-style": "solid",
      } as any,
    },
    {
      selector: 'edge[relation="part_of"]',
      style: {
        "line-style": "dashed",
        "line-dash-pattern": [4, 3],
      } as any,
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
