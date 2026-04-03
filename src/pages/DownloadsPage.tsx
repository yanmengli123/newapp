import {
  Box,
  Button,
  Card,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconDownload, IconFileTypePdf, IconPhoto, IconTable } from "@tabler/icons-react";

const CHARTS = [
  {
    id: "sample_composition",
    label: "Sample Composition",
    description: "Samples per stage × sex — grouped bar chart",
    formats: ["png", "svg", "csv"],
  },
  {
    id: "expression_distribution",
    label: "Expression Distribution",
    description: "Per-stage gene mean quartiles (Q1/Median/Q3)",
    formats: ["png", "svg", "csv"],
  },
  {
    id: "sex_biased_genes",
    label: "Sex-Biased Genes",
    description: "Female-higher / Male-higher gene counts per stage",
    formats: ["png", "svg", "csv"],
  },
  {
    id: "female_male_scatter",
    label: "Female vs Male Scatter",
    description: "All genes: female mean vs male mean per stage",
    formats: ["png", "svg", "csv"],
  },
  {
    id: "stage_deg_count",
    label: "Stage DEG Count",
    description: "Up/down-regulated gene counts per stage",
    formats: ["png", "svg", "csv"],
  },
  {
    id: "pca",
    label: "Sample PCA",
    description: "Samples projected onto PC1 and PC2",
    formats: ["png", "svg", "csv"],
  },
  {
    id: "top50_heatmap",
    label: "Top 50 DEG Heatmap",
    description: "Most variable genes × 36 samples (Z-score normalized)",
    formats: ["png", "svg", "csv"],
  },
  {
    id: "trajectory_clusters",
    label: "Trajectory Clusters",
    description: "Gene expression trajectory clusters (k-means k=4)",
    formats: ["png", "svg", "csv"],
  },
];

function formatColor(fmt: string): string {
  if (fmt === "png") return "blue";
  if (fmt === "svg") return "violet";
  return "teal";
}

function FormatIcon({ fmt }: { fmt: string }) {
  if (fmt === "png") return <IconPhoto size={12} />;
  if (fmt === "svg") return <IconFileTypePdf size={12} />;
  return <IconTable size={12} />;
}

export default function DownloadsPage() {
  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Title order={2}>📥 ESC Data — Static Downloads</Title>
        <Text c="dimmed" size="sm">
          Download pre-generated charts and data files for the ESC Gene Expression Atlas.
          All files are generated from the GRCg6a chicken genome ESC dataset.
        </Text>
      </Stack>

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
                {chart.formats.map(fmt => (
                  <Button
                    key={fmt}
                    size="xs"
                    variant="light"
                    color={formatColor(fmt)}
                    leftSection={<FormatIcon fmt={fmt} />}
                    component="a"
                    href={`/static/esc_overview/${chart.id}.${fmt}`}
                    target="_blank"
                    rel="noreferrer"
                    download
                  >
                    {fmt.toUpperCase()}
                  </Button>
                ))}
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
            All files are served from <Text span ff="monospace" size="sm">/static/esc_overview/</Text>.
            For high-resolution or custom formats, contact the platform administrator.
          </Text>
        </Group>
      </Card>
    </Stack>
  );
}