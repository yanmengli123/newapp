/* eslint-disable @typescript-eslint/no-explicit-any */
import { Paper, Skeleton, Stack, Text, Title, SimpleGrid } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import { getOverviewSummary, type OverviewSummary } from "../../lib/overviewApi";
import { PLOT_CONFIG, PAPER_STYLE } from "./utils";

const Plot = createPlotlyComponent(PlotlyModule);
const PLOT_HEIGHT = 240;

// ── Lazy chart wrapper ────────────────────────────────────────────────────────

function LazyChart({
  children,
}: {
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref}>
      {visible ? children : <Skeleton height={PLOT_HEIGHT} radius="md" />}
    </div>
  );
}

// ── Chart components ──────────────────────────────────────────────────────────

function SampleCompositionChart({ data }: { data: any }) {
  const traces: any[] = [
    {
      type: "bar", x: data.stages, y: data.male, name: "Male",
      marker: { color: "#228BE6", opacity: 0.85 },
      hovertemplate: "Male<br>%{x}: %{y} samples<extra></extra>",
    },
    {
      type: "bar", x: data.stages, y: data.female, name: "Female",
      marker: { color: "#E64980", opacity: 0.85 },
      hovertemplate: "Female<br>%{x}: %{y} samples<extra></extra>",
    },
  ];
  const layout: any = {
    margin: { t: 8, b: 48, l: 48, r: 16 },
    xaxis: { tickangle: -30, gridcolor: "#f0f0f0", tickfont: { size: 9 } },
    yaxis: { title: { text: "Sample Count", font: { size: 9 } }, gridcolor: "#f0f0f0", tickfont: { size: 9 } },
    barmode: "group",
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.28, font: { size: 9 } },
    hovermode: "closest" as const, ...PAPER_STYLE,
  };
  return <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: PLOT_HEIGHT }} useResizeHandler />;
}

function SexBiasedChart({ data }: { data: any }) {
  const traces: any[] = [
    {
      type: "bar", x: data.stages, y: data.female, name: "Female higher",
      marker: { color: "#E64980" },
      hovertemplate: "Female higher<br>%{x}: %{y}<extra></extra>",
    },
    {
      type: "bar", x: data.stages, y: data.male, name: "Male higher",
      marker: { color: "#228BE6" },
      hovertemplate: "Male higher<br>%{x}: %{y}<extra></extra>",
    },
  ];
  const layout: any = {
    margin: { t: 8, b: 48, l: 48, r: 16 },
    xaxis: { tickangle: -30, gridcolor: "#f0f0f0", tickfont: { size: 9 } },
    yaxis: { title: { text: "Gene Count", font: { size: 9 } }, gridcolor: "#f0f0f0", tickfont: { size: 9 } },
    barmode: "relative",
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.28, font: { size: 9 } },
    hovermode: "closest" as const, ...PAPER_STYLE,
  };
  return <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: PLOT_HEIGHT }} useResizeHandler />;
}

function FemaleMaleScatterChart({ data }: { data: any }) {
  const colors = data.genes.map((g: any) =>
    g.sex_bias_label === "Female_higher" ? "#E64980" :
    g.sex_bias_label === "Male_higher"  ? "#228BE6" : "#adb5bd"
  );
  const traces: any[] = [{
    type: "scatter", mode: "markers",
    x: data.genes.map((g: any) => g.female_mean),
    y: data.genes.map((g: any) => g.male_mean),
    text: data.genes.map((g: any) => `${g.gene_id}<br>F=${g.female_mean.toFixed(2)} M=${g.male_mean.toFixed(2)}`),
    hovertemplate: "%{text}<extra></extra>",
    marker: { color: colors, size: 5, opacity: 0.6 },
  }];
  const maxVal = data.genes.reduce(
    (m: number, g: any) => Math.max(m, g.female_mean ?? 0, g.male_mean ?? 0),
    1
  );
  const layout: any = {
    margin: { t: 8, b: 48, l: 56, r: 16 },
    xaxis: { title: { text: "Female Mean (log₂)", font: { size: 10 } }, gridcolor: "#f0f0f0", tickfont: { size: 9 }, range: [0, maxVal * 1.1] },
    yaxis: { title: { text: "Male Mean (log₂)", font: { size: 10 } }, gridcolor: "#f0f0f0", tickfont: { size: 9 }, range: [0, maxVal * 1.1] },
    shapes: [{ type: "line", x0: 0, x1: maxVal, y0: 0, y1: maxVal, line: { color: "#ccc", width: 1, dash: "dash" } }],
    hovermode: "closest" as const, ...PAPER_STYLE,
  };
  return <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: PLOT_HEIGHT }} useResizeHandler />;
}

