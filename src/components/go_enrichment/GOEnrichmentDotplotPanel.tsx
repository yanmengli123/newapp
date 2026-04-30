/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Text } from "@mantine/core";
import ReactECharts from "echarts-for-react";
import type { ChartTerm } from "./goEnrichmentChartUtils";
import {
  ONTOLOGY_META,
  SIG_COLOR_RANGE,
  panelHeight,
  buildTooltipHtml,
  truncateLabel,
} from "./goEnrichmentChartUtils";
import type { GOEnrichmentResult } from "../../lib/goEnrichmentApi";

interface Props {
  ontology: "P" | "C" | "F";
  terms: ChartTerm[];
  maxNegLog10Fdr: number;
  onTermClick: (term: GOEnrichmentResult) => void;
}

export default function GOEnrichmentDotplotPanel({
  ontology,
  terms,
  maxNegLog10Fdr,
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
      right: 40,
      top: 40,
      bottom: 30,
      containLabel: true,
    },
    xAxis: {
      type: "value",
      name: "Gene Ratio",
      nameLocation: "center",
      nameGap: 28,
      nameTextStyle: { fontSize: 11, color: "#555" },
      axisLabel: {
        fontSize: 10,
        formatter: (v: number) => v.toFixed(2),
      },
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
    visualMap: {
      show: false,
      type: "continuous",
      min: 0,
      max: maxNegLog10Fdr,
      dimension: 3,
      inRange: { color: SIG_COLOR_RANGE },
    },
    series: [
      {
        type: "scatter",
        symbolSize: (val: any) => Math.max(8, Math.min(30, val[2] * 2.2)),
        data: terms.map((t) => ({
          value: [t.geneRatio, t.name, t.count, t.negLog10Fdr],
          term: t,
        })),
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
      <Text size="xs" c="dimmed" mb={8}>Top {terms.length} terms</Text>
      <ReactECharts
        key={`${ontology}-${terms.length}`}
        option={option}
        style={{ width: "100%", height }}
        onEvents={handleEvents}
        opts={{ renderer: "canvas" }}
        notMerge
      />
    </Box>
  );
}
