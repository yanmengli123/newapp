/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Loader, Paper, Stack, Text, Title, SimpleGrid } from "@mantine/core";
import { useEffect, useState } from "react";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import {
  getSampleComposition,
  getSexBiasedGenes,
  getFemaleMaleScatter,
  getStageDEGCount,
  getTop50Heatmap,
  getPCA,
  getExpressionDistribution,
  getTrajectoryClusters,
  type SampleComposition,
  type SexBiasedGenes,
  type FemaleMaleScatter,
  type StageDEGCount,
  type Top50Heatmap,
  type PCA,
  type ExpressionDistribution,
  type TrajectoryClusters,
} from "../../lib/overviewApi";
import { PLOT_CONFIG, PAPER_STYLE } from "./utils";

const Plot = createPlotlyComponent(PlotlyModule);

const PLOT_HEIGHT = 240;

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <Stack gap={2} mb={4}>
      <Text size="xs" fw={600} c="dimmed" tt="uppercase">{title}</Text>
      {subtitle && <Text size="xs" c="dimmed">{subtitle}</Text>}
    </Stack>
  );
}

function ChartCard({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <Paper withBorder p="sm" radius="md">
      <Stack gap="xs">
        <SectionHeader title={title} subtitle={subtitle} />
        {children}
      </Stack>
    </Paper>
  );
}

function MiniLoader() {
  return (
    <Box py={60} style={{ display: "flex", justifyContent: "center" }}>
      <Loader size="sm" />
    </Box>
  );
}

// ── Chart components ──────────────────────────────────────────────────────────

function SampleCompositionChart({ data }: { data: SampleComposition }) {
  const traces: any[] = [
    {
      type: "bar",
      x: data.stages,
      y: data.male,
      name: "Male",
      marker: { color: "#228BE6", opacity: 0.85 },
      hovertemplate: "Male<br>%{x}: %{y} samples<extra></extra>",
    },
    {
      type: "bar",
      x: data.stages,
      y: data.female,
      name: "Female",
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
    hovermode: "closest" as const,
    ...PAPER_STYLE,
  };
  return (
    <Box w="100%">
      <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: PLOT_HEIGHT }} useResizeHandler />
    </Box>
  );
}

function SexBiasedChart({ data }: { data: SexBiasedGenes }) {
  const traces: any[] = [
    {
      type: "bar",
      x: data.stages,
      y: data.female,
      name: "Female higher",
      marker: { color: "#E64980" },
      hovertemplate: "Female higher<br>%{x}: %{y}<extra></extra>",
    },
    {
      type: "bar",
      x: data.stages,
      y: data.male,
      name: "Male higher",
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
    hovermode: "closest" as const,
    ...PAPER_STYLE,
  };
  return (
    <Box w="100%">
      <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: PLOT_HEIGHT }} useResizeHandler />
    </Box>
  );
}

function FemaleMaleScatterChart({ data }: { data: FemaleMaleScatter }) {
  const colors = data.genes.map(g =>
    g.sex_bias_label === "Female_higher" ? "#E64980" :
    g.sex_bias_label === "Male_higher"   ? "#228BE6" : "#adb5bd"
  );
  const traces: any[] = [{
    type: "scatter",
    mode: "markers",
    x: data.genes.map(g => g.female_mean),
    y: data.genes.map(g => g.male_mean),
    text: data.genes.map(g => `${g.gene_id}<br>F=${g.female_mean.toFixed(2)} M=${g.male_mean.toFixed(2)}`),
    hovertemplate: "%{text}<extra></extra>",
    marker: { color: colors, size: 5, opacity: 0.6 },
  }];
  const maxVal = Math.max(
    ...data.genes.flatMap(g => [g.female_mean, g.male_mean]),
    1
  );
  const layout: any = {
    margin: { t: 8, b: 48, l: 56, r: 16 },
    xaxis: { title: { text: "Female Mean (log₂)", font: { size: 10 } }, gridcolor: "#f0f0f0", tickfont: { size: 9 }, range: [0, maxVal * 1.1] },
    yaxis: { title: { text: "Male Mean (log₂)", font: { size: 10 } }, gridcolor: "#f0f0f0", tickfont: { size: 9 }, range: [0, maxVal * 1.1] },
    shapes: [{ type: "line", x0: 0, x1: maxVal, y0: 0, y1: maxVal, line: { color: "#ccc", width: 1, dash: "dash" } }],
    hovermode: "closest" as const,
    ...PAPER_STYLE,
  };
  return (
    <Box w="100%">
      <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: PLOT_HEIGHT }} useResizeHandler />
    </Box>
  );
}

