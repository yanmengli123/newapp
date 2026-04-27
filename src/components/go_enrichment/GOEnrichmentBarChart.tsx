/* eslint-disable @typescript-eslint/no-explicit-any */
import Plotly from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import { Box, Text } from "@mantine/core";
import type { BarChartEntry } from "../../lib/goEnrichmentApi";

const Plot = createPlotlyComponent(Plotly);

interface Props {
  data: { P: BarChartEntry[]; C: BarChartEntry[]; F: BarChartEntry[] };
  filtered: { P: boolean; C: boolean; F: boolean };
}

const COLORS = {
  P: "#1A8CFF",
  C: "#FF9933",
  F: "#33CC66",
};

export default function GOEnrichmentBarChart({ data, filtered }: Props) {
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
        text: entries.map((e) => `GO:${e.go_id} | Hits: ${e.query_count}/${e.background_count}`),
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
        text: entries.map((e) => `GO:${e.go_id} | Hits: ${e.query_count}/${e.background_count}`),
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
        text: entries.map((e) => `GO:${e.go_id} | Hits: ${e.query_count}/${e.background_count}`),
        hoverinfo: "text+y",
      });
    }
  }

  const allEntries = [...(filtered.P ? data.P : []), ...(filtered.C ? data.C : []), ...(filtered.F ? data.F : [])];
  const totalEntries = allEntries.filter((e, i, arr) => arr.findIndex(a => a.go_id === e.go_id) === i).length;

  if (traces.length === 0) {
    return (
      <Box py="xl" ta="center">
        <Text c="dimmed" size="sm">No data to display. Adjust filters or run a new analysis.</Text>
      </Box>
    );
  }

  return (
    <Box style={{ width: "100%", height: Math.min(500, totalEntries * 28 + 80) }}>
      <Plot
        data={traces}
        layout={{
          barmode: "group",
          margin: { l: 350, r: 50, t: 20, b: 60 },
          xaxis: { title: "-log10(FDR)", tickangle: -30 },
          yaxis: { title: "", automargin: true, tickangle: -30, tickfont: { size: 11 } },
          font: { size: 11 },
          showlegend: true,
          legend: { orientation: "h", x: 0, y: -0.15 },
          paper_bgcolor: "white",
          plot_bgcolor: "white",
          bargap: 0.2,
          bargroupgap: 0.1,
        }}
        config={{
          responsive: true,
          displayModeBar: true,
          displaylogo: false,
          modeBarButtonsToRemove: ["lasso2d", "select2d"],
        }}
        style={{ width: "100%", height: "100%" }}
        useResizeHandler
      />
    </Box>
  );
}