function StageDEGCountChart({ data }: { data: any }) {
  const traces: any[] = [
    {
      type: "bar", x: data.stages, y: data.up, name: "Up-regulated",
      marker: { color: "#40c057" },
      hovertemplate: "Up<br>%{x}: +%{y}<extra></extra>",
    },
    {
      type: "bar", x: data.stages, y: data.down.map((v: number) => Math.abs(v)), name: "Down-regulated",
      marker: { color: "#fa5252" },
      hovertemplate: "Down<br>%{x}: -%{y}<extra></extra>",
    },
  ];
  const layout: any = {
    margin: { t: 8, b: 48, l: 48, r: 16 },
    xaxis: { tickangle: -30, gridcolor: "#f0f0f0", tickfont: { size: 9 } },
    yaxis: { title: { text: "DEG Count", font: { size: 9 } }, gridcolor: "#f0f0f0", tickfont: { size: 9 } },
    barmode: "group",
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.28, font: { size: 9 } },
    hovermode: "closest" as const, ...PAPER_STYLE,
  };
  return <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: PLOT_HEIGHT }} useResizeHandler />;
}

function Top50HeatmapChart({ data }: { data: any }) {
  if (!data.zmatrix?.length) return <Text size="xs" c="dimmed">No data</Text>;
  const traces: any[] = [{
    type: "heatmap", z: data.zmatrix, x: data.samples, y: data.genes,
    colorscale: "RdBu", zsmooth: "best",
    hovertemplate: "%{y}<br>%{x}<br>Z: %{z:.2f}<extra></extra>",
  }];
  const layout: any = {
    margin: { t: 8, b: 80, l: 120, r: 16 },
    xaxis: { tickangle: -45, tickfont: { size: 7 }, gridcolor: "transparent" },
    yaxis: { tickfont: { size: 7 }, gridcolor: "transparent" },
    hovermode: "closest" as const, ...PAPER_STYLE,
  };
  return <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: 280 }} useResizeHandler />;
}

function PCAChart({ data }: { data: any }) {
  const stageColors: Record<string, string> = {
    "E0": "#8B5CF6", "E3.5": "#7C3AED", "E7": "#6366F1", "E11": "#3B82F6",
    "E14": "#0EA5E9", "E18.5": "#06B6D4", "P0": "#10B981", "Adult": "#F59E0B",
  };
  const byStage: Record<string, number[]> = {};
  for (let i = 0; i < data.pc1.length; i++) {
    const s = data.samples[i].stage;
    if (!byStage[s]) byStage[s] = [];
    byStage[s].push(i);
  }
  const traces: any[] = Object.entries(byStage).map(([stage, indices]) => ({
    type: "scatter", mode: "markers",
    x: indices.map((i) => data.pc1[i]),
    y: indices.map((i) => data.pc2[i]),
    name: stage,
    text: indices.map((i) => data.samples[i].sample_name),
    marker: { color: stageColors[stage] || "#868e96", size: 7, opacity: 0.8 },
    hovertemplate: "%{text}<br>PC1: %{x:.3f}<br>PC2: %{y:.3f}<extra>%{data.name}</extra>",
  }));
  const layout: any = {
    margin: { t: 8, b: 48, l: 56, r: 16 },
    xaxis: { title: { text: `PC1 (${(data.explained_variance_ratio[0] * 100).toFixed(1)}%)`, font: { size: 9 } }, gridcolor: "#f0f0f0", tickfont: { size: 9 } },
    yaxis: { title: { text: "PC2", font: { size: 9 } }, gridcolor: "#f0f0f0", tickfont: { size: 9 } },
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.24, font: { size: 8 }, itemsizing: "constant" as const },
    hovermode: "closest" as const, ...PAPER_STYLE,
  };
  return <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: PLOT_HEIGHT }} useResizeHandler />;
}

function ExpressionDistChart({ data }: { data: any }) {
  const traces: any[] = [
    {
      type: "scatter", mode: "lines+markers", x: data.stages, y: data.q1, name: "Q1",
      line: { color: "#93C5FD", width: 1, dash: "dot" },
      marker: { size: 4, color: "#93C5FD" },
      hovertemplate: "Q1 %{x}: %{y:.2f}<extra></extra>",
    },
    {
      type: "scatter", mode: "lines+markers", x: data.stages, y: data.median, name: "Median",
      line: { color: "#228BE6", width: 2 },
      marker: { size: 5, color: "#228BE6" },
      hovertemplate: "Median %{x}: %{y:.2f}<extra></extra>",
    },
    {
      type: "scatter", mode: "lines+markers", x: data.stages, y: data.q3, name: "Q3",
      line: { color: "#93C5FD", width: 1, dash: "dot" },
      marker: { size: 4, color: "#93C5FD" },
      hovertemplate: "Q3 %{x}: %{y:.2f}<extra></extra>",
    },
  ];
  const layout: any = {
    margin: { t: 8, b: 48, l: 56, r: 16 },
    xaxis: { tickangle: -30, gridcolor: "#f0f0f0", tickfont: { size: 9 } },
    yaxis: { title: { text: "Expression (Mean)", font: { size: 9 } }, gridcolor: "#f0f0f0", tickfont: { size: 9 } },
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.28, font: { size: 9 } },
    hovermode: "closest" as const, ...PAPER_STYLE,
  };
  return <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: PLOT_HEIGHT }} useResizeHandler />;
}

