import { Box, Drawer, Group, Text, Button, Badge, Loader, Stack } from "@mantine/core";
import { useEffect, useState } from "react";
import { IconExternalLink, IconFocus2 } from "@tabler/icons-react";
import { getKEGGPathwayMapdata } from "../../lib/geneApi";
import type { KEGGPathwayMapdata } from "../../lib/geneApi";

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

  // 每次 opened 变为 true 时加载 mapdata
  useEffect(() => {
    if (!opened) return;
    // Batch initial state reset to avoid cascading render lint warning
    const resetState = () => {
      setMapdata(null);
      setHoveredNode(null);
    };
    setLoading(true);
    setError(null);
    resetState();
    getKEGGPathwayMapdata(pathwayId)
      .then((data) => setMapdata(data))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load mapdata"))
      .finally(() => setLoading(false));
  }, [opened, pathwayId]);

  const imgWidth = mapdata?.png_width || 0;
  const imgHeight = mapdata?.png_height || 0;
  const highlightedCount = mapdata?.nodes.filter((n) => n.highlighted).length || 0;

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
      size="xl"
      padding="md"
      overlayProps={{ backgroundOpacity: 0.3, blur: 3 }}
    >
      <Stack gap="md" style={{ height: "100%" }}>
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
                {highlightedCount} highlighted
              </Badge>
            )}
          </Group>
        </Box>

        {/* Viewer area */}
        <Box
          style={{
            flex: 1,
            overflow: "auto",
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

          {!loading && !error && (
            <Box style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
              {/* 底层 PNG 图片 */}
              <img
                src={`http://localhost:8000${pngUrl}`}
                alt={pathwayName}
                style={{ display: "block", maxWidth: "100%", height: "auto" }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />

              {/* SVG Overlay: 与图片等比例缩放 */}
              {mapdata && imgWidth > 0 && imgHeight > 0 && (
                <svg
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "auto",
                  }}
                  viewBox={`0 0 ${imgWidth} ${imgHeight}`}
                  preserveAspectRatio="xMidYMid meet"
                >
                  {mapdata.nodes.map((node) => {
                    const key = node.entry_id;
                    const isHovered = hoveredNode === key;
                    const isHighlighted = node.highlighted;

                    const fillColor = isHighlighted
                      ? "rgba(255, 80, 80, 0.22)"
                      : isHovered
                      ? "rgba(0, 120, 215, 0.10)"
                      : "transparent";

                    const strokeColor = isHighlighted
                      ? "#ff4d4f"
                      : isHovered
                      ? "rgba(0, 120, 215, 0.65)"
                      : "transparent";

                    return (
                      <g
                        key={key}
                        style={{ cursor: "pointer" }}
                        onMouseEnter={() => setHoveredNode(key)}
                        onMouseLeave={() => setHoveredNode(null)}
                        onClick={() => window.open(node.link_url || "#", "_blank")}
                      >
                        {/* 脉冲环：高亮节点 */}
                        {isHighlighted && (
                          <rect
                            x={node.left}
                            y={node.top}
                            width={node.width}
                            height={node.height}
                            fill="rgba(255, 80, 80, 0.07)"
                            className="kegg-pulse-ring"
                          />
                        )}
                        {/* 主矩形 */}
                        <rect
                          x={node.left}
                          y={node.top}
                          width={node.width}
                          height={node.height}
                          fill={fillColor}
                          stroke={strokeColor}
                          strokeWidth={isHighlighted ? 2 : isHovered ? 1.5 : 0}
                          rx={2}
                        />
                        {/* Tooltip */}
                        {isHovered && (
                          <g>
                            <rect
                              x={node.left}
                              y={Math.max(0, node.top - 16)}
                              width={Math.max(60, node.width)}
                              height={14}
                              fill="rgba(30, 30, 30, 0.88)"
                              rx={2}
                            />
                            <text
                              x={node.left + 3}
                              y={Math.max(0, node.top - 5)}
                              fill="white"
                              fontSize={9}
                              fontFamily="monospace"
                              style={{ pointerEvents: "none", userSelect: "none" }}
                            >
                              {(node.label || key).slice(0, 28)}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}
                </svg>
              )}
            </Box>
          )}
        </Box>

        {/* Footer */}
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {mapdata
              ? `${mapdata.total_nodes} nodes · ${highlightedCount} highlighted`
              : "Click nodes to open in KEGG"}
          </Text>
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
      </Stack>
    </Drawer>
  );
}
