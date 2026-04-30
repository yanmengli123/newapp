import { Box } from "@mantine/core";
import GOEnrichmentDotplotPanel from "./GOEnrichmentDotplotPanel";
import GOEnrichmentBarplotPanel, { type BarValue } from "./GOEnrichmentBarplotPanel";
import type { ChartTerm } from "./goEnrichmentChartUtils";
import type { GOEnrichmentResult } from "../../lib/goEnrichmentApi";

interface FacetData {
  P: ChartTerm[];
  C: ChartTerm[];
  F: ChartTerm[];
}

interface Props {
  mode: "dotplot" | "barplot";
  facetData: FacetData;
  maxNegLog10Fdr: number;
  barValue: BarValue;
  ontologyFilter: { P: boolean; C: boolean; F: boolean };
  onTermClick: (term: GOEnrichmentResult) => void;
}

const ALL_ONTOLOGIES: Array<"P" | "C" | "F"> = ["P", "C", "F"];

function computeFlexRatios(
  visible: Array<"P" | "C" | "F">,
  facetData: FacetData,
): Record<string, number> {
  const counts = visible.map((o) => Math.max(facetData[o].length, 1));
  const total = counts.reduce((a, b) => a + b, 0);
  const result: Record<string, number> = {};
  visible.forEach((o, i) => {
    result[o] = counts[i] / total;
  });
  return result;
}

export default function GOEnrichmentFacetGrid({
  mode,
  facetData,
  maxNegLog10Fdr,
  barValue,
  ontologyFilter,
  onTermClick,
}: Props) {
  const visible = ALL_ONTOLOGIES.filter((o) => ontologyFilter[o]);
  const ratios = computeFlexRatios(visible, facetData);

  return (
    <Box style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
      {visible.map((ont) => (
        <Box
          key={ont}
          style={{
            flex: `${ratios[ont]} 1 280px`,
            minWidth: 0,
          }}
        >
          {mode === "dotplot" ? (
            <GOEnrichmentDotplotPanel
              ontology={ont}
              terms={facetData[ont]}
              maxNegLog10Fdr={maxNegLog10Fdr}
              onTermClick={onTermClick}
            />
          ) : (
            <GOEnrichmentBarplotPanel
              ontology={ont}
              terms={facetData[ont]}
              maxNegLog10Fdr={maxNegLog10Fdr}
              barValue={barValue}
              onTermClick={onTermClick}
            />
          )}
        </Box>
      ))}
    </Box>
  );
}