function TrajectoryClustersChart({ data }: { data: any }) {
  const clusterColors = ["#8B5CF6", "#F59E0B", "#10B981", "#E64980"];
  const traces: any[] = data.centroids.map((centroid: number[], i: number) => ({
    type: "scatter", mode: "lines+markers", x: data.stages, y: centroid,
    name: `Cluster ${i + 1}`,
    line: { color: clusterColors[i % clusterColors.length], width: 2 },
    marker: { color: clusterColors[i % clusterColors.length], size: 5 },
    hovertemplate: `Cluster ${i + 1}<br>%{x}: %{y:.3f}<extra></extra>`,
  }));
  const layout: any = {
    margin: { t: 8, b: 48, l: 56, r: 16 },
    xaxis: { tickangle: -30, gridcolor: "#f0f0f0", tickfont: { size: 9 } },
    yaxis: { title: { text: "Mean Expression", font: { size: 9 } }, gridcolor: "#f0f0f0", tickfont: { size: 9 } },
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.28, font: { size: 9 } },
    hovermode: "closest" as const, ...PAPER_STYLE,
  };
  return <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: PLOT_HEIGHT }} useResizeHandler />;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EscOverviewSection() {
  const [data, setData] = useState<OverviewSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Single request — all data in one shot
    getOverviewSummary()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Stack gap="lg">
        <Skeleton height={40} w="60%" radius="md" />
        {Array.from({ length: 4 }).map((_, i) => (
          <SimpleGrid key={i} cols={{ base: 1, sm: 2 }} spacing="md">
            <Skeleton height={PLOT_HEIGHT + 60} radius="md" />
            <Skeleton height={PLOT_HEIGHT + 60} radius="md" />
          </SimpleGrid>
        ))}
      </Stack>
    );
  }

  if (!data) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text c="dimmed" size="sm">Failed to load ESC Atlas data.</Text>
      </Paper>
    );
  }

  return (
    <Stack gap="lg">
      {/* Header */}
      <Stack gap={2}>
        <Title order={3}>🧬 ESC Gene Expression Atlas</Title>
        <Text size="sm" c="dimmed">
          GRCg6a chicken embryonic development — global overview across all genes and samples
        </Text>
      </Stack>

      {/* Row 1 */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Paper withBorder p="sm" radius="md">
          <Stack gap="xs">
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">Sample Composition</Text>
            <Text size="xs" c="dimmed">Samples per stage × sex (n=36)</Text>
            <LazyChart>
              <SampleCompositionChart data={data.sample_composition} />
            </LazyChart>
          </Stack>
        </Paper>
        <Paper withBorder p="sm" radius="md">
          <Stack gap="xs">
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">Expression Distribution</Text>
            <Text size="xs" c="dimmed">Per-stage gene mean quartiles</Text>
            <LazyChart>
              <ExpressionDistChart data={data.expression_distribution} />
            </LazyChart>
          </Stack>
        </Paper>
      </SimpleGrid>

      {/* Row 2 */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Paper withBorder p="sm" radius="md">
          <Stack gap="xs">
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">Sex-Biased Genes</Text>
            <Text size="xs" c="dimmed">Female-higher / Male-higher per stage</Text>
            <LazyChart>
              <SexBiasedChart data={data.sex_biased_genes} />
            </LazyChart>
          </Stack>
        </Paper>
        <Paper withBorder p="sm" radius="md">
          <Stack gap="xs">
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">Female vs Male Mean Expression</Text>
            <Text size="xs" c="dimmed">All genes, colored by sex bias</Text>
            <LazyChart>
              <FemaleMaleScatterChart data={data.female_male_scatter} />
            </LazyChart>
          </Stack>
        </Paper>
      </SimpleGrid>

      {/* Row 3 */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Paper withBorder p="sm" radius="md">
          <Stack gap="xs">
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">DEG Count by Stage</Text>
            <Text size="xs" c="dimmed">Up-regulated / Down-regulated genes per stage</Text>
            <LazyChart>
              <StageDEGCountChart data={data.stage_deg_count} />
            </LazyChart>
          </Stack>
        </Paper>
        <Paper withBorder p="sm" radius="md">
          <Stack gap="xs">
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">Sample PCA — PC1 vs PC2</Text>
            <Text size="xs" c="dimmed">Samples projected onto principal components</Text>
            <LazyChart>
              <PCAChart data={data.pca} />
            </LazyChart>
          </Stack>
        </Paper>
      </SimpleGrid>

      {/* Row 4 */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Paper withBorder p="sm" radius="md">
          <Stack gap="xs">
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">Top 50 DEG Heatmap</Text>
            <Text size="xs" c="dimmed">Most variable genes × 36 samples (Z-score)</Text>
            <LazyChart>
              <Top50HeatmapChart data={data.top50_heatmap} />
            </LazyChart>
          </Stack>
        </Paper>
        <Paper withBorder p="sm" radius="md">
          <Stack gap="xs">
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">Gene Trajectory Clusters</Text>
            <Text size="xs" c="dimmed">K-means (k=4) on stage-wise expression profiles</Text>
            <LazyChart>
              <TrajectoryClustersChart data={data.trajectory_clusters} />
            </LazyChart>
          </Stack>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
