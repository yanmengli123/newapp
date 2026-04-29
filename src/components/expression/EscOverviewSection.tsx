/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ActionIcon,
  Badge,
  Drawer,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure, useHotkeys } from "@mantine/hooks";
import { IconMaximize } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import { getOverviewSummary, type OverviewSummary } from "../../lib/overviewApi";
import { PLOT_CONFIG, PAPER_STYLE } from "./utils";

const Plot = createPlotlyComponent(PlotlyModule);
const PLOT_HEIGHT = 240;
const FULL_PLOT_HEIGHT = 480;

// ── Lazy chart wrapper ────────────────────────────────────────────────────────

function LazyChart({ children }: { children: React.ReactNode }) {
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

  return <div ref={ref}>{visible ? children : <Skeleton height={PLOT_HEIGHT} radius="md" />}</div>;
}

// ── Click-to-fullscreen wrapper ─────────────────────────────────────────────

interface ChartCardProps {
  title: string;
  subtitle: string;
  thumbnail: React.ReactNode;
  fullscreenChart: React.ReactNode;
  badge?: string;
}

function ChartCard({ title, subtitle, thumbnail, fullscreenChart, badge }: ChartCardProps) {
  const [opened, { open, close }] = useDisclosure(false);
  useHotkeys([["Escape", close]]);

  return (
    <>
      <Paper
        withBorder
        p="sm"
        radius="md"
        role="button"
        tabIndex={0}
        style={{ cursor: "zoom-in", position: "relative", overflow: "hidden" }}
        onClick={open}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
      >
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          style={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}
          onClick={(e) => { e.stopPropagation(); open(); }}
        >
          <IconMaximize size={14} />
        </ActionIcon>
        <Stack gap="xs">
          <Text component="span" size="xs" fw={600} c="dimmed" tt="uppercase">
            {title} {badge && <Badge size="xs" ml={4}>{badge}</Badge>}
          </Text>
          <Text size="xs" c="dimmed">{subtitle}</Text>
          {thumbnail}
        </Stack>
      </Paper>

      <Drawer
        opened={opened}
        onClose={close}
        title={<Text fw={600} size="sm">{title}</Text>}
        position="right"
        size="90vw"
        styles={{ body: { padding: 0, height: "calc(100vh - 60px)" } }}
      >
        <div style={{ width: "100%", height: "100%", padding: 16 }}>
          {fullscreenChart}
        </div>
      </Drawer>
    </>
  );
}

// ── Agglomerative clustering (pure numpy) ─────────────────────────────────────

function cluster_hierarchy(
  matrix: number[][],
  n_clusters: number
): number[] {
  // matrix: (n_samples, n_features) — we want to cluster rows
  const n = matrix.length;
  if (n <= n_clusters) return Array.from({ length: n }, (_, i) => i);

  // Compute pairwise Euclidean distances
  const dists: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let d = 0;
      for (let k = 0; k < matrix[i].length; k++) {
        const diff = matrix[i][k] - matrix[j][k];
        d += diff * diff;
      }
      dists[i][j] = dists[j][i] = Math.sqrt(d);
    }
  }

  // Ward linkage: start with n clusters, each as its own group
  const clusters: number[][] = Array.from({ length: n }, (_, i) => [i]);
  const mergeDist: number[] = [];

  while (clusters.length > n_clusters) {
    // Find the pair of clusters with minimum distance (single linkage)
    let minD = Infinity, ci = -1, cj = -1;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        let maxD = 0;
        for (const a of clusters[i]) {
          for (const b of clusters[j]) {
            if (dists[a][b] > maxD) maxD = dists[a][b];
          }
        }
        if (maxD < minD) { minD = maxD; ci = i; cj = j; }
      }
    }
    if (ci === -1) break;
    // Merge ci and cj
    mergeDist.push(minD);
    clusters[ci] = [...clusters[ci], ...clusters[cj]];
    clusters.splice(cj, 1);
  }

  // For each original row, find which cluster it belongs to
  const labels: number[] = Array(n);
  clusters.forEach((c, li) => c.forEach(idx => { labels[idx] = li; }));

  // Sort genes within each cluster by their average expression (descending)
  const withinClusterOrder: number[][] = clusters.map(c => {
    const means: [number, number][] = c.map(idx => {
      const vals = matrix[idx];
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      return [idx, mean] as [number, number];
    });
    means.sort((a, b) => b[1] - a[1]);
    return means.map(([idx]) => idx);
  });

  // Flatten to get final gene order
  return withinClusterOrder.flat();
}

