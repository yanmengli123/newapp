/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ActionIcon,
  Box,
  Divider,
  Group,
  Menu,
  Paper,
  Portal,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useRef, useState, useCallback } from "react";
import {
  IconMaximize,
  IconMinimize,
  IconDownload,
  IconFileTypeCsv,
  IconPhoto,
  IconVectorSpline,
} from "@tabler/icons-react";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";

const Plot = createPlotlyComponent(PlotlyModule);

interface InteractiveChartProps {
  /** Human-readable chart title */
  title: string;
  /** Dataset code for filename */
  datasetCode: string;
  /** Plotly traces */
  traces: any[];
  /** Plotly layout */
  layout: any;
  /** Plotly config */
  config: any;
  /** Called with filename when user requests CSV export */
  onExportCsv?: (filename: string) => void;
  /** Normal height in px */
  normalHeight?: number;
  /** Fullscreen height in px */
  fullscreenHeight?: number;
}

export default function InteractiveChart({
  title,
  datasetCode,
  traces,
  layout,
  config,
  onExportCsv,
  normalHeight = 220,
  fullscreenHeight = 560,
}: InteractiveChartProps) {
  // plotRef points to whichever Plot is currently mounted (normal or fullscreen)
  const plotRef = useRef<any>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Callback ref — called when Plot mounts/unmounts so we always have the active instance
  const setPlotRef = useCallback((node: any) => {
    plotRef.current = node;
  }, []);

  const downloadPng = useCallback(() => {
    if (!plotRef.current) return;
    PlotlyModule.toImage(plotRef.current, {
      format: "png",
      width: 1600,
      height: 1200,
    }).then((dataUrl: string) => {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `expression_${datasetCode}_${title.replace(/\s+/g, "_")}.png`;
      a.click();
    }).catch((err: any) => {
      console.error("PNG download failed:", err);
    });
  }, [datasetCode, title]);

  const downloadSvg = useCallback(() => {
    if (!plotRef.current) return;
    PlotlyModule.toImage(plotRef.current, {
      format: "svg",
      width: 1600,
      height: 1200,
    }).then((dataUrl: string) => {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `expression_${datasetCode}_${title.replace(/\s+/g, "_")}.svg`;
      a.click();
    }).catch((err: any) => {
      console.error("SVG download failed:", err);
    });
  }, [datasetCode, title]);

  const handleCsvExport = useCallback(() => {
    onExportCsv?.(`expression_${datasetCode}.csv`);
  }, [datasetCode, onExportCsv]);

  const enterFullscreen = useCallback(() => {
    setIsFullscreen(true);
  }, []);

  const exitFullscreen = useCallback(() => {
    setIsFullscreen(false);
  }, []);

  const activeLayout = {
    ...layout,
    height: isFullscreen ? fullscreenHeight : normalHeight,
    margin: { t: 8, b: isFullscreen ? 56 : 48, l: 56, r: 16 },
    yaxis: layout.yaxis
      ? { ...layout.yaxis, domain: isFullscreen ? undefined : layout.yaxis.domain }
      : undefined,
    yaxis2: layout.yaxis2
      ? { ...layout.yaxis2, domain: isFullscreen ? undefined : layout.yaxis2.domain }
      : undefined,
  };

  const activeConfig = {
    ...config,
    displayModeBar: isFullscreen ? "hover" : false,
    responsive: true,
  };

  return (
    <>
      {/* Normal (inline) view — hidden when fullscreen is active */}
      {!isFullscreen && (
        <Paper withBorder p="md" radius="md">
          <Stack gap="xs">
            {/* Header bar */}
            <Group
              justify="space-between"
              align="center"
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
            >
              <Text size="xs" fw={600} c="dimmed">
                {title}
              </Text>
              <Group gap={4} style={{ opacity: isHovered ? 1 : 0.35, transition: "opacity 0.15s" }}>
                <Tooltip label="Fullscreen" position="bottom" withArrow>
                  <ActionIcon variant="subtle" color="gray" size="sm" onClick={enterFullscreen}>
                    <IconMaximize size={14} />
                  </ActionIcon>
                </Tooltip>
                <Menu shadow="md" width={160} position="bottom-end">
                  <Menu.Target>
                    <ActionIcon variant="subtle" color="gray" size="sm">
                      <IconDownload size={14} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Label>Export Chart</Menu.Label>
                    <Menu.Item leftSection={<IconPhoto size={13} />} onClick={downloadPng}>
                      Download PNG
                    </Menu.Item>
                    <Menu.Item leftSection={<IconVectorSpline size={13} />} onClick={downloadSvg}>
                      Download SVG
                    </Menu.Item>
                    {onExportCsv && (
                      <>
                        <Divider my={4} />
                        <Menu.Item leftSection={<IconFileTypeCsv size={13} />} onClick={handleCsvExport}>
                          Export Data (CSV)
                        </Menu.Item>
                      </>
                    )}
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </Group>

            {/* Chart at normal size */}
            <Box w="100%">
              <Plot
                ref={setPlotRef}
                data={traces}
                layout={activeLayout}
                config={activeConfig}
                style={{ width: "100%", height: normalHeight }}
                useResizeHandler
              />
            </Box>
          </Stack>
        </Paper>
      )}

      {/* Fullscreen overlay via Portal */}
      <Portal>
        {isFullscreen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              background: "white",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Fullscreen header */}
            <Group
              justify="space-between"
              align="center"
              px="md"
              py="xs"
              style={{
                borderBottom: "1px solid var(--mantine-color-gray-3)",
                flexShrink: 0,
              }}
            >
              <Text size="sm" fw={600}>{title}</Text>
              <Group gap="xs">
                <ActionIcon variant="light" color="gray" size="md" onClick={downloadPng}>
                  <Tooltip label="Download PNG"><IconPhoto size={15} /></Tooltip>
                </ActionIcon>
                <ActionIcon variant="light" color="gray" size="md" onClick={downloadSvg}>
                  <Tooltip label="Download SVG"><IconVectorSpline size={15} /></Tooltip>
                </ActionIcon>
                {onExportCsv && (
                  <ActionIcon variant="light" color="gray" size="md" onClick={handleCsvExport}>
                    <Tooltip label="Export CSV"><IconFileTypeCsv size={15} /></Tooltip>
                  </ActionIcon>
                )}
                <ActionIcon variant="light" color="gray" size="md" onClick={exitFullscreen}>
                  <Tooltip label="Exit Fullscreen"><IconMinimize size={15} /></Tooltip>
                </ActionIcon>
              </Group>
            </Group>

            {/* Fullscreen chart — fills remaining space */}
            <Box style={{ flex: 1, overflow: "hidden", padding: 16 }}>
              <Plot
                ref={setPlotRef}
                data={traces}
                layout={activeLayout}
                config={{ ...activeConfig, displayModeBar: "hover" }}
                style={{ width: "100%", height: "100%" }}
                useResizeHandler
              />
            </Box>
          </div>
        )}
      </Portal>
    </>
  );
}
