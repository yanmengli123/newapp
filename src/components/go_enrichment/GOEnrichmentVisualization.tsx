import { useMemo, useState } from "react";
import {
  ActionIcon,
  Group,
  NumberInput,
  SegmentedControl,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconMaximize } from "@tabler/icons-react";
import GOEnrichmentFacetGrid from "./GOEnrichmentFacetGrid";
import GOEnrichmentChartFullscreen from "./GOEnrichmentChartFullscreen";
import { BarChartFilters } from "./GOEnrichmentPageFilters";
import type { BarValue } from "./GOEnrichmentBarplotPanel";
import type { GOEnrichmentResult } from "../../lib/goEnrichmentApi";
import {
  getTopTerms,
  globalMaxNegLog10Fdr,
  countAvailableTerms,
} from "./goEnrichmentChartUtils";

interface Props {
  results: GOEnrichmentResult[];
  ontologyFilter: { P: boolean; C: boolean; F: boolean };
  onOntologyFilterChange: (f: { P: boolean; C: boolean; F: boolean }) => void;
  onTermClick: (term: GOEnrichmentResult) => void;
}

export default function GOEnrichmentVisualization({
  results,
  ontologyFilter,
  onOntologyFilterChange,
  onTermClick,
}: Props) {
  const [chartMode, setChartMode] = useState<"dotplot" | "barplot">("dotplot");
  const [topN, setTopN] = useState<number>(15);
  const [barValue, setBarValue] = useState<BarValue>("count");
  const [significantOnly, setSignificantOnly] = useState(true);
  const [fullscreenOpened, setFullscreenOpened] = useState(false);

  // Available term counts per ontology (for display hint)
  const availableCounts = useMemo(() => ({
    P: countAvailableTerms(results, "P", significantOnly),
    C: countAvailableTerms(results, "C", significantOnly),
    F: countAvailableTerms(results, "F", significantOnly),
  }), [results, significantOnly]);

  const facetData = useMemo(
    () => ({
      P: getTopTerms(results, "P", topN, significantOnly),
      C: getTopTerms(results, "C", topN, significantOnly),
      F: getTopTerms(results, "F", topN, significantOnly),
    }),
    [results, topN, significantOnly],
  );

  const maxNegLog10Fdr = useMemo(
    () => globalMaxNegLog10Fdr(results, significantOnly),
    [results, significantOnly],
  );

  const anyOntologyOn = ontologyFilter.P || ontologyFilter.C || ontologyFilter.F;
  const visibleTotalTerms =
    (ontologyFilter.P ? facetData.P.length : 0) +
    (ontologyFilter.C ? facetData.C.length : 0) +
    (ontologyFilter.F ? facetData.F.length : 0);

  // Hint: show available counts for selected ontologies
  const hintParts: string[] = [];
  if (ontologyFilter.P) hintParts.push(`BP: ${availableCounts.P}`);
  if (ontologyFilter.C) hintParts.push(`CC: ${availableCounts.C}`);
  if (ontologyFilter.F) hintParts.push(`MF: ${availableCounts.F}`);
  const hint = hintParts.join(" | ");

  return (
    <>
      {/* Control bar */}
      <Group justify="space-between" mb="md" wrap="wrap" gap="sm">
        <Group gap="md" align="flex-end">
          <SegmentedControl
            data={[
              { value: "dotplot", label: "Dotplot" },
              { value: "barplot", label: "Barplot" },
            ]}
            value={chartMode}
            onChange={(v) => setChartMode(v as "dotplot" | "barplot")}
            size="sm"
          />

          <NumberInput
            label="Terms per ontology"
            value={topN}
            onChange={(v) => {
              if (v === "" || v === undefined) return;
              const n = Number(v);
              if (Number.isFinite(n) && n >= 0) setTopN(Math.round(n));
            }}
            min={0}
            w={130}
            size="sm"
            placeholder="0 = all"
            description={topN === 0 ? "Showing all" : `Top ${topN}`}
          />

          {chartMode === "barplot" && (
            <SegmentedControl
              data={[
                { value: "count", label: "Count" },
                { value: "ratio", label: "Ratio" },
                { value: "fdr", label: "-log10(FDR)" },
              ]}
              value={barValue}
              onChange={(v) => setBarValue(v as BarValue)}
              size="xs"
            />
          )}

          <Switch
            label="Significant only"
            checked={significantOnly}
            onChange={(e) => setSignificantOnly(e.currentTarget.checked)}
            size="sm"
          />
        </Group>

        <Group gap="xs" align="center">
          <BarChartFilters filter={ontologyFilter} onChange={onOntologyFilterChange} />
          <Tooltip label="Fullscreen & Export">
            <ActionIcon
              variant="light"
              color="gray"
              size="lg"
              onClick={() => setFullscreenOpened(true)}
            >
              <IconMaximize size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* Available terms hint */}
      {hint && (
        <Text size="xs" c="dimmed" mb="xs">
          Available terms — {hint}
        </Text>
      )}

      {/* Legends */}
      <Group gap="lg" mb="sm" wrap="wrap">
        {/* Color legend */}
        <Group gap={6}>
          <Text size="xs" c="dimmed">Color:</Text>
          <svg width={80} height={10} style={{ verticalAlign: "middle" }}>
            <defs>
              <linearGradient id="sigGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#fee08b" />
                <stop offset="33%" stopColor="#66c2a5" />
                <stop offset="66%" stopColor="#3288bd" />
                <stop offset="100%" stopColor="#253494" />
              </linearGradient>
            </defs>
            <rect x={0} y={0} width={80} height={10} rx={2} fill="url(#sigGrad)" />
          </svg>
          <Text size="xs" c="dimmed">Higher -log10(FDR) = more significant</Text>
        </Group>
        {/* Size legend (Dotplot only) */}
        {chartMode === "dotplot" && (
          <Group gap={6} align="center">
            <Text size="xs" c="dimmed">Size:</Text>
            <svg width={60} height={16} style={{ verticalAlign: "middle" }}>
              <circle cx={8} cy={8} r={4} fill="#999" opacity={0.5} />
              <circle cx={26} cy={8} r={7} fill="#999" opacity={0.5} />
              <circle cx={48} cy={6} r={10} fill="#999" opacity={0.5} />
            </svg>
            <Text size="xs" c="dimmed">Hit gene count</Text>
          </Group>
        )}
      </Group>

      {/* Facet grid */}
      {!anyOntologyOn ? (
        <Text c="dimmed" ta="center" py="xl">
          No ontology selected. Enable BP, CC, or MF above.
        </Text>
      ) : visibleTotalTerms > 0 ? (
        <GOEnrichmentFacetGrid
          mode={chartMode}
          facetData={facetData}
          maxNegLog10Fdr={maxNegLog10Fdr}
          barValue={barValue}
          ontologyFilter={ontologyFilter}
          onTermClick={onTermClick}
        />
      ) : (
        <Text c="dimmed" ta="center" py="xl">
          No terms to display. Adjust filters or run a new analysis.
        </Text>
      )}

      {/* Fullscreen modal */}
      <GOEnrichmentChartFullscreen
        opened={fullscreenOpened}
        onClose={() => setFullscreenOpened(false)}
        results={results}
        ontologyFilter={ontologyFilter}
        onOntologyFilterChange={onOntologyFilterChange}
        onTermClick={onTermClick}
      />
    </>
  );
}
