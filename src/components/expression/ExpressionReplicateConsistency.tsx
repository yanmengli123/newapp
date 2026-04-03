/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Group, Paper, Stack, Text, Table } from "@mantine/core";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { ExpressionSample } from "../../lib/geneApi";
import {
  groupSamplesByStageSex, sortStages, isValidNumber,
  getDatasetDisplayName, PLOT_CONFIG, PAPER_STYLE,
} from "./utils";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionReplicateConsistencyProps {
  samples: ExpressionSample[];
  dataset: string;
}

interface RowData {
  stage: string;
  sex: "Male" | "Female";
  mean: number;
  std: number;
  cv: number;
  n: number;
  values: number[];
}

function calcStats(vals: number[]): { mean: number; std: number; cv: number } {
  if (vals.length === 0) return { mean: 0, std: 0, cv: 0 };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (vals.length === 1) return { mean, std: 0, cv: 0 };
  const variance = vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (vals.length - 1);
  const std = Math.sqrt(variance);
  const cv = mean !== 0 ? Math.abs(std / mean) : 0;
  return { mean, std, cv };
}

export default function ExpressionReplicateConsistency({ samples, dataset }: ExpressionReplicateConsistencyProps) {
  const grouped = groupSamplesByStageSex(samples);
  const stages = sortStages(Object.keys(grouped));

  const rows: RowData[] = [];
  for (const stage of stages) {
    const maleVals = grouped[stage].male.filter(isValidNumber);
    const femaleVals = grouped[stage].female.filter(isValidNumber);

    if (maleVals.length > 0) {
      const { mean, std, cv } = calcStats(maleVals);
      rows.push({ stage, sex: "Male", mean, std, cv, n: maleVals.length, values: maleVals });
    }
    if (femaleVals.length > 0) {
      const { mean, std, cv } = calcStats(femaleVals);
      rows.push({ stage, sex: "Female", mean, std, cv, n: femaleVals.length, values: femaleVals });
    }
  }

  if (rows.length === 0) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Replicate Consistency: no valid data</Text>
      </Paper>
    );
  }


  // Two traces: Mean values bar + CV annotation
  const traces: any[] = [
    {
      type: "bar",
      x: rows.map(r => r.mean),
      y: rows.map(r => `${r.stage} ${r.sex}`),
      orientation: "h" as const,
      name: "Mean",
      marker: { color: rows.map(r => r.sex === "Male" ? "#228BE6" : "#E64980"), opacity: 0.8 },
      text: rows.map(r => `${r.mean.toFixed(2)} ± ${r.std.toFixed(2)}`),
      hovertemplate: "%{y}<br>Mean: %{text}<br>n=%{customdata}<extra>Replicate Consistency</extra>",
      customdata: rows.map(r => r.n),
      showlegend: false,
    },
  ];

  // Also add error bars via a scatter trace for std
  traces.push({
    type: "scatter",
    mode: "markers+text",
    x: rows.map(r => r.std),
    y: rows.map(r => `${r.stage} ${r.sex}`),
    name: "Std Dev",
    marker: {
      color: "transparent",
      size: 1,
      showlegend: false,
    },
    text: rows.map(r => `±${r.std.toFixed(2)}`),
    textposition: "right",
    textfont: { size: 8, color: "#666" },
    showlegend: false,
    hoverinfo: "text",
    hovertemplate: rows.map(r => `SD: ${r.std.toFixed(3)}<br>CV: ${(r.cv * 100).toFixed(1)}%`).join("<br>"),
  });

  const layout: any = {
    margin: { t: 8, b: 8, l: 80, r: 80 },
    xaxis: {
      title: { text: "Expression (Mean)", font: { size: 10 } },
      gridcolor: "#f0f0f0",
      tickfont: { size: 9 },
      zeroline: true,
      zerolinecolor: "#ccc",
    },
    yaxis: {
      tickfont: { size: 9 },
      gridcolor: "#f8f8f8",
      domain: [0, 1],
    },
    showlegend: false,
    hovermode: "closest" as const,
    ...PAPER_STYLE,
    annotations: rows.map((r, i) => ({
      x: r.mean + r.std + 0.5,
      y: i,
      text: `CV:${(r.cv * 100).toFixed(0)}%`,
      font: { size: 8, color: r.cv > 0.3 ? "#e64980" : r.cv > 0.15 ? "#fab005" : "#228be6" },
      showarrow: false,
    })),
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          Replicate Consistency — {getDatasetDisplayName(dataset)}
        </Text>
        <Group align="flex-start" gap="md" wrap="nowrap">
          {/* Mini bar chart */}
          <Box w="55%">
            <Plot
              data={traces}
              layout={layout}
              config={PLOT_CONFIG}
              style={{ width: "100%", height: Math.max(120, rows.length * 28) }}
              useResizeHandler
            />
          </Box>
          {/* Table */}
          <Box w="45%" style={{ overflow: "auto", maxHeight: Math.max(120, rows.length * 28) }}>
            <Table withTableBorder={false} withColumnBorders={false}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th pl={4} pr={4}>Stage</Table.Th>
                  <Table.Th pl={4} pr={4} ta="center">Sex</Table.Th>
                  <Table.Th pl={4} pr={4} ta="right">n</Table.Th>
                  <Table.Th pl={4} pr={4} ta="right">Mean</Table.Th>
                  <Table.Th pl={4} pr={4} ta="right">SD</Table.Th>
                  <Table.Th pl={4} pr={4} ta="right">CV</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r, i) => (
                  <Table.Tr key={i}>
                    <Table.Td pl={4} pr={4} fw={500}>{r.stage}</Table.Td>
                    <Table.Td pl={4} pr={4} ta="center" c={r.sex === "Male" ? "blue" : "pink"}>{r.sex === "Male" ? "♂" : "♀"}</Table.Td>
                    <Table.Td pl={4} pr={4} ta="right" c="dimmed">{r.n}</Table.Td>
                    <Table.Td pl={4} pr={4} ta="right">{r.mean.toFixed(2)}</Table.Td>
                    <Table.Td pl={4} pr={4} ta="right" c="dimmed">{r.std.toFixed(3)}</Table.Td>
                    <Table.Td
                      pl={4} pr={4} ta="right"
                      c={r.cv > 0.3 ? "red" : r.cv > 0.15 ? "yellow" : "teal"}
                      fw={r.cv > 0.3 ? 700 : 400}
                    >
                      {(r.cv * 100).toFixed(1)}%
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        </Group>
      </Stack>
    </Paper>
  );
}