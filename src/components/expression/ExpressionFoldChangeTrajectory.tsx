/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Paper, Stack, Text } from "@mantine/core";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { ExpressionSample } from "../../lib/geneApi";
import {
  groupSamplesByStageSex, sortStages, isValidNumber,
  getDatasetDisplayName, PLOT_CONFIG, PAPER_STYLE,
} from "./utils";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionFoldChangeTrajectoryProps {
  samples: ExpressionSample[];
  dataset: string;
}

export default function ExpressionFoldChangeTrajectory({ samples, dataset }: ExpressionFoldChangeTrajectoryProps) {
  const grouped = groupSamplesByStageSex(samples);
  const stages = sortStages(Object.keys(grouped));

  // Compute mean value per stage per sex
  const means: { stage: string; male: number; female: number; maleCount: number; femaleCount: number }[] = [];
  for (const stage of stages) {
    const maleVals = grouped[stage].male;
    const femaleVals = grouped[stage].female;
    const maleMean = maleVals.length > 0 ? maleVals.reduce((a, b) => a + b, 0) / maleVals.length : 0;
    const femaleMean = femaleVals.length > 0 ? femaleVals.reduce((a, b) => a + b, 0) / femaleVals.length : 0;
    if (maleVals.length > 0 || femaleVals.length > 0) {
      means.push({ stage, male: maleMean, female: femaleMean, maleCount: maleVals.length, femaleCount: femaleVals.length });
    }
  }

  if (means.length < 2) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Fold Change Trajectory: need ≥2 stages</Text>
      </Paper>
    );
  }

  // Compute log2FC between adjacent stages (current / previous, skipping zero/invalid)
  const labels: string[] = [];
  const maleFc: (number | null)[] = [];
  const femaleFc: (number | null)[] = [];

  for (let i = 1; i < means.length; i++) {
    const curr = means[i];
    const prev = means[i - 1];

    labels.push(`${prev.stage} → ${curr.stage}`);

    // Male FC
    if (prev.male > 0 && curr.male > 0) {
      maleFc.push(Math.log2(curr.male / prev.male));
    } else {
      maleFc.push(null);
    }

    // Female FC
    if (prev.female > 0 && curr.female > 0) {
      femaleFc.push(Math.log2(curr.female / prev.female));
    } else {
      femaleFc.push(null);
    }
  }

  const validMale = maleFc.filter(isValidNumber);
  const validFemale = femaleFc.filter(isValidNumber);

  if (validMale.length === 0 && validFemale.length === 0) {
    return (
      <Paper withBorder p="md" radius="md">
        <Text size="xs" c="dimmed">Fold Change Trajectory: insufficient non-zero values</Text>
      </Paper>
    );
  }

  const traces: any[] = [];

  if (validMale.length > 0) {
    traces.push({
      type: "bar",
      x: labels,
      y: maleFc,
      name: "Male",
      marker: {
        color: maleFc.map(v => v != null ? (v > 0 ? "#228BE6" : "#4dabf7") : "#ccc"),
      },
      text: maleFc.map(v => v != null ? `log2FC: ${v.toFixed(3)}` : "N/A"),
      hovertemplate: "%{text}<extra>Male</extra>",
      showlegend: true,
    });
  }

  if (validFemale.length > 0) {
    traces.push({
      type: "bar",
      x: labels,
      y: femaleFc,
      name: "Female",
      marker: {
        color: femaleFc.map(v => v != null ? (v > 0 ? "#E64980" : "#f783ac") : "#ccc"),
      },
      text: femaleFc.map(v => v != null ? `log2FC: ${v.toFixed(3)}` : "N/A"),
      hovertemplate: "%{text}<extra>Female</extra>",
      showlegend: true,
    });
  }

  const layout: any = {
    margin: { t: 8, b: 56, l: 56, r: 16 },
    xaxis: {
      tickangle: -30,
      tickfont: { size: 8 },
      gridcolor: "#f8f8f8",
    },
    yaxis: {
      title: { text: "log₂ Fold Change", font: { size: 10 } },
      gridcolor: "#f0f0f0",
      tickfont: { size: 9 },
      zeroline: true,
      zerolinecolor: "#ccc",
      zerolinewidth: 1,
    },
    legend: {
      orientation: "h" as const,
      x: 0.5, xanchor: "center" as const,
      y: -0.28,
      font: { size: 9 },
    },
    font: { family: "sans-serif", size: 10 },
    barmode: "group",
    hovermode: "closest" as const,
    ...PAPER_STYLE,
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          Fold Change Trajectory — {getDatasetDisplayName(dataset)}
        </Text>
        <Box w="100%">
          <Plot
            data={traces}
            layout={layout}
            config={PLOT_CONFIG}
            style={{ width: "100%", height: 200 }}
            useResizeHandler
          />
        </Box>
      </Stack>
    </Paper>
  );
}