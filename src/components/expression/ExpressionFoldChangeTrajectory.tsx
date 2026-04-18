/* eslint-disable @typescript-eslint/no-explicit-any */
import { ActionIcon, Box, Group, Paper, Stack, Text } from "@mantine/core";
import { IconMaximize } from "@tabler/icons-react";
import * as PlotlyModule from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { ExpressionSample } from "../../lib/geneApi";
import type { ResolvedChartStyle } from "./chartCustomizer.types";
import {
  groupSamplesByStageSex, sortStages, isValidNumber,
  getDatasetDisplayName, PLOT_CONFIG, PAPER_STYLE,
} from "./utils";

const Plot = createPlotlyComponent(PlotlyModule);

interface ExpressionFoldChangeTrajectoryProps {
  samples: ExpressionSample[];
  dataset: string;
  styleConfig?: ResolvedChartStyle;
  renderMode?: "card" | "fullscreen";
  onOpenFullscreen?: () => void;
}

export default function ExpressionFoldChangeTrajectory({ samples, dataset, styleConfig, renderMode, onOpenFullscreen }: ExpressionFoldChangeTrajectoryProps) {
  const fontSize = styleConfig?.fontSize ?? 10;
  const chartHeight = styleConfig?.chartHeight ?? 200;
  const showLegend = styleConfig?.showLegend ?? true;
  const showGrid = styleConfig?.showGrid ?? true;
  const showValueLabel = styleConfig?.chartSpecific?.showValueLabel ?? true;
  const barWidth = styleConfig?.chartSpecific?.barWidth ?? 0.6;
  const maleColor = styleConfig?.colors?.male ?? "#228BE6";
  const femaleColor = styleConfig?.colors?.female ?? "#E64980";
  const gridColor = styleConfig?.colors?.grid ?? "#f0f0f0";
  const titleOverride = styleConfig?.title;

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
        color: maleFc.map(v => v != null ? (v > 0 ? maleColor : maleColor + "99") : "#ccc"),
        width: barWidth,
      },
      text: showValueLabel ? maleFc.map(v => v != null ? `log2FC: ${v.toFixed(3)}` : "N/A") : undefined,
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
        color: femaleFc.map(v => v != null ? (v > 0 ? femaleColor : femaleColor + "99") : "#ccc"),
        width: barWidth,
      },
      text: showValueLabel ? femaleFc.map(v => v != null ? `log2FC: ${v.toFixed(3)}` : "N/A") : undefined,
      hovertemplate: "%{text}<extra>Female</extra>",
      showlegend: true,
    });
  }

  const layout: any = {
    margin: { t: 8, b: 56, l: 56, r: 16 },
    xaxis: {
      tickangle: -30,
      tickfont: { size: fontSize - 2 },
      gridcolor: "transparent",
    },
    yaxis: {
      title: { text: "log₂ Fold Change", font: { size: fontSize } },
      gridcolor: showGrid ? gridColor : "transparent",
      tickfont: { size: fontSize - 1 },
      zeroline: true,
      zerolinecolor: "#ccc",
      zerolinewidth: 1,
    },
    legend: {
      orientation: "h" as const,
      x: 0.5, xanchor: "center" as const,
      y: -0.28,
      font: { size: fontSize - 1 },
    },
    font: { family: "sans-serif", size: fontSize },
    barmode: "group",
    hovermode: "closest" as const,
    showlegend: showLegend,
    ...PAPER_STYLE,
  };

  const plotConfig = renderMode === "fullscreen"
    ? { displayModeBar: true, responsive: true, locale: "en" }
    : PLOT_CONFIG;

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Text size="xs" fw={600} c="dimmed">
            {titleOverride ?? `Fold Change Trajectory — ${getDatasetDisplayName(dataset)}`}
          </Text>
          {renderMode !== "fullscreen" && onOpenFullscreen && (
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={onOpenFullscreen}>
              <IconMaximize size={14} />
            </ActionIcon>
          )}
        </Group>
        <Box w="100%">
          <Plot
            data={traces}
            layout={layout}
            config={plotConfig}
            style={{ width: "100%", height: chartHeight }}
            useResizeHandler
          />
        </Box>
      </Stack>
    </Paper>
  );
}