import { SimpleGrid } from "@mantine/core";
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

export default function GOEnrichmentFacetGrid({
  mode,
  facetData,
  maxNegLog10Fdr,
  barValue,
  ontologyFilter,
  onTermClick,
}: Props) {
  const ontologies: Array<"P" | "C" | "F"> = ["P", "C", "F"];

  return (
    <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
      {ontologies.map(
        (ont) =>
          ontologyFilter[ont] &&
          (mode === "dotplot" ? (
            <GOEnrichmentDotplotPanel
              key={ont}
              ontology={ont}
              terms={facetData[ont]}
              maxNegLog10Fdr={maxNegLog10Fdr}
              onTermClick={onTermClick}
            />
          ) : (
            <GOEnrichmentBarplotPanel
              key={ont}
              ontology={ont}
              terms={facetData[ont]}
              maxNegLog10Fdr={maxNegLog10Fdr}
              barValue={barValue}
              onTermClick={onTermClick}
            />
          ))
      )}
    </SimpleGrid>
  );
}