// ── Chart components ──────────────────────────────────────────────────────────

function SampleCompositionChart({ data, fullscreen }: { data: any; fullscreen?: boolean }) {
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
    margin: { t: 16, b: fullscreen ? 60 : 48, l: 56, r: 24 },
    xaxis: { tickangle: -30, gridcolor: "#f0f0f0", tickfont: { size: fullscreen ? 11 : 9 } },
    yaxis: { title: { text: "Sample Count", font: { size: fullscreen ? 11 : 9 } }, gridcolor: "#f0f0f0", tickfont: { size: fullscreen ? 11 : 9 } },
    barmode: "group",
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.28, font: { size: fullscreen ? 11 : 9 } },
    hovermode: "closest" as const, ...PAPER_STYLE,
    height: fullscreen ? FULL_PLOT_HEIGHT : PLOT_HEIGHT,
  };
  return <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: fullscreen ? FULL_PLOT_HEIGHT : PLOT_HEIGHT }} useResizeHandler />;
}

function SexBiasedChart({ data, fullscreen }: { data: any; fullscreen?: boolean }) {
  // Female → negative (left side), Male → positive (right side)
  const femaleVals = data.female.map((v: number) => -v);
  const maleVals = data.male;

  const maxAbs = Math.max(...data.female, ...data.male, 1);

  const traces: any[] = [
    {
      type: "bar",
      y: data.stages,
      x: femaleVals,
      orientation: "h",
      name: "Female higher",
      marker: { color: "#E64980", opacity: 0.85 },
      hovertemplate: "Female higher<br>%{y}: %{customdata}<extra></extra>",
      customdata: data.female,
    },
    {
      type: "bar",
      y: data.stages,
      x: maleVals,
      orientation: "h",
      name: "Male higher",
      marker: { color: "#228BE6", opacity: 0.85 },
      hovertemplate: "Male higher<br>%{y}: %{customdata}<extra></extra>",
      customdata: data.male,
    },
  ];

  const layout: any = {
    margin: { t: 16, b: fullscreen ? 56 : 44, l: fullscreen ? 80 : 64, r: 80 },
    xaxis: {
      title: { text: "Gene Count", font: { size: fullscreen ? 11 : 9 } },
      tickfont: { size: fullscreen ? 10 : 9 },
      gridcolor: "#f0f0f0",
      zeroline: true,
      zerolinewidth: 2,
      zerolinecolor: "#888",
      range: [-maxAbs * 1.15, maxAbs * 1.15],
      tickvals: Array.from({ length: 9 }, (_, i) => -Math.round(maxAbs * (4 - i) / 4)),
      ticktext: Array.from({ length: 9 }, (_, i) => {
        const v = Math.round(maxAbs * (4 - i) / 4);
        return v === 0 ? "0" : v.toString();
      }),
    },
    yaxis: {
      tickfont: { size: fullscreen ? 11 : 9 },
      gridcolor: "transparent",
      automargin: true,
    },
    barmode: "relative",
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.16, font: { size: fullscreen ? 11 : 9 } },
    hovermode: "closest" as const,
    annotations: [
      // Label "Female" on the left of zero line
      {
        x: -maxAbs * 0.5,
        y: data.stages.length - 0.5,
        xref: "x",
        yref: "y",
        text: "♀ Female",
        showarrow: false,
        font: { size: fullscreen ? 11 : 9, color: "#E64980" },
        xanchor: "center",
      },
      // Label "Male" on the right of zero line
      {
        x: maxAbs * 0.5,
        y: data.stages.length - 0.5,
        xref: "x",
        yref: "y",
        text: "Male ♂",
        showarrow: false,
        font: { size: fullscreen ? 11 : 9, color: "#228BE6" },
        xanchor: "center",
      },
    ],
    ...PAPER_STYLE,
    height: fullscreen ? FULL_PLOT_HEIGHT : PLOT_HEIGHT,
  };
  return <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: fullscreen ? FULL_PLOT_HEIGHT : PLOT_HEIGHT }} useResizeHandler />;
}

