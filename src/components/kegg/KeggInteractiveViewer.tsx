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

  // 追踪 img 渲染到容器后的实际像素尺寸
  const imgRef = useRef<HTMLImageElement>(null);
  const [renderedSize, setRenderedSize] = useState({ w: 0, h: 0 });

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

  // 监听 img 渲染到容器后的实际像素尺寸
  // 关键：用 getBoundingClientRect() 测量 img 的实际渲染尺寸，而非 wrapper 的 CSS 尺寸
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    const measure = () => {
      const rect = img.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setRenderedSize({ w: rect.width, h: rect.height });
      }
    };

    if (img.complete && img.naturalWidth > 0) {
      // 图片已缓存：等一个 rAF 让布局稳定后再测量
      requestAnimationFrame(measure);
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

        {/* Viewer area — 限制最大宽度，图片在内部自适应 */}
        <Box
          style={{
            flex: 1,
            overflow: "auto",
            background: "#f8f9fa",
            borderRadius: 8,
            // 限制最大宽度，图片不会超出容器
            maxWidth: "100%",
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
              renderedSize={renderedSize}
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
// ViewArea — 核心渲染：严格像素对齐的 PNG + SVG overlay
//
// 对齐策略（彻底解决 SVG/PNG 缩放不一致问题）：
// 1. wrapper 不设置固定 width/height，完全由内容（img）撑开
// 2. img 使用 width:100% + height:auto，自适应容器宽度（保持比例）
// 3. SVG overlay 用 position:absolute + inset:0 填满 img 实际渲染区域
//    → SVG 的 width/height = img 的实际渲染像素尺寸（实测）
// 4. SVG viewBox = PNG 原始像素尺寸（png_width x png_height）
//    → SVG 内部坐标系 = PNG 原始像素坐标
//    → 所有 rect 的 x=left, y=top, width, height 直接用后端返回值
// 5. img 和 SVG 的渲染区域完全相同 → 缩放比例完全一致 → 坐标精确对齐
// ============================================================
interface ViewAreaProps {
  mapdata: KEGGPathwayMapdata;
  pngUrl: string;
  imgRef: React.RefObject<HTMLImageElement | null>;
  renderedSize: { w: number; h: number };
  hoveredNode: string | null;
  onHover: (id: string | null) => void;
}

function ViewArea({ mapdata, pngUrl, imgRef, renderedSize, hoveredNode, onHover }: ViewAreaProps) {
  const { png_width: pngW, png_height: pngH, nodes } = mapdata;

  return (
    <div
      style={{
        position: "relative",
        // 不设固定 width/height，完全由 img 内容撑开
        // img width:100% + height:auto → 自适应容器宽度，保持原图比例
        display: "inline-block",
        lineHeight: 0,
      }}
    >
      {/* 底层 PNG 图片：width:100% 自适应，height:auto 保持比例 */}
      {/* 这里不用 width/height:100%，因为外层没有固定尺寸 */}
      <img
        ref={imgRef}
        src={`http://localhost:8000${pngUrl}`}
        alt={mapdata.pathway_name}
        style={{
          display: "block",
          width: "100%",        // 填满容器宽度
          height: "auto",       // 保持原图宽高比
          // maxWidth 防止超出容器（重要！）
          maxWidth: "100%",
        }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />

      {/* SVG Overlay：position:absolute + inset:0 精确覆盖 img 的实际渲染区域 */}
      {/* 宽高由 img 的实际渲染尺寸决定（实测 renderedSize），与 viewBox 坐标系对应 */}
      <svg
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          // SVG 宽高 = img 实际渲染像素尺寸
          width: renderedSize.w > 0 ? renderedSize.w : "100%",
          height: renderedSize.h > 0 ? renderedSize.h : "auto",
          overflow: "visible",
          background: "transparent",
          // SVG 本身不拦截事件，由内部 <rect> 接管
          pointerEvents: "none",
        }}
        viewBox={`0 0 ${pngW} ${pngH}`}
        preserveAspectRatio="none"
      >
        {/* 渲染所有节点（highlighted 只决定样式，不决定是否渲染） */}
        {nodes.map((node) => {
          const key = node.entry_id;
          const isHovered = hoveredNode === key;
          const isHighlighted = node.highlighted;
          const hasLink = Boolean(node.link_url);

          // ========== 直接使用后端返回的坐标，不做任何二次计算 ==========
          // 后端返回的 left/top 已经是绝对像素坐标（基于 PNG 原始尺寸）
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
            : "rgba(0, 0, 0, 0.01)"; // ⚠ 绝不用 "transparent"，否则部分浏览器不触发 pointer events

          const strokeColor = isHighlighted
            ? "#ff4d4f"
            : isHovered
            ? "rgba(0, 120, 215, 0.65)"
            : "transparent";

          const strokeWidth = isHighlighted ? 2 : isHovered ? 1.5 : 0;

          // ========== 脉冲环（高亮节点专有，外扩热区视觉效果） ==========
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

          // ========== 事件绑定：所有节点都可点击 ==========
          // 有 link_url：完整交互（hover + click）
          // 无 link_url（如复合通路节点）：只渲染不可点击
          if (!hasLink) {
            return (
              <g key={key}>
                {pulseRect}
                <rect
                  x={x} y={y} width={w} height={h}
                  fill={fillColor}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
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
              onMouseEnter={() => onHover(key)}
              onMouseLeave={() => onHover(null)}
              onClick={() => window.open(node.link_url!, "_blank")}
            >
              {pulseRect}
              <rect
                x={x} y={y} width={w} height={h}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                rx={2} ry={2}
                style={{ pointerEvents: "all", cursor: "pointer" }}
              />
              {tooltip}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
