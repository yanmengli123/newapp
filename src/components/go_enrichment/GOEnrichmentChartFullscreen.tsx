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
import GOEnrichmentVisualization from "./GOEnrichmentVisualization";
import {
  exportGOEnrichmentChart,
  parsePresetSize,
  EXPORT_SIZE_OPTIONS,
  type ExportSizePreset,
} from "./goEnrichmentChartExport";
import type { GOEnrichmentResult } from "../../lib/goEnrichmentApi";

interface Props {
  opened: boolean;
  onClose: () => void;
  results: GOEnrichmentResult[];
  ontologyFilter: { P: boolean; C: boolean; F: boolean };
  onOntologyFilterChange: (f: { P: boolean; C: boolean; F: boolean }) => void;
  onTermClick: (term: GOEnrichmentResult) => void;
}

export default function GOEnrichmentChartFullscreen({
  opened,
  onClose,
  results,
  ontologyFilter,
  onOntologyFilterChange,
  onTermClick,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [sizePreset, setSizePreset] = useState<ExportSizePreset>("2000x1200");
  const [background, setBackground] = useState<"white" | "transparent">("white");
  const [filename, setFilename] = useState("go-enrichment");
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (!opened) {
      setSizePreset("2000x1200");
      setBackground("white");
      setFilename("go-enrichment");
      setIsExporting(false);
    }
  }, [opened]);

  if (!opened) return null;

  const { width: exportWidth, height: exportHeight } = parsePresetSize(sizePreset);

  const handleExport = () => {
    if (!bodyRef.current || isExporting) return;
    setIsExporting(true);
    try {
      exportGOEnrichmentChart(bodyRef.current, exportWidth, exportHeight, background, filename);
    } catch (err) {
      console.error("Failed to export GO enrichment chart:", err);
    } finally {
      setIsExporting(false);
    }
  };

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
          <Text size="sm" fw={600}>GO Enrichment Visualization</Text>
          <Text size="xs" c="dimmed">Fullscreen &amp; Export</Text>
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
          <Text size="xs" c="dimmed" style={{ alignSelf: "center" }}>
            Interactive: scroll to zoom, drag to pan
          </Text>

          <Group gap="sm">
            <SegmentedControl
              size="xs"
              value={background}
              onChange={(v) => setBackground(v as "white" | "transparent")}
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
              onChange={(v) => v && setSizePreset(v as ExportSizePreset)}
              styles={{ input: { fontSize: 12 } }}
            />

            <TextInput
              size="xs"
              w={180}
              value={filename}
              onChange={(e) => setFilename(e.currentTarget.value)}
              placeholder="go-enrichment"
              styles={{ input: { fontSize: 12 } }}
            />

            <Tooltip label="Export all visible panels as one PNG">
              <Button
                size="sm"
                leftSection={<IconDownload size={15} />}
                onClick={handleExport}
                loading={isExporting}
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
        ref={bodyRef}
        style={{
          flex: 1,
          minHeight: 0,
          padding: "12px 16px",
          overflow: "auto",
        }}
      >
        <GOEnrichmentVisualization
          results={results}
          ontologyFilter={ontologyFilter}
          onOntologyFilterChange={onOntologyFilterChange}
          onTermClick={onTermClick}
        />
      </Box>
    </Modal>
  );
}