function FemaleMaleScatterChart({ data, fullscreen }: { data: any; fullscreen?: boolean }) {
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
    marker: { color: colors, size: fullscreen ? 8 : 5, opacity: 0.65 },
  }];
  const maxVal = data.genes.reduce(
    (m: number, g: any) => Math.max(m, g.female_mean ?? 0, g.male_mean ?? 0),
    1
  );
  const layout: any = {
    margin: { t: 16, b: fullscreen ? 60 : 48, l: 64, r: 24 },
    xaxis: { title: { text: "Female Mean (log₂)", font: { size: 11 } }, gridcolor: "#f0f0f0", tickfont: { size: 10 }, range: [0, maxVal * 1.1] },
    yaxis: { title: { text: "Male Mean (log₂)", font: { size: 11 } }, gridcolor: "#f0f0f0", tickfont: { size: 10 }, range: [0, maxVal * 1.1] },
    shapes: [{ type: "line", x0: 0, x1: maxVal, y0: 0, y1: maxVal, line: { color: "#ccc", width: 1.5, dash: "dash" } }],
    hovermode: "closest" as const, ...PAPER_STYLE,
    height: fullscreen ? FULL_PLOT_HEIGHT : PLOT_HEIGHT,
  };
  return <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: fullscreen ? FULL_PLOT_HEIGHT : PLOT_HEIGHT }} useResizeHandler />;
}

function StageDEGCountChart({ data, fullscreen }: { data: any; fullscreen?: boolean }) {
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
    margin: { t: 16, b: fullscreen ? 60 : 48, l: 56, r: 24 },
    xaxis: { tickangle: -30, gridcolor: "#f0f0f0", tickfont: { size: fullscreen ? 11 : 9 } },
    yaxis: { title: { text: "DEG Count", font: { size: fullscreen ? 11 : 9 } }, gridcolor: "#f0f0f0", tickfont: { size: fullscreen ? 11 : 9 } },
    barmode: "group",
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.28, font: { size: fullscreen ? 11 : 9 } },
    hovermode: "closest" as const, ...PAPER_STYLE,
    height: fullscreen ? FULL_PLOT_HEIGHT : PLOT_HEIGHT,
  };
  return <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: fullscreen ? FULL_PLOT_HEIGHT : PLOT_HEIGHT }} useResizeHandler />;
}

function Top50HeatmapChart({ data, fullscreen }: { data: any; fullscreen?: boolean }) {
  const geneIds = (data.genes || []) as string[];
  const sampleNames = (data.samples || []) as string[];
  const zmatrix = (data.zmatrix || []) as number[][];

  // Hierarchical cluster genes so similar expression patterns are adjacent
  const geneOrder = useMemo(() => cluster_hierarchy(zmatrix, 8), [zmatrix]);

  if (!zmatrix.length) return <Text size="xs" c="dimmed">No data</Text>;

  const orderedGenes = geneOrder.map(i => geneIds[i]);
  const orderedZmatrix = geneOrder.map(rowIdx => zmatrix[rowIdx]);

  const traces: any[] = [{
    type: "heatmap",
    z: orderedZmatrix,
    x: sampleNames,
    y: orderedGenes,
    colorscale: [
      [0.0, "#2166AC"],
      [0.25, "#74ADD1"],
      [0.5, "#F7F7F7"],
      [0.75, "#F46D43"],
      [1.0, "#B2182B"],
    ],
    zmid: 0,
    zsmooth: fullscreen ? false : "best",
    hovertemplate: "%{y}<br>%{x}<br>Z: %{z:.2f}<extra></extra>",
    showscale: true,
    colorbar: {
      len: 0.75,
      thickness: 16,
      tickfont: { size: 9 },
      title: { text: "Z-score", font: { size: 10 } },
    },
  }];

  const layout: any = {
    margin: { t: fullscreen ? 16 : 8, b: fullscreen ? 100 : 90, l: 140, r: fullscreen ? 32 : 16 },
    xaxis: {
      tickangle: -45,
      tickfont: { size: fullscreen ? 10 : 7 },
      gridcolor: "transparent",
      side: "bottom",
    },
    yaxis: {
      tickfont: { size: fullscreen ? 9 : 7 },
      gridcolor: "transparent",
      autorange: "reversed" as const,  // gene names left-to-right
    },
    hovermode: "closest" as const,
    ...PAPER_STYLE,
    height: fullscreen ? 640 : 320,
  };
  return <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: fullscreen ? 640 : 320 }} useResizeHandler />;
}