function StageDEGCountChart({ data }: { data: StageDEGCount }) {
  const traces: any[] = [
    {
      type: "bar",
      x: data.stages,
      y: data.up,
      name: "Up-regulated",
      marker: { color: "#40c057" },
      hovertemplate: "Up<br>%{x}: +%{y}<extra></extra>",
    },
    {
      type: "bar",
      x: data.stages,
      y: data.down.map(v => Math.abs(v)),
      name: "Down-regulated",
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
    hovermode: "closest" as const,
    ...PAPER_STYLE,
  };
  return (
    <Box w="100%">
      <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: PLOT_HEIGHT }} useResizeHandler />
    </Box>
  );
}

function Top50HeatmapChart({ data }: { data: Top50Heatmap }) {
  if (!data.zmatrix.length) return <Text size="xs" c="dimmed">No data</Text>;
  const traces: any[] = [{
    type: "heatmap",
    z: data.zmatrix,
    x: data.samples,
    y: data.genes,
    colorscale: "RdBu",
    zsmooth: "best",
    hovertemplate: "%{y}<br>%{x}<br>Z: %{z:.2f}<extra></extra>",
  }];
  const layout: any = {
    margin: { t: 8, b: 80, l: 120, r: 16 },
    xaxis: { tickangle: -45, tickfont: { size: 7 }, gridcolor: "transparent" },
    yaxis: { tickfont: { size: 7 }, gridcolor: "transparent" },
    hovermode: "closest" as const,
    ...PAPER_STYLE,
  };
  return (
    <Box w="100%">
      <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: 280 }} useResizeHandler />
    </Box>
  );
}

function PCAChart({ data }: { data: PCA }) {
  const stageColors: Record<string, string> = {
    "E0": "#8B5CF6", "E3.5": "#7C3AED", "E7": "#6366F1", "E11": "#3B82F6",
    "E14": "#0EA5E9", "E18.5": "#06B6D4", "P0": "#10B981", "Adult": "#F59E0B",
  };
  const traces: any[] = [];
  // Group by stage
  const byStage: Record<string, number[]> = {};
  for (let i = 0; i < data.pc1.length; i++) {
    const s = data.samples[i].stage;
    if (!byStage[s]) byStage[s] = [];
    byStage[s].push(i);
  }
  for (const [stage, indices] of Object.entries(byStage)) {
    traces.push({
      type: "scatter",
      mode: "markers",
      x: indices.map(i => data.pc1[i]),
      y: indices.map(i => data.pc2[i]),
      name: stage,
      text: indices.map(i => data.samples[i].sample_name),
      marker: { color: stageColors[stage] || "#868e96", size: 7, opacity: 0.8 },
      hovertemplate: "%{text}<br>PC1: %{x:.3f}<br>PC2: %{y:.3f}<extra>%{data.name}</extra>",
    });
  }
  const layout: any = {
    margin: { t: 8, b: 48, l: 56, r: 16 },
    xaxis: { title: { text: `PC1 (${(data.explained_variance_ratio[0] * 100).toFixed(1)}%)`, font: { size: 9 } }, gridcolor: "#f0f0f0", tickfont: { size: 9 } },
    yaxis: { title: { text: "PC2", font: { size: 9 } }, gridcolor: "#f0f0f0", tickfont: { size: 9 } },
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.24, font: { size: 8 }, itemsizing: "constant" as const },
    hovermode: "closest" as const,
    ...PAPER_STYLE,
  };
  return (
    <Box w="100%">
      <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: PLOT_HEIGHT }} useResizeHandler />
    </Box>
  );
}

function ExpressionDistChart({ data }: { data: ExpressionDistribution }) {
  const traces: any[] = [
    {
      type: "scatter",
      mode: "lines+markers",
      x: data.stages,
      y: data.q1,
      name: "Q1",
      line: { color: "#93C5FD", width: 1, dash: "dot" },
      marker: { size: 4, color: "#93C5FD" },
      hovertemplate: "Q1 %{x}: %{y:.2f}<extra></extra>",
    },
    {
      type: "scatter",
      mode: "lines+markers",
      x: data.stages,
      y: data.median,
      name: "Median",
      line: { color: "#228BE6", width: 2 },
      marker: { size: 5, color: "#228BE6" },
      hovertemplate: "Median %{x}: %{y:.2f}<extra></extra>",
    },
    {
      type: "scatter",
      mode: "lines+markers",
      x: data.stages,
      y: data.q3,
      name: "Q3",
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
    hovermode: "closest" as const,
    ...PAPER_STYLE,
  };
  return (
    <Box w="100%">
      <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: PLOT_HEIGHT }} useResizeHandler />
    </Box>
  );
}

