import {
  Badge,
  Box,
  Card,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconDownload, IconTable } from "@tabler/icons-react";
import { useState } from "react";
import { API_BASE } from "../lib/apiClient";

const CHARTS = [
  {
    id: "sample_composition",
    label: "Sample Composition",
    description: "Samples per stage × sex — grouped bar chart",
  },
  {
    id: "expression_distribution",
    label: "Expression Distribution",
    description: "Per-stage gene mean quartiles (Q1/Median/Q3)",
  },
  {
    id: "sex_biased_genes",
    label: "Sex-Biased Genes",
    description: "Female-higher / Male-higher gene counts per stage",
  },
  {
    id: "female_male_scatter",
    label: "Female vs Male Scatter",
    description: "All genes: female mean vs male mean per stage",
  },
  {
    id: "stage_deg_count",
    label: "Stage DEG Count",
    description: "Up/down-regulated gene counts per stage",
  },
  {
    id: "pca",
    label: "Sample PCA",
    description: "Samples projected onto PC1 and PC2",
  },
  {
    id: "top50_heatmap",
    label: "Top 50 DEG Heatmap",
    description: "Most variable genes × 36 samples (Z-score normalized)",
  },
  {
    id: "trajectory_clusters",
    label: "Trajectory Clusters",
    description: "Gene expression trajectory clusters (k-means k=4)",
  },
];

function downloadCsv(chartId: string) {
  return fetch(`${API_BASE}/overview/${chartId}/csv`);
}

export default function DownloadsPage() {
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownload = async (chartId: string) => {
    setDownloadError(null);
    try {
      const res = await downloadCsv(chartId);
      if (!res.ok) throw new Error(res.statusText);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${chartId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(`Download failed for ${chartId}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  };

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Title order={2}>📥 ESC Data — Downloads</Title>
        <Text c="dimmed" size="sm">
          Download chart data as CSV for the ESC Gene Expression Atlas.
          PNG/SVG exports coming soon — chart images are generated dynamically on the overview page.
        </Text>
      </Stack>

      {downloadError && (
        <Text c="red" size="sm">{downloadError}</Text>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {CHARTS.map(chart => (
          <Card key={chart.id} withBorder radius="md" padding="md">
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Box>
                  <Text fw={600} size="sm">{chart.label}</Text>
                  <Text size="xs" c="dimmed">{chart.description}</Text>
                </Box>
              </Group>

              <Divider />

              <Group gap="xs" wrap="wrap">
                <button
                  onClick={() => handleDownload(chart.id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "4px 10px",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    color: "#0d9488",
                    background: "var(--mantine-color-teal-0)",
                    border: "1px solid var(--mantine-color-teal-2)",
                    borderRadius: "var(--mantine-radius-md)",
                    cursor: "pointer",
                  }}
                >
                  <IconTable size={12} />
                  CSV
                </button>
                <Badge size="xs" color="gray" variant="light">PNG/SVG coming soon</Badge>
              </Group>
            </Stack>
          </Card>
        ))}
      </SimpleGrid>

      <Card withBorder radius="md" p="md" bg="gray.0">
        <Group gap="xs">
          <ThemeIcon variant="light" color="gray" size="sm">
            <IconDownload size={14} />
          </ThemeIcon>
          <Text size="sm" c="dimmed">
            CSV data is served live from the <Text span ff="monospace" size="sm">/overview/&lt;id&gt;/csv</Text> API endpoints.
            Chart images are rendered dynamically on the homepage — use screenshot or Plotly export for PNG/SVG.
          </Text>
        </Group>
      </Card>
    </Stack>
  );
}