function PCAChart({ data, fullscreen }: { data: any; fullscreen?: boolean }) {
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
    marker: { color: stageColors[stage] || "#868e96", size: fullscreen ? 11 : 7, opacity: 0.85, line: { width: 0.5, color: "#fff" } },
    hovertemplate: "%{text}<br>PC1: %{x:.4f}<br>PC2: %{y:.4f}<extra>%{data.name}</extra>",
  }));
  const layout: any = {
    margin: { t: 16, b: fullscreen ? 60 : 48, l: 64, r: 24 },
    xaxis: { title: { text: `PC1 — ${(data.explained_variance_ratio[0] * 100).toFixed(1)}% var`, font: { size: 11 } }, gridcolor: "#f0f0f0", tickfont: { size: 10 } },
    yaxis: { title: { text: `PC2 — ${(data.explained_variance_ratio[1] * 100).toFixed(1)}% var`, font: { size: 11 } }, gridcolor: "#f0f0f0", tickfont: { size: 10 } },
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.22, font: { size: fullscreen ? 11 : 8 }, itemsizing: "constant" as const },
    hovermode: "closest" as const, ...PAPER_STYLE,
    height: fullscreen ? FULL_PLOT_HEIGHT : PLOT_HEIGHT,
  };
  return <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: fullscreen ? FULL_PLOT_HEIGHT : PLOT_HEIGHT }} useResizeHandler />;
}

function ExpressionDistChart({ data, fullscreen }: { data: any; fullscreen?: boolean }) {
  const traces: any[] = [
    {
      type: "scatter", mode: "lines+markers", x: data.stages, y: data.q1, name: "Q1",
      line: { color: "#93C5FD", width: 1, dash: "dot" },
      marker: { size: fullscreen ? 6 : 4, color: "#93C5FD" },
      hovertemplate: "Q1 %{x}: %{y:.2f}<extra></extra>",
    },
    {
      type: "scatter", mode: "lines+markers", x: data.stages, y: data.median, name: "Median",
      line: { color: "#228BE6", width: 2 },
      marker: { size: fullscreen ? 7 : 5, color: "#228BE6" },
      hovertemplate: "Median %{x}: %{y:.2f}<extra></extra>",
    },
    {
      type: "scatter", mode: "lines+markers", x: data.stages, y: data.q3, name: "Q3",
      line: { color: "#93C5FD", width: 1, dash: "dot" },
      marker: { size: fullscreen ? 6 : 4, color: "#93C5FD" },
      hovertemplate: "Q3 %{x}: %{y:.2f}<extra></extra>",
    },
  ];
  const layout: any = {
    margin: { t: 16, b: fullscreen ? 60 : 48, l: 64, r: 24 },
    xaxis: { tickangle: -30, gridcolor: "#f0f0f0", tickfont: { size: fullscreen ? 11 : 9 } },
    yaxis: { title: { text: "Expression (Mean)", font: { size: fullscreen ? 11 : 9 } }, gridcolor: "#f0f0f0", tickfont: { size: fullscreen ? 11 : 9 } },
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.28, font: { size: fullscreen ? 11 : 9 } },
    hovermode: "closest" as const, ...PAPER_STYLE,
    height: fullscreen ? FULL_PLOT_HEIGHT : PLOT_HEIGHT,
  };
  return <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: fullscreen ? FULL_PLOT_HEIGHT : PLOT_HEIGHT }} useResizeHandler />;
}

