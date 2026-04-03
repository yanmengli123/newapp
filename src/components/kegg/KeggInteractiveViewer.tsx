import { Box, Drawer, Group, Text, Button, Badge, Loader, Stack } from "@mantine/core";
import { useEffect, useState, useRef, useCallback } from "react";
import { IconExternalLink, IconFocus2, IconMaximize, IconMinimize } from "@tabler/icons-react";
import { getKEGGPathwayMapdata } from "../../lib/geneApi";
import type { KEGGPathwayMapdata } from "../../lib/geneApi";
import { API_BASE } from "../../lib/apiClient";

interface KeggInteractiveViewerProps {
  pathwayId: string;
  pathwayName: string;
  pngUrl: string;
  geneId?: string;
  opened: boolean;
  onClose: () => void;
}

export default function KeggInteractiveViewer({
  pathwayId,
  pathwayName,
  pngUrl,
  geneId,
  opened,
  onClose,
}: KeggInteractiveViewerProps) {
  const [mapdata, setMapdata] = useState<KEGGPathwayMapdata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // img ref for measuring rendered size
  const imgRef = useRef<HTMLImageElement>(null);
  // Fullscreen container ref
  const viewerWrapRef = useRef<HTMLDivElement>(null);
  const [renderedSize, setRenderedSize] = useState({ w: 0, h: 0 });

  // Measure img rendered dimensions
  const measureImg = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setRenderedSize({ w: rect.width, h: rect.height });
    }
  }, []);

  // Reset state when drawer opens — intentional synchronous reset before data fetch
  useEffect(() => {
    if (!opened) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional state reset on drawer open
    setMapdata(null);
    setHoveredNode(null);
    setIsFullscreen(false);
    setLoading(true);
    setError(null);
  }, [opened]);

  // Load mapdata after reset (triggered when mapdata becomes null and opened is true)
  useEffect(() => {
    if (!opened) return;
    if (mapdata !== null) return; // only load when reset
    getKEGGPathwayMapdata(pathwayId, geneId)
      .then((data) => setMapdata(data))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load mapdata"))
      .finally(() => setLoading(false));
  }, [opened, mapdata, pathwayId, geneId]);

  // Track img size via ResizeObserver
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    if (img.complete && img.naturalWidth > 0) {
      requestAnimationFrame(measureImg);
    }

    const observer = new ResizeObserver(() => {
      measureImg();
    });
    observer.observe(img);

    img.addEventListener("load", measureImg);
    return () => {
      observer.disconnect();
      img.removeEventListener("load", measureImg);
    };
  }, [mapdata, measureImg]);

  // CSS-based fullscreen — expand viewerWrap to fill screen
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  const highlightedCount = mapdata?.nodes.filter((n) => n.highlighted).length || 0;

  // Determine PNG dimensions: prefer image_width/image_height from mapdata, fallback to natural dimensions
  const pngW = mapdata?.image_width || mapdata?.nodes?.[0]?.width || 800;
  const pngH = mapdata?.image_height || mapdata?.nodes?.[0]?.height || 600;

  // Full image URL
  const fullPngUrl = pngUrl.startsWith("http") ? pngUrl : `${API_BASE}${pngUrl}`;

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconFocus2 size={18} color="var(--mantine-color-teal-6)" />
          <Text fw={600}>Interactive Pathway Viewer</Text>
        </Group>
      }
      position="right"
      size={isFullscreen ? "100%" : "xl"}
      padding="md"
      withCloseButton={!isFullscreen}
      overlayProps={{ backgroundOpacity: 0.3, blur: 3 }}
      styles={{
        body: { height: isFullscreen ? "100vh" : undefined, overflow: isFullscreen ? "hidden" : undefined },
        content: { transition: "all 200ms ease" },
      }}
    >
      <Stack gap="md" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <Box>
          <Text size="sm" fw={500} lineClamp={2}>{pathwayName}</Text>
          <Group gap="xs" mt={4}>
            <Badge size="xs" variant="outline">{pathwayId}</Badge>
            {geneId && (
              <Badge size="xs" color="red" variant="light">
                Gene: {geneId}
              </Badge>
            )}
            {mapdata && (
              <Badge
                size="xs"
                color={highlightedCount > 0 ? "red" : "gray"}
                variant="light"
              >
                {highlightedCount} highlighted · {mapdata.node_count ?? mapdata.nodes.length} nodes
              </Badge>
            )}
          </Group>
        </Box>

        {/* Viewer area */}
        <Box
          ref={viewerWrapRef}
          style={{
            flex: 1,
            overflow: isFullscreen ? "auto" : "auto",
            background: "#f8f9fa",
            borderRadius: 8,
            position: "relative",
          }}
        >
          {loading && (
            <Box
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(248,249,250,0.85)",
                zIndex: 10,
              }}
            >
              <Loader size="sm" />
              <Text size="xs" c="dimmed" ml="xs">
                Loading pathway nodes...
              </Text>
            </Box>
          )}

          {error && (
            <Box
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text size="sm" c="red">{error}</Text>
            </Box>
          )}

          {!loading && !error && mapdata && (
            <div
              style={{
                position: "relative",
                display: "inline-block",
                lineHeight: 0,
                width: isFullscreen ? "100%" : "100%",
                minHeight: isFullscreen ? "100%" : 300,
              }}
            >
              {/* PNG image — fills container width, height auto */}
              <img
                ref={imgRef}
                src={fullPngUrl}
                alt={pathwayName}
                style={{
                  display: "block",
                  width: "100%",
                  height: "auto",
                  maxWidth: "100%",
                }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />

              {/* SVG overlay — positioned over the img */}
              {/* SVG dimensions = img's rendered pixel dimensions */}
              <svg
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: renderedSize.w > 0 ? renderedSize.w : "100%",
                  height: renderedSize.h > 0 ? renderedSize.h : "auto",
                  overflow: "visible",
                  background: "transparent",
                  pointerEvents: "none",
                }}
                viewBox={`0 0 ${pngW} ${pngH}`}
                preserveAspectRatio="none"
              >
                {mapdata.nodes.map((node) => {
                  const key = node.node_id || node.entry_id;
                  const isHovered = hoveredNode === key;
                  const isHighlighted = node.highlighted;
                  const hasUrl = Boolean(node.url);

                  // Use backend coordinates directly
                  const x = node.left;
                  const y = node.top;
                  const w = node.width;
                  const h = node.height;

                  const fillColor = isHighlighted
                    ? "rgba(255, 80, 80, 0.25)"
                    : isHovered
                    ? "rgba(0, 120, 215, 0.12)"
                    : "rgba(0, 0, 0, 0.02)";

                  const strokeColor = isHighlighted
                    ? "#ff4d4f"
                    : isHovered
                    ? "rgba(0, 120, 215, 0.7)"
                    : "transparent";

                  const strokeWidth = isHighlighted ? 2.5 : isHovered ? 1.5 : 0;

                  const pulseRect = isHighlighted ? (
                    <rect
                      x={x} y={y} width={w} height={h}
                      fill="rgba(255, 80, 80, 0.08)"
                      className="kegg-pulse-ring"
                      style={{ pointerEvents: "none" }}
                    />
                  ) : null;

                  const tooltip = isHovered ? (
                    <g style={{ pointerEvents: "none" }}>
                      <rect
                        x={x} y={Math.max(0, y - 18)}
                        width={Math.max(80, w)} height={16}
                        fill="rgba(30, 30, 30, 0.92)" rx={2}
                      />
                      <text
                        x={x + 4} y={Math.max(0, y - 6)}
                        fill="white" fontSize={10} fontFamily="sans-serif"
                        style={{ userSelect: "none" }}
                      >
                        {(node.label || key).slice(0, 25)}
                      </text>
                    </g>
                  ) : null;

                  if (!hasUrl) {
                    return (
                      <g key={key}>
                        {pulseRect}
                        <rect
                          x={x} y={y} width={w} height={h}
                          fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth}
                          rx={2} ry={2}
                          style={{ pointerEvents: "all", cursor: "default" }}
                        />
                        {tooltip}
                      </g>
                    );
                  }

                  return (
                    <g
                      key={key}
                      onMouseEnter={() => setHoveredNode(key)}
                      onMouseLeave={() => setHoveredNode(null)}
                      onClick={() => window.open(node.url, "_blank")}
                      style={{ cursor: "pointer" }}
                    >
                      {pulseRect}
                      <rect
                        x={x} y={y} width={w} height={h}
                        fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth}
                        rx={2} ry={2}
                        style={{ pointerEvents: "all", cursor: "pointer" }}
                      />
                      {tooltip}
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </Box>

        {/* Footer */}
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {mapdata
              ? `${mapdata.nodes.length} nodes · ${highlightedCount} highlighted · click to open KEGG`
              : "Click any node to open in KEGG"}
          </Text>
          <Group gap="xs">
            <Button
              variant={isFullscreen ? "filled" : "light"}
              color={isFullscreen ? "teal" : "gray"}
              size="xs"
              leftSection={isFullscreen ? <IconMinimize size={14} /> : <IconMaximize size={14} />}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            </Button>
            <Button
              variant="light"
              size="xs"
              leftSection={<IconExternalLink size={14} />}
              component="a"
              href={`https://www.kegg.jp/kegg-bin/show_pathway?map=${pathwayId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in KEGG
            </Button>
          </Group>
        </Group>
      </Stack>
    </Drawer>
  );
}
