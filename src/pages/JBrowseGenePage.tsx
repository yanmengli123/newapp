import { Card, Group, Text, Title, Button, Box } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { useSearchParams } from "react-router-dom";
import {
  createViewState,
  JBrowseLinearGenomeView,
} from "@jbrowse/react-linear-genome-view2";
import { useEffect, useRef } from "react";
import { jbrowseConfig } from "../jbrowseConfig";

// NC_ accession → chr ID mapping (must match GeneStructurePlot)
const NC_TO_CHR: [string, string][] = [
  ["NC_006088.5", "chr1"], ["NC_006089.5", "chr2"], ["NC_006090.5", "chr3"],
  ["NC_006091.5", "chr4"], ["NC_006092.5", "chr5"], ["NC_006093.5", "chr6"],
  ["NC_006094.5", "chr7"], ["NC_006095.5", "chr8"], ["NC_006096.5", "chr9"],
  ["NC_006097.5", "chr10"], ["NC_006098.5", "chr11"], ["NC_006099.5", "chr12"],
  ["NC_006100.5", "chr13"], ["NC_006101.5", "chr14"], ["NC_006102.5", "chr15"],
  ["NC_006103.5", "chr16"], ["NC_006104.5", "chr17"], ["NC_006105.5", "chr18"],
  ["NC_006106.5", "chr19"], ["NC_006107.5", "chr20"], ["NC_006108.5", "chr21"],
  ["NC_006109.5", "chr22"], ["NC_006110.5", "chr23"], ["NC_006111.5", "chr24"],
  ["NC_006112.4", "chr25"], ["NC_006113.5", "chr26"], ["NC_006114.5", "chr27"],
  ["NC_006115.5", "chr28"], ["NC_008465.4", "chr29"], ["NC_028739.2", "chr30"],
  ["NC_028740.2", "chr31"], ["NC_006119.4", "chr32"], ["NC_006126.5", "chrW"],
  ["NC_006127.5", "chrZ"], ["NC_040902.1", "chrMT"],
];

function toChrId(seqid: string): string {
  if (seqid.startsWith("chr")) return seqid;
  return NC_TO_CHR.find(([k]) => k === seqid)?.[1] ?? seqid;
}

function parseLocParam(locParam: string | null): string {
  if (!locParam) return "chr1:1..5000000";
  const match = locParam.match(/^(.+?):(\d+)\.\.(\d+)$/);
  if (!match) return "chr1:1..5000000";
  const [, refName, startStr, endStr] = match;
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);
  if (isNaN(start) || isNaN(end)) return "chr1:1..5000000";
  const chrId = toChrId(refName);
  return `${chrId}:${start}..${end}`;
}

export default function JBrowseGenePage() {
  const [searchParams] = useSearchParams();
  const locParam = searchParams.get("loc");
  const geneSymbol = searchParams.get("geneSymbol");
  const geneLoc = parseLocParam(locParam);

  // Pass exact gene coords to search box (no padding)
  const viewState = createViewState({
    ...jbrowseConfig,
    location: geneLoc,
    defaultSession: {
      ...jbrowseConfig.defaultSession,
      view: {
        ...jbrowseConfig.defaultSession.view,
        init: {
          ...jbrowseConfig.defaultSession.view.init,
          loc: geneLoc,
        },
      },
    },
  });

  const navRef = useRef(false);

  // Navigate + set highlight after view is ready
  useEffect(() => {
    if (!geneLoc || navRef.current) return;
    navRef.current = true;

    const timer = setTimeout(() => {
      try {
        viewState.session.view.navToLocString(geneLoc);
        viewState.session.view.setHighlight(geneLoc);
      } catch {
        // ignore if view not ready
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [viewState, geneLoc]);

  return (
    <Box>
      <Group justify="space-between" align="center" mb="sm">
        <Group gap="sm">
          <Button
            component="a"
            href="/jbrowse"
            variant="subtle"
            size="xs"
            leftSection={<IconArrowLeft size={14} />}
            color="gray"
          >
            Back to JBrowse
          </Button>
          <Title order={4} c="dimmed">|</Title>
          <Text size="sm" fw={600} c="blue">
            {geneSymbol ? `${geneSymbol} — ` : ""}
            {geneLoc}
          </Text>
        </Group>
        <Text size="xs" c="dimmed">GRCg6a Gene Locus</Text>
      </Group>

      <Card withBorder radius="md" p={0} style={{ overflow: "hidden" }}>
        <JBrowseLinearGenomeView viewState={viewState} />
      </Card>
    </Box>
  );
}