function TrajectoryClustersChart({ data, fullscreen }: { data: any; fullscreen?: boolean }) {
  const clusterColors = ["#8B5CF6", "#F59E0B", "#10B981", "#E64980"];
  const traces: any[] = data.centroids.map((centroid: number[], i: number) => ({
    type: "scatter", mode: "lines+markers", x: data.stages, y: centroid,
    name: `Cluster ${i + 1}`,
    line: { color: clusterColors[i % clusterColors.length], width: fullscreen ? 3 : 2 },
    marker: { color: clusterColors[i % clusterColors.length], size: fullscreen ? 7 : 5 },
    hovertemplate: `Cluster ${i + 1}<br>%{x}: %{y:.3f}<extra></extra>`,
  }));
  const layout: any = {
    margin: { t: 16, b: fullscreen ? 60 : 48, l: 64, r: 24 },
    xaxis: { tickangle: -30, gridcolor: "#f0f0f0", tickfont: { size: fullscreen ? 11 : 9 } },
    yaxis: { title: { text: "Mean Expression", font: { size: fullscreen ? 11 : 9 } }, gridcolor: "#f0f0f0", tickfont: { size: fullscreen ? 11 : 9 } },
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.28, font: { size: fullscreen ? 11 : 9 } },
    hovermode: "closest" as const, ...PAPER_STYLE,
    height: fullscreen ? FULL_PLOT_HEIGHT : PLOT_HEIGHT,
  };
  return <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: fullscreen ? FULL_PLOT_HEIGHT : PLOT_HEIGHT }} useResizeHandler />;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EscOverviewSection() {
  const [data, setData] = useState<OverviewSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    getOverviewSummary()
      .then((d) => { if (!controller.signal.aborted) setData(d); })
      .catch((e) => { if (!controller.signal.aborted) console.error(e); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
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
          GRCg6a chicken embryonic development — click any chart for full-size view
        </Text>
      </Stack>

      {/* Row 1 */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <ChartCard
          title="Sample Composition"
          subtitle="Samples per stage × sex (n=36)"
          thumbnail={<LazyChart><SampleCompositionChart data={data.sample_composition} /></LazyChart>}
          fullscreenChart={<SampleCompositionChart data={data.sample_composition} fullscreen />}
        />
        <ChartCard
          title="Expression Distribution"
          subtitle="Per-stage gene mean quartiles"
          thumbnail={<LazyChart><ExpressionDistChart data={data.expression_distribution} /></LazyChart>}
          fullscreenChart={<ExpressionDistChart data={data.expression_distribution} fullscreen />}
        />
      </SimpleGrid>

      {/* Row 2 */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <ChartCard
          title="Sex-Biased Genes"
          subtitle="Female-higher / Male-higher per stage"
          thumbnail={<LazyChart><SexBiasedChart data={data.sex_biased_genes} /></LazyChart>}
          fullscreenChart={<SexBiasedChart data={data.sex_biased_genes} fullscreen />}
        />
        <ChartCard
          title="Female vs Male Mean Expression"
          subtitle="All genes, colored by sex bias"
          thumbnail={<LazyChart><FemaleMaleScatterChart data={data.female_male_scatter} /></LazyChart>}
          fullscreenChart={<FemaleMaleScatterChart data={data.female_male_scatter} fullscreen />}
        />
      </SimpleGrid>

      {/* Row 3 */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <ChartCard
          title="DEG Count by Stage"
          subtitle="Up-regulated / Down-regulated genes per stage"
          thumbnail={<LazyChart><StageDEGCountChart data={data.stage_deg_count} /></LazyChart>}
          fullscreenChart={<StageDEGCountChart data={data.stage_deg_count} fullscreen />}
        />
        <ChartCard
          title="Sample PCA — PC1 vs PC2"
          subtitle="Samples projected onto principal components"
          thumbnail={<LazyChart><PCAChart data={data.pca} /></LazyChart>}
          fullscreenChart={<PCAChart data={data.pca} fullscreen />}
        />
      </SimpleGrid>

      {/* Row 4 */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <ChartCard
          title="Top 50 DEG Heatmap"
          subtitle="Most variable genes × 36 samples (Z-score, clustered)"
          badge="Clustered"
          thumbnail={<LazyChart><Top50HeatmapChart data={data.top50_heatmap} /></LazyChart>}
          fullscreenChart={<Top50HeatmapChart data={data.top50_heatmap} fullscreen />}
        />
        <ChartCard
          title="Gene Trajectory Clusters"
          subtitle="K-means (k=4) on stage-wise expression profiles"
          thumbnail={<LazyChart><TrajectoryClustersChart data={data.trajectory_clusters} /></LazyChart>}
          fullscreenChart={<TrajectoryClustersChart data={data.trajectory_clusters} fullscreen />}
        />
      </SimpleGrid>
    </Stack>
  );
}
