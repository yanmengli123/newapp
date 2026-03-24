import { Box, Drawer, Group, Text, Button, Badge, Loader, Stack } from "@mantine/core";
import { useEffect, useState, useRef, useCallback } from "react";
import { IconExternalLink, IconFocus2, IconMaximize, IconMinimize } from "@tabler/icons-react";
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
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 追踪 img 渲染到容器后的实际像素尺寸
  const imgRef = useRef<HTMLImageElement>(null);
  // 全屏容器 ref（用于 requestFullscreen）
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderedSize, setRenderedSize] = useState({ w: 0, h: 0 });

  // 测量 img 实际渲染尺寸
  const measureImg = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setRenderedSize({ w: rect.width, h: rect.height });
    }
  }, []);

  // 每次 opened 变为 true 时加载 mapdata
  useEffect(() => {
    if (!opened) return;
    const resetState = () => {
      setMapdata(null);
      setHoveredNode(null);
      setIsFullscreen(false);
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    resetState();
    getKEGGPathwayMapdata(pathwayId, geneId)
      .then((data) => setMapdata(data))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load mapdata"))
      .finally(() => setLoading(false));
  }, [opened, pathwayId, geneId]);

  // 监听 img 尺寸变化（覆盖：初次加载、缓存、窗口 resize、全屏进入/退出）
  // ResizeObserver 监听 img 元素本身的尺寸变化，比 fullscreenchange 事件更可靠
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    // 图片已缓存时立即测量
    if (img.complete && img.naturalWidth > 0) {
      requestAnimationFrame(measureImg);
    }

    const observer = new ResizeObserver(() => {
      measureImg();
    });
    observer.observe(img);

    // 图片 load 时重新测量（全屏进入后 naturalWidth 不变但 getBoundingClientRect 变了）
    img.addEventListener("load", measureImg);
    return () => {
      observer.disconnect();
      img.removeEventListener("load", measureImg);
    };
  }, [mapdata, measureImg]);

  // 全屏切换
  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;

    if (!document.fullscreenElement) {
      try {
        await el.requestFullscreen();
        setIsFullscreen(true);
      } catch {
        // fallback: 尝试全屏 CSS
        el.style.maxWidth = "100vw";
        el.style.maxHeight = "100vh";
        setIsFullscreen(true);
      }
    } else {
      try {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } catch {
        el.style.maxWidth = "";
        el.style.maxHeight = "";
        setIsFullscreen(false);
      }
    }
  }, []);

  // ESC 退出全屏时同步状态
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

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
            maxWidth: "100%",
            // 全屏时覆盖整个屏幕
            ...(isFullscreen ? { maxWidth: "100vw", maxHeight: "100vh" } : {}),
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
              containerRef={containerRef}
              renderedSize={renderedSize}
              hoveredNode={hoveredNode}
              onHover={setHoveredNode}
              isFullscreen={isFullscreen}
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
          <Group gap="xs">
            {/* 全屏按钮 */}
            <Button
              variant={isFullscreen ? "filled" : "light"}
              color={isFullscreen ? "teal" : "gray"}
              size="xs"
              leftSection={isFullscreen ? <IconMinimize size={14} /> : <IconMaximize size={14} />}
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
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

// ============================================================
// ViewArea — 核心渲染：严格像素对齐的 PNG + SVG overlay
//
// 对齐策略（全屏安全的根本保证）：
// 1. wrapper 不设固定 width/height，完全由 img 内容撑开
// 2. img: width:100%; height:auto; maxWidth:100% — 自适应容器，保持比例
// 3. SVG overlay: position:absolute; inset:0 覆盖 img 实际渲染区域
//    → SVG width/height = img 实测渲染尺寸（renderedSize）
//    → ResizeObserver 监听 img 尺寸 → 全屏/退出/缩放时自动更新 renderedSize
// 4. SVG viewBox = pngW x pngH（原始像素坐标），preserveAspectRatio=none
//    → 所有 rect 的 x=left, y=top, width, height 直接用后端返回值
// 5. img 和 SVG 渲染区域完全相同 → 缩放比例一致 → 坐标精确对齐
//    → 全屏进入后 ResizeObserver 触发 → renderedSize 更新 → SVG 自动重新渲染
//      新尺寸与 img 完全一致 → 全屏下坐标仍然精确对齐
// ============================================================
interface ViewAreaProps {
  mapdata: KEGGPathwayMapdata;
  pngUrl: string;
  imgRef: React.RefObject<HTMLImageElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  renderedSize: { w: number; h: number };
  hoveredNode: string | null;
  onHover: (id: string | null) => void;
  isFullscreen: boolean;
}

