/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconDownload, IconX } from "@tabler/icons-react";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { BarChartEntry } from "../../lib/goEnrichmentApi";

const Plot = createPlotlyComponent(PlotlyModule);

const PLOT_CONFIG_FULLSCREEN: any = {
  responsive: true,
  displayModeBar: true,
  displayLogo: false,
  scrollZoom: true,
  locale: "en",
  modeBarButtonsToRemove: ["toImage"],
};

interface Props {
  data: { P: BarChartEntry[]; C: BarChartEntry[]; F: BarChartEntry[] };
  filtered: { P: boolean; C: boolean; F: boolean };
  onClose: () => void;
}

type ExportSizePreset = "1200x800" | "1600x1000" | "2000x1200" | "2400x1600";

const EXPORT_SIZE_OPTIONS = [
  { value: "1200x800", label: "1200×800" },
  { value: "1600x1000", label: "1600×1000" },
  { value: "2000x1200", label: "2000×1200" },
  { value: "2400x1600", label: "2400×1600" },
];

const COLORS = {
  P: "#1A8CFF",
  C: "#FF9933",
  F: "#33CC66",
};

function parsePresetSize(preset: ExportSizePreset) {
  const [width, height] = preset.split("x").map(Number);
  return { width, height };
}

export default function GOEnrichmentBarChartFullscreen({ data, filtered, onClose }: Props) {
  const graphDivRef = useRef<any>(null);
  const [plotReady, setPlotReady] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [sizePreset, setSizePreset] = useState<ExportSizePreset>("2000x1200");
  const [background, setBackground] = useState<"white" | "transparent">("white");
  const [filename, setFilename] = useState("go-enrichment-bar");

  useEffect(() => {
    if (graphDivRef.current) {
      setPlotReady(true);
    }
  }, []);

  const { width: exportWidth, height: exportHeight } = parsePresetSize(sizePreset);

  const handleDownload = async () => {
    const gd = graphDivRef.current;
    if (!gd || isDownloading) return;

    setIsDownloading(true);

    const originalPaperBg = gd.layout?.paper_bgcolor ?? "white";
    const originalPlotBg = gd.layout?.plot_bgcolor ?? "white";

    try {
      if (background === "transparent") {
        await (window as any).Plotly.relayout(gd, {
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(0,0,0,0)",
        });
      } else {
        await (window as any).Plotly.relayout(gd, {
          paper_bgcolor: "white",
          plot_bgcolor: "white",
        });
      }

      if (typeof (PlotlyModule as any).downloadImage === "function") {
        await (PlotlyModule as any).downloadImage(gd, {
          format: "png",
          width: exportWidth,
          height: exportHeight,
          filename: filename.trim() || "go-enrichment-bar",
          scale: 2,
        });
      } else if (typeof (PlotlyModule as any).toImage === "function") {
        const url = await (PlotlyModule as any).toImage(gd, {
          format: "png",
          width: exportWidth,
          height: exportHeight,
          scale: 2,
        });
        const a = document.createElement("a");
        a.href = url;
        a.download = `${filename.trim() || "go-enrichment-bar"}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error("Failed to export chart image:", error);
    } finally {
      try {
        await (window as any).Plotly.relayout(gd, {
          paper_bgcolor: originalPaperBg,
          plot_bgcolor: originalPlotBg,
        });
      } catch {
        // ignore restore failure
      }
      setIsDownloading(false);
    }
  };

  const traces: any[] = [];
  if (filtered.P) {
    const entries = data.P.slice(0, 20);
    if (entries.length > 0) {
      traces.push({
        y: entries.map((e) => e.term_name),
        x: entries.map((e) => e.neg_log10_fdr),
        type: "bar",
        orientation: "h" as const,
        marker: { color: COLORS.P },
        name: "Biological Process (P)",
        text: entries.map((e) => `${e.go_id} | Hits: ${e.query_count}/${e.background_count}`),
        hoverinfo: "text+y",
      });
    }
  }
  if (filtered.C) {
    const entries = data.C.slice(0, 20);
    if (entries.length > 0) {
      traces.push({
        y: entries.map((e) => e.term_name),
        x: entries.map((e) => e.neg_log10_fdr),
        type: "bar",
        orientation: "h" as const,
        marker: { color: COLORS.C },
        name: "Cellular Component (C)",
        text: entries.map((e) => `${e.go_id} | Hits: ${e.query_count}/${e.background_count}`),
        hoverinfo: "text+y",
      });
    }
  }
  if (filtered.F) {
    const entries = data.F.slice(0, 20);
    if (entries.length > 0) {
      traces.push({
        y: entries.map((e) => e.term_name),
        x: entries.map((e) => e.neg_log10_fdr),
        type: "bar",
        orientation: "h" as const,
        marker: { color: COLORS.F },
        name: "Molecular Function (F)",
        text: entries.map((e) => `${e.go_id} | Hits: ${e.query_count}/${e.background_count}`),
        hoverinfo: "text+y",
      });
    }
  }

  const chartHeight = "calc(100vh - 220px)";

  return (
    <Modal
      opened
      onClose={onClose}
      fullScreen
      withCloseButton={false}
      styles={{
        header: { padding: "12px 20px 8px", borderBottom: "1px solid #e9ecef" },
        body: { padding: 0, display: "flex", flexDirection: "column", height: "100vh" },
        content: { display: "flex", flexDirection: "column" },
      }}
      title={
        <Group gap="xs">
          <Text size="sm" fw={600}>GO Enrichment Bar Chart</Text>
          <Text size="xs" c="dimmed">Fullscreen View</Text>
        </Group>
      }
    >
      {/* Toolbar */}
      <Box
        style={{
          borderBottom: "1px solid #e9ecef",
          padding: "10px 20px",
          background: "#fafafa",
          flexShrink: 0,
        }}
      >
        <Group justify="space-between" wrap="wrap" gap="md">
          <Group gap="md" wrap="wrap">
            <Text size="xs" c="dimmed" style={{ alignSelf: "center" }}>
              {plotReady ? "Interactive: scroll to zoom, drag to pan" : "Loading chart..."}
            </Text>
          </Group>
          <Group gap="sm">
            <SegmentedControl
              size="xs"
              value={background}
              onChange={(value) => setBackground(value as "white" | "transparent")}
              data={[
                { value: "white", label: "White BG" },
                { value: "transparent", label: "Transparent BG" },
              ]}
            />
            <Select
              size="xs"
              w={130}
              data={EXPORT_SIZE_OPTIONS}
              value={sizePreset}
              onChange={(value) => value && setSizePreset(value as ExportSizePreset)}
              styles={{ input: { fontSize: 12 } }}
            />
            <TextInput
              size="xs"
              w={180}
              value={filename}
              onChange={(event) => setFilename(event.currentTarget.value)}
              placeholder="go-enrichment-bar"
              styles={{ input: { fontSize: 12 } }}
            />
            <Tooltip label={!plotReady ? "Chart loading..." : ""}>
              <Button
                size="sm"
                leftSection={<IconDownload size={15} />}
                onClick={handleDownload}
                disabled={!plotReady || isDownloading}
                loading={isDownloading}
              >
                Export PNG
              </Button>
            </Tooltip>
            <ActionIcon variant="subtle" color="gray" size="lg" onClick={onClose}>
              <IconX size={18} />
            </ActionIcon>
          </Group>
        </Group>
      </Box>

      {/* Chart area */}
      <Box
        style={{
          flex: 1,
          minHeight: 0,
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Box style={{ width: "100%", height: chartHeight }}>
          <Plot
            data={traces}
            layout={{
              barmode: "group",
              margin: { l: 350, r: 80, t: 20, b: 80 },
              xaxis: { title: { text: "-log10(FDR)", font: { size: 13 } }, tickangle: -30 },
              yaxis: { title: "", automargin: true, tickangle: -30, tickfont: { size: 12 } },
              font: { size: 12 },
              showlegend: true,
              legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.08 },
              paper_bgcolor: "white",
              plot_bgcolor: "white",
              bargap: 0.2,
              bargroupgap: 0.1,
            }}
            config={PLOT_CONFIG_FULLSCREEN}
            style={{ width: "100%", height: "100%" }}
            useResizeHandler
            onInitialized={(_figure: any, graphDiv: any) => {
              graphDivRef.current = graphDiv;
              setPlotReady(true);
            }}
          />
        </Box>
      </Box>
    </Modal>
  );
}