import { Box, Drawer, Group, Text, Button, Badge, Loader, Stack } from "@mantine/core";
import { useEffect, useState, useRef } from "react";
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

  // 追踪 img 的实际渲染尺寸，用于精确同步 SVG overlay
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });

  // 每次 opened 变为 true 时加载 mapdata
  useEffect(() => {
    if (!opened) return;
    const resetState = () => {
      setMapdata(null);
      setHoveredNode(null);
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    resetState();
    getKEGGPathwayMapdata(pathwayId)
      .then((data) => setMapdata(data))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load mapdata"))
      .finally(() => setLoading(false));
  }, [opened, pathwayId]);

  // 监听 img 元素渲染尺寸变化（支持浏览器缩放、容器 resize 等场景）
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    const measure = () => {
      // naturalWidth/naturalHeight 是 PNG 原始像素尺寸
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w > 0 && h > 0) {
        setImgSize({ w, h });
      }
    };

    // 图片可能已 cached（load 事件已过）
    if (img.complete && img.naturalWidth > 0) {
      measure();
    }

    img.addEventListener("load", measure);
    return () => img.removeEventListener("load", measure);
  }, [mapdata]);

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
                {highlightedCount} highlighted · {mapdata.total_nodes} nodes
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
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
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
            <ViewArea
              mapdata={mapdata}
              pngUrl={pngUrl}
              imgRef={imgRef}
              imgSize={imgSize}
              hoveredNode={hoveredNode}
              onHover={setHoveredNode}
            />
          )}
        </Box>

        {/* Footer */}
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {mapdata
              ? `${mapdata.total_nodes} nodes · ${highlightedCount} highlighted · click to open in KEGG`
              : "Click any node to open in KEGG"}
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

// ============================================================
// ViewArea — 核心渲染逻辑
//
// 布局策略（解决 SVG overlay 与底图精确对齐）：
// 1. 外层容器 = position:relative + 显式像素尺寸
// 2. img 使用 width:100%/height:100% 填充容器（图片原生尺寸）
// 3. SVG 与 img 完全重合，用相同像素尺寸
// 4. SVG viewBox = PNG 原始坐标（png_width x png_height）
// 5. 所有 rect 使用后端返回的 left/top/width/height
//
// 可点击性保证：
// - fill = rgba(0,0,0,0.008) 而非 "transparent"（非高亮节点）
// - rect 显式 pointer-events: all
// - SVG 本身 pointer-events: none（由内部 rect 接管）
// ============================================================
interface ViewAreaProps {
  mapdata: KEGGPathwayMapdata;
  pngUrl: string;
  imgRef: React.RefObject<HTMLImageElement | null>;
  imgSize: { w: number; h: number };
  hoveredNode: string | null;
  onHover: (id: string | null) => void;
}

function ViewArea({ mapdata, pngUrl, imgRef, imgSize, hoveredNode, onHover }: ViewAreaProps) {
  const { png_width: pngW, png_height: pngH, nodes } = mapdata;

  // SVG viewBox：使用 PNG 原始像素坐标
  // 所有 rect 的 x=left, y=top, width, height 都基于这个坐标系
  const viewBox = `0 0 ${pngW} ${pngH}`;

  // 容器实际像素尺寸：优先用 img 的 naturalWidth/naturalHeight（精确）
  // 次选 fallback 到 mapdata 中的 png_width/png_height
  const containerW = imgSize.w || pngW;
  const containerH = imgSize.h || pngH;

  return (
    <Box
      style={{
        position: "relative",
        display: "inline-block",
        width: containerW,
        height: containerH,
        maxWidth: "100%",
        lineHeight: 0,
      }}
    >
      {/* 底层 PNG 图片 */}
      <img
        ref={imgRef}
        src={`http://localhost:8000${pngUrl}`}
        alt={mapdata.pathway_name}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          display: "block",
        }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />

      {/* SVG Overlay — 与 img 完全重合，像素级对齐 */}
      <svg
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          overflow: "visible",
          background: "transparent",
          // SVG 本身不拦截事件，由内部 <rect> 接管
          pointerEvents: "none",
        }}
        viewBox={viewBox}
      >
        {nodes.map((node) => {
          const key = node.entry_id;
          const isHovered = hoveredNode === key;
          const isHighlighted = node.highlighted;
          const hasLink = Boolean(node.link_url);

          // 直接使用后端返回的像素坐标，不做任何转换
          const x = node.left;
          const y = node.top;
          const w = node.width;
          const h = node.height;

          // ========== 样式计算 ==========
          // 高亮节点：红色边框 + 半透明红填充 + 脉冲动画
          // 普通节点：几乎全透明填充（确保 pointer-events 生效），hover 时浅蓝描边
          const fillColor = isHighlighted
            ? "rgba(255, 80, 80, 0.22)"
            : isHovered
            ? "rgba(0, 120, 215, 0.10)"
            : "rgba(0, 0, 0, 0.008)"; // ⚠ 不用 "transparent"，否则部分浏览器不接收点击

          const strokeColor = isHighlighted
            ? "#ff4d4f"
            : isHovered
            ? "rgba(0, 120, 215, 0.65)"
            : "transparent";

          const strokeWidth = isHighlighted ? 2 : isHovered ? 1.5 : 0;

          // ========== 脉冲环（高亮节点专有，外扩热区） ==========
          const pulseRect = isHighlighted ? (
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="rgba(255, 80, 80, 0.07)"
              className="kegg-pulse-ring"
              style={{ pointerEvents: "none" }}
            />
          ) : null;

          // ========== 主热区矩形 ==========
          // 关键：
          // 1. pointer-events: all — 显式启用指针事件
          // 2. fill 绝不用 "transparent" — 用 rgba(0,0,0,0.008)
          const mainRect = (
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              rx={2}
              ry={2}
              style={{ pointerEvents: "all" }}
            />
          );

          // ========== Tooltip（hover 时显示在节点上方） ==========
          const tooltip = isHovered ? (
            <g style={{ pointerEvents: "none" }}>
              <rect
                x={x}
                y={Math.max(0, y - 16)}
                width={Math.max(60, w)}
                height={14}
                fill="rgba(30, 30, 30, 0.92)"
                rx={2}
              />
              <text
                x={x + 3}
                y={Math.max(0, y - 5)}
                fill="white"
                fontSize={9}
                fontFamily="monospace"
                style={{ userSelect: "none" }}
              >
                {(node.label || key).slice(0, 30)}
              </text>
            </g>
          ) : null;

          // ========== 事件绑定 ==========
          // 有 link_url 的节点：完整交互（hover + click）
          // 无 link_url 的节点（如复合通路节点）：只渲染，不绑定点击
          if (!hasLink) {
            return (
              <g key={key}>
                {pulseRect}
                {mainRect}
                {tooltip}
              </g>
            );
          }

          return (
            <g
              key={key}
              onMouseEnter={() => onHover(key)}
              onMouseLeave={() => onHover(null)}
              onClick={() => window.open(node.link_url!, "_blank")}
            >
              {pulseRect}
              {mainRect}
              {tooltip}
            </g>
          );
        })}
      </svg>
    </Box>
  );
}