function ViewArea({
  mapdata,
  pngUrl,
  imgRef,
  containerRef,
  renderedSize,
  hoveredNode,
  onHover,
  isFullscreen,
}: ViewAreaProps) {
  const { png_width: pngW, png_height: pngH, nodes } = mapdata;

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        display: "inline-block",
        lineHeight: 0,
        // 全屏时覆盖整个屏幕
        ...(isFullscreen
          ? {
              width: "100vw",
              height: "100vh",
              maxWidth: "100vw",
              maxHeight: "100vh",
            }
          : {}),
      }}
    >
      {/* 底层 PNG 图片 */}
      <img
        ref={imgRef}
        src={`http://localhost:8000${pngUrl}`}
        alt={mapdata.pathway_name}
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          maxWidth: "100%",
          // 全屏时填满整个容器
          ...(isFullscreen ? { width: "100%", height: "100%", maxWidth: "100%" } : {}),
        }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />

      {/* SVG Overlay：position:absolute 精确覆盖 img 实际渲染区域 */}
      <svg
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          // SVG 宽高 = img 实际渲染像素尺寸（全屏时由 ResizeObserver 自动更新）
          width: renderedSize.w > 0 ? renderedSize.w : "100%",
          height: renderedSize.h > 0 ? renderedSize.h : "auto",
          overflow: "visible",
          background: "transparent",
          pointerEvents: "none",
        }}
        viewBox={`0 0 ${pngW} ${pngH}`}
        preserveAspectRatio="none"
      >
        {nodes.map((node) => {
          const key = node.entry_id;
          const isHovered = hoveredNode === key;
          const isHighlighted = node.highlighted;
          const hasLink = Boolean(node.link_url);

          // 直接使用后端返回的坐标，不做任何二次计算
          const x = node.left;
          const y = node.top;
          const w = node.width;
          const h = node.height;

          const fillColor = isHighlighted
            ? "rgba(255, 80, 80, 0.22)"
            : isHovered
            ? "rgba(0, 120, 215, 0.10)"
            : "rgba(0, 0, 0, 0.01)"; // ⚠ 不用 "transparent"

          const strokeColor = isHighlighted
            ? "#ff4d4f"
            : isHovered
            ? "rgba(0, 120, 215, 0.65)"
            : "transparent";

          const strokeWidth = isHighlighted ? 2 : isHovered ? 1.5 : 0;

          const pulseRect = isHighlighted ? (
            <rect
              x={x} y={y} width={w} height={h}
              fill="rgba(255, 80, 80, 0.07)"
              className="kegg-pulse-ring"
              style={{ pointerEvents: "none" }}
            />
          ) : null;

          const tooltip = isHovered ? (
            <g style={{ pointerEvents: "none" }}>
              <rect
                x={x} y={Math.max(0, y - 16)}
                width={Math.max(60, w)} height={14}
                fill="rgba(30, 30, 30, 0.92)" rx={2}
              />
              <text
                x={x + 3} y={Math.max(0, y - 5)}
                fill="white" fontSize={9} fontFamily="monospace"
                style={{ userSelect: "none" }}
              >
                {(node.label || key).slice(0, 30)}
              </text>
            </g>
          ) : null;

          if (!hasLink) {
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
              onMouseEnter={() => onHover(key)}
              onMouseLeave={() => onHover(null)}
              onClick={() => window.open(node.link_url!, "_blank")}
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
  );
}
