/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ActionIcon,
  Box,
  Divider,
  Drawer,
  Group,
  Menu,
  Paper,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useRef, useState, useCallback } from "react";
import {
  IconMaximize,
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
  /** Plotly layout (domain fields will be overridden in fullscreen) */
  layout: any;
  /** Plotly config */
  config: any;
  /** Called with filename when user requests CSV export */
  onExportCsv?: (filename: string) => void;
  /** Normal (not fullscreen) height in px */
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
  fullscreenHeight = 480,
}: InteractiveChartProps) {
  const plotRef = useRef<any>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const downloadPng = useCallback(() => {
    PlotlyModule.toImage(plotRef.current, {
      format: "png",
      width: 1600,
      height: 1200,
    }).then((dataUrl: string) => {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `expression_${datasetCode}_${title.replace(/\s+/g, "_")}.png`;
      a.click();
    });
  }, [datasetCode, title]);

  const downloadSvg = useCallback(() => {
    PlotlyModule.toImage(plotRef.current, {
      format: "svg",
      width: 1600,
      height: 1200,
    }).then((dataUrl: string) => {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `expression_${datasetCode}_${title.replace(/\s+/g, "_")}.svg`;
      a.click();
    });
  }, [datasetCode, title]);

  const handleCsvExport = useCallback(() => {
    onExportCsv?.(`expression_${datasetCode}.csv`);
  }, [datasetCode, onExportCsv]);

  const fullscreenConfig = {
    ...config,
    displayModeBar: "hover",
    responsive: true,
  };

  const normalConfig = {
    ...config,
    displayModeBar: false,
    responsive: true,
  };

  // In fullscreen, clear yaxis domain so it auto-sizes to full height
  const fullscreenLayout = {
    ...layout,
    height: fullscreenHeight,
    margin: { t: 8, b: 48, l: 56, r: 16 },
    yaxis: layout.yaxis ? { ...layout.yaxis, domain: undefined } : undefined,
    yaxis2: layout.yaxis2 ? { ...layout.yaxis2, domain: undefined } : undefined,
  };

  return (
    <>
      <Paper withBorder p="md" radius="md">
        <Stack gap="xs">
          {/* Header bar */}
          <Group justify="space-between" align="center" onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
            <Text size="xs" fw={600} c="dimmed">
              {title}
            </Text>
            <Group gap={4} style={{ opacity: isHovered || fullscreen ? 1 : 0.35, transition: "opacity 0.15s" }}>
              <Tooltip label="Fullscreen" position="bottom" withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={() => setFullscreen(true)}
                >
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

          {/* Chart */}
          <Box w="100%" style={{ cursor: isHovered ? "crosshair" : "default" }}>
            <Plot
              ref={plotRef}
              data={traces}
              layout={layout}
              config={normalConfig}
              style={{ width: "100%", height: normalHeight }}
              useResizeHandler
            />
          </Box>
        </Stack>
      </Paper>

      {/* Fullscreen Drawer */}
      <Drawer
        opened={fullscreen}
        onClose={() => setFullscreen(false)}
        position="right"
        size="100%"
        withCloseButton
        title={
          <Text size="sm" fw={600}>{title}</Text>
        }
        styles={{
          body: { padding: 0, height: "calc(100vh - 60px)", overflow: "auto" },
          header: { padding: "8px 16px", borderBottom: "1px solid var(--mantine-color-gray-3)" },
        }}
      >
        <Box p="md" style={{ height: "100%" }}>
          <Plot
            data={traces}
            layout={fullscreenLayout}
            config={fullscreenConfig}
            style={{ width: "100%", height: fullscreenHeight }}
            useResizeHandler
          />
          {/* Action bar in fullscreen */}
          <Group justify="center" gap="md" mt="md">
            <ActionIcon variant="light" color="gray" size="lg" onClick={downloadPng}>
              <Tooltip label="Download PNG"><IconPhoto size={18} /></Tooltip>
            </ActionIcon>
            <ActionIcon variant="light" color="gray" size="lg" onClick={downloadSvg}>
              <Tooltip label="Download SVG"><IconVectorSpline size={18} /></Tooltip>
            </ActionIcon>
            {onExportCsv && (
              <ActionIcon variant="light" color="gray" size="lg" onClick={handleCsvExport}>
                <Tooltip label="Export CSV"><IconFileTypeCsv size={18} /></Tooltip>
              </ActionIcon>
            )}
          </Group>
        </Box>
      </Drawer>
    </>
  );
}
