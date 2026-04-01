import { Box, Paper, Stack, Text } from "@mantine/core";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { ExpressionSample } from "../../lib/geneApi";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionLineChartProps {
  samples: ExpressionSample[];
  dataset: string;
  metric: string;
}

// Sort samples by stage_order, then sex, then replicate
type StageOrderMap = { [key: string]: number };
const STAGE_ORDER: StageOrderMap = {
  E0: 1, "E3.5": 2, E7: 3, "E11": 4, "E14": 5, "E18.5": 6, P0: 7, Adult: 8,
};

function sortSamples(samples: ExpressionSample[]): ExpressionSample[] {
  return [...samples].sort((a, b) => {
    const sa = a.stage_order ?? STAGE_ORDER[a.stage] ?? 99;
    const sb = b.stage_order ?? STAGE_ORDER[b.stage] ?? 99;
    if (sa !== sb) return sa - sb;
    const sexA = a.sex === "Male" ? 0 : 1;
    const sexB = b.sex === "Male" ? 0 : 1;
    if (sexA !== sexB) return sexA - sexB;
    return (a.replicate ?? 0) - (b.replicate ?? 0);
  });
}

function buildXLabels(samples: ExpressionSample[]): string[] {
  return samples.map((s) => {
    const rep = s.replicate != null ? `R${s.replicate}` : "";
    const sex = s.sex === "Male" ? "M" : s.sex === "Female" ? "F" : "?";
    return `${s.stage}${rep !== "" ? `(${sex}${rep})` : ""}`;
  });
}

export default function ExpressionLineChart({
  samples,
  dataset,
  metric,
}: ExpressionLineChartProps) {
  const sorted = sortSamples(samples);
  const xLabels = buildXLabels(sorted);
  const values = sorted.map((s) => s.value);

  const maleIdx = sorted.map((s, i) => (s.sex === "Male" ? i : -1)).filter((i) => i >= 0);
  const femaleIdx = sorted.map((s, i) => (s.sex === "Female" ? i : -1)).filter((i) => i >= 0);

  // Build traces - "All Samples" trace is weakened (dashed, thin, dim) to make Male/Female stand out
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const traces: any[] = [
    {
      x: xLabels,
      y: values,
      type: "scatter",
      mode: "lines+markers",
      name: "All Samples",
      line: { color: "#7950F2", width: 0.8, dash: "dot" },
      marker: { color: "#7950F2", size: 4, opacity: 0.45 },
      text: sorted.map((s) => `${s.sample_name ?? s.stage}\n${s.value.toFixed(3)}`),
      hoverinfo: "text+x",
    },
  ];

  // Add separate male/female traces if we have both
  if (maleIdx.length > 0 && femaleIdx.length > 0) {
    traces.push({
      x: maleIdx.map((i) => xLabels[i]),
      y: maleIdx.map((i) => values[i]),
      type: "scatter",
      mode: "lines+markers",
      name: "Male",
      line: { color: "#228BE6", width: 2 },
      marker: { color: "#228BE6", size: 6 },
      text: maleIdx.map((i) => `${sorted[i].sample_name}: ${values[i].toFixed(3)}`),
      hoverinfo: "text+x",
    });
    traces.push({
      x: femaleIdx.map((i) => xLabels[i]),
      y: femaleIdx.map((i) => values[i]),
      type: "scatter",
      mode: "lines+markers",
      name: "Female",
      line: { color: "#E64980", width: 2 },
      marker: { color: "#E64980", size: 6 },
      text: femaleIdx.map((i) => `${sorted[i].sample_name}: ${values[i].toFixed(3)}`),
      hoverinfo: "text+x",
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layout: any = {
    margin: { t: 8, b: 52, l: 56, r: 16 },
    xaxis: {
      tickangle: -40,
      tickfont: { size: 8 },
      gridcolor: "#f8f8f8",
      showgrid: true,
      dtick: 1,
    },
    yaxis: {
      title: { text: metric === "tpm" || metric === "fpkm" ? metric.toUpperCase() : "Normalized Count", font: { size: 10 } },
      gridcolor: "#f0f0f0",
      tickfont: { size: 9 },
      zeroline: false,
    },
    legend: {
      orientation: "h" as const,
      x: 0.5,
      xanchor: "center" as const,
      y: -0.26,
      font: { size: 9 },
    },
    font: { family: "sans-serif", size: 10 },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    showlegend: true,
    hovermode: "closest" as const,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config: any = {
    displayModeBar: false,
    responsive: true,
    locale: "en",
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          Expression Profile — {dataset}
        </Text>
        <Box w="100%">
          <Plot
            data={traces}
            layout={layout}
            config={config}
            style={{ width: "100%", height: 220 }}
            useResizeHandler
          />
        </Box>
      </Stack>
    </Paper>
  );
}
