/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Text } from "@mantine/core";
import ReactECharts from "echarts-for-react";
import type { ChartTerm } from "./goEnrichmentChartUtils";
import {
  ONTOLOGY_META,
  panelHeight,
  buildTooltipHtml,
  truncateLabel,
  sigColor,
} from "./goEnrichmentChartUtils";
import type { GOEnrichmentResult } from "../../lib/goEnrichmentApi";

export type BarValue = "count" | "ratio" | "fdr";

interface Props {
  ontology: "P" | "C" | "F";
  terms: ChartTerm[];
  maxNegLog10Fdr: number;
  barValue: BarValue;
  onTermClick: (term: GOEnrichmentResult) => void;
}

function getBarX(t: ChartTerm, barValue: BarValue): number {
  switch (barValue) {
    case "count": return t.count;
    case "ratio": return t.geneRatio;
    case "fdr": return t.negLog10Fdr;
  }
}

function xAxisLabel(barValue: BarValue): string {
  switch (barValue) {
    case "count": return "Gene Count";
    case "ratio": return "Gene Ratio";
    case "fdr": return "-log10(FDR)";
  }
}

function formatBarLabel(val: number, barValue: BarValue): string {
  switch (barValue) {
    case "count": return String(Math.round(val));
    case "ratio": return val.toFixed(3);
    case "fdr": return val.toFixed(1);
  }
}

export default function GOEnrichmentBarplotPanel({
  ontology,
  terms,
  maxNegLog10Fdr,
  barValue,
  onTermClick,
}: Props) {
  const meta = ONTOLOGY_META[ontology];

  if (terms.length === 0) {
    return (
      <Box
        style={{
          height: panelHeight(5),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text c="dimmed" size="sm">No significant {meta.label} terms</Text>
      </Box>
    );
  }

  const height = panelHeight(terms.length);
  const termNames = terms.map((t) => truncateLabel(t.name));

  // When barValue is "fdr", color by ontology to avoid duplicate encoding;
  // otherwise color by significance (FDR).
  const useSigColor = barValue !== "fdr";

  const option: any = {
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (params: any) => {
        const t: ChartTerm = params.data.term;
        return buildTooltipHtml(t);
      },
    },
    grid: {
      left: 16,
      right: 60,
      top: 40,
      bottom: 30,
      containLabel: true,
    },
    xAxis: {
      type: "value",
      name: xAxisLabel(barValue),
      nameLocation: "center",
      nameGap: 28,
      nameTextStyle: { fontSize: 11, color: "#555" },
      axisLabel: { fontSize: 10 },
      splitLine: { lineStyle: { type: "dashed", color: "#eee" } },
    },
    yAxis: {
      type: "category",
      data: termNames,
      axisLabel: {
        fontSize: 10,
        width: 140,
        overflow: "truncate",
        color: "#1f2937",
      },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    series: [
      {
        type: "bar",
        data: terms.map((t) => ({
          value: getBarX(t, barValue),
          term: t,
          itemStyle: {
            color: useSigColor ? sigColor(t.negLog10Fdr, maxNegLog10Fdr) : meta.color,
          },
        })),
        label: {
          show: true,
          position: "right",
          fontSize: 10,
          formatter: (params: any) => formatBarLabel(params.value, barValue),
        },
        barMaxWidth: 24,
        emphasis: {
          itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,0.3)" },
        },
      },
    ],
    dataZoom: [{ type: "inside", yAxisIndex: 0 }],
    animation: true,
    animationDuration: 400,
  };

  const handleEvents = {
    click: (params: any) => {
      if (params.data?.term) {
        onTermClick(params.data.term._original);
      }
    },
  };

  return (
    <Box>
      <Text size="sm" fw={600} mb={4}>{meta.label}</Text>
      <Text size="xs" c="dimmed" mb={8}>{terms.length} terms</Text>
      <ReactECharts
        key={`${ontology}-${terms.length}-${barValue}`}
        option={option}
        style={{ width: "100%", height }}
        onEvents={handleEvents}
        opts={{ renderer: "canvas" }}
        notMerge
      />
    </Box>
  );
}