function TrajectoryClustersChart({ data }: { data: TrajectoryClusters }) {
  const clusterColors = ["#8B5CF6", "#F59E0B", "#10B981", "#E64980"];
  const traces: any[] = data.centroids.map((centroid, i) => ({
    type: "scatter",
    mode: "lines+markers",
    x: data.stages,
    y: centroid,
    name: `Cluster ${i + 1}`,
    line: { color: clusterColors[i % clusterColors.length], width: 2 },
    marker: { color: clusterColors[i % clusterColors.length], size: 5, symbol: "circle" },
    hovertemplate: `Cluster ${i + 1}<br>%{x}: %{y:.3f}<extra></extra>`,
  }));
  const layout: any = {
    margin: { t: 8, b: 48, l: 56, r: 16 },
    xaxis: { tickangle: -30, gridcolor: "#f0f0f0", tickfont: { size: 9 } },
    yaxis: { title: { text: "Mean Expression", font: { size: 9 } }, gridcolor: "#f0f0f0", tickfont: { size: 9 } },
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.28, font: { size: 9 } },
    hovermode: "closest" as const,
    ...PAPER_STYLE,
  };
  return (
    <Box w="100%">
      <Plot data={traces} layout={layout} config={PLOT_CONFIG} style={{ width: "100%", height: PLOT_HEIGHT }} useResizeHandler />
    </Box>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EscOverviewSection() {
  const [sampleComp, setSampleComp]           = useState<SampleComposition | null>(null);
  const [sexBiased, setSexBiased]             = useState<SexBiasedGenes | null>(null);
  const [fmScatter, setFmScatter]           = useState<FemaleMaleScatter | null>(null);
  const [degCount, setDegCount]              = useState<StageDEGCount | null>(null);
  const [top50, setTop50]                    = useState<Top50Heatmap | null>(null);
  const [pca, setPca]                        = useState<PCA | null>(null);
  const [exprDist, setExprDist]              = useState<ExpressionDistribution | null>(null);
  const [trajClusters, setTrajClusters]      = useState<TrajectoryClusters | null>(null);
  const [loading, setLoading]                = useState(true);

  useEffect(() => {
    Promise.all([
      getSampleComposition().then(r => setSampleComp(r)),
      getSexBiasedGenes().then(r => setSexBiased(r)),
      getFemaleMaleScatter().then(r => setFmScatter(r)),
      getStageDEGCount().then(r => setDegCount(r)),
      getTop50Heatmap().then(r => setTop50(r)),
      getPCA().then(r => setPca(r)),
      getExpressionDistribution().then(r => setExprDist(r)),
      getTrajectoryClusters().then(r => setTrajClusters(r)),
    ]).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <MiniLoader />;

  return (
    <Stack gap="lg">
      {/* Header */}
      <Stack gap={2}>
        <Title order={3}>🧬 ESC Gene Expression Atlas</Title>
        <Text size="sm" c="dimmed">
          GRCg6a chicken embryonic development — global overview across all genes and samples
        </Text>
      </Stack>

      {/* Row 1: Sample Composition + Expression Distribution */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <ChartCard title="Sample Composition" subtitle="Samples per stage × sex (n=36)">
          {sampleComp ? <SampleCompositionChart data={sampleComp} /> : <MiniLoader />}
        </ChartCard>
        <ChartCard title="Expression Distribution" subtitle="Per-stage gene mean quartiles">
          {exprDist ? <ExpressionDistChart data={exprDist} /> : <MiniLoader />}
        </ChartCard>
      </SimpleGrid>

      {/* Row 2: Sex-Biased Genes + Female vs Male Scatter */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <ChartCard title="Sex-Biased Genes" subtitle="Female-higher / Male-higher per stage">
          {sexBiased ? <SexBiasedChart data={sexBiased} /> : <MiniLoader />}
        </ChartCard>
        <ChartCard title="Female vs Male Mean Expression" subtitle="All genes, colored by sex bias">
          {fmScatter ? <FemaleMaleScatterChart data={fmScatter} /> : <MiniLoader />}
        </ChartCard>
      </SimpleGrid>

      {/* Row 3: Stage DEG Count + PCA */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <ChartCard title="DEG Count by Stage Transition" subtitle="Up-regulated / Down-regulated genes per stage">
          {degCount ? <StageDEGCountChart data={degCount} /> : <MiniLoader />}
        </ChartCard>
        <ChartCard title="Sample PCA — PC1 vs PC2" subtitle="Samples projected onto principal components">
          {pca ? <PCAChart data={pca} /> : <MiniLoader />}
        </ChartCard>
      </SimpleGrid>

      {/* Row 4: Top50 Heatmap + Trajectory Clusters */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <ChartCard title="Top 50 DEG Heatmap" subtitle="Most variable genes × 36 samples (Z-score)">
          {top50 ? <Top50HeatmapChart data={top50} /> : <MiniLoader />}
        </ChartCard>
        <ChartCard title="Gene Expression Trajectory Clusters" subtitle="K-means (k=4) on stage-wise expression profiles">
          {trajClusters ? <TrajectoryClustersChart data={trajClusters} /> : <MiniLoader />}
        </ChartCard>
      </SimpleGrid>
    </Stack>
  );
}