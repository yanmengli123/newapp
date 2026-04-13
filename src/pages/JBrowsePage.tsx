import { useMemo } from "react";
import { Button, Card, Stack, Text, Title, SimpleGrid } from "@mantine/core";
import {
  createViewState,
  JBrowseLinearGenomeView,
} from "@jbrowse/react-linear-genome-view2";
import { useSearchParams } from "react-router-dom";
import { jbrowseConfig } from "../jbrowseConfig";

// 染色体列表
const chromosomes = [
  { id: "chr1", name: "1", seqid: "NC_006088.5", length: 197608386 },
  { id: "chr2", name: "2", seqid: "NC_006089.5", length: 149682049 },
  { id: "chr3", name: "3", seqid: "NC_006090.5", length: 110838418 },
  { id: "chr4", name: "4", seqid: "NC_006091.5", length: 91315245 },
  { id: "chr5", name: "5", seqid: "NC_006092.5", length: 59809098 },
  { id: "chr6", name: "6", seqid: "NC_006093.5", length: 36374701 },
  { id: "chr7", name: "7", seqid: "NC_006094.5", length: 36742308 },
  { id: "chr8", name: "8", seqid: "NC_006095.5", length: 30219446 },
  { id: "chr9", name: "9", seqid: "NC_006096.5", length: 24153086 },
  { id: "chr10", name: "10", seqid: "NC_006097.5", length: 21119840 },
  { id: "chr11", name: "11", seqid: "NC_006098.5", length: 20200042 },
  { id: "chr12", name: "12", seqid: "NC_006099.5", length: 20387278 },
  { id: "chr13", name: "13", seqid: "NC_006100.5", length: 19166714 },
  { id: "chr14", name: "14", seqid: "NC_006101.5", length: 16219308 },
  { id: "chr15", name: "15", seqid: "NC_006102.5", length: 13062184 },
  { id: "chr16", name: "16", seqid: "NC_006103.5", length: 2844601 },
  { id: "chr17", name: "17", seqid: "NC_006104.5", length: 10762512 },
  { id: "chr18", name: "18", seqid: "NC_006105.5", length: 11373140 },
  { id: "chr19", name: "19", seqid: "NC_006106.5", length: 10323212 },
  { id: "chr20", name: "20", seqid: "NC_006107.5", length: 13897287 },
  { id: "chr21", name: "21", seqid: "NC_006108.5", length: 6844979 },
  { id: "chr22", name: "22", seqid: "NC_006109.5", length: 5459462 },
  { id: "chr23", name: "23", seqid: "NC_006110.5", length: 6149580 },
  { id: "chr24", name: "24", seqid: "NC_006111.5", length: 6491222 },
  { id: "chr25", name: "25", seqid: "NC_006112.4", length: 3980610 },
  { id: "chr26", name: "26", seqid: "NC_006113.5", length: 6055710 },
  { id: "chr27", name: "27", seqid: "NC_006114.5", length: 8080432 },
  { id: "chr28", name: "28", seqid: "NC_006115.5", length: 5116880 },
  { id: "chr29", name: "29", seqid: "NC_008465.4", length: 7821666 },
  { id: "chr30", name: "30", seqid: "NC_028739.2", length: 1818525 },
  { id: "chr31", name: "31", seqid: "NC_028740.2", length: 6153034 },
  { id: "chr32", name: "32", seqid: "NC_006119.4", length: 725831 },
  { id: "chrW", name: "W", seqid: "NC_006126.5", length: 6813114 },
  { id: "chrZ", name: "Z", seqid: "NC_006127.5", length: 82529921 },
  { id: "chrMT", name: "MT", seqid: "NC_040902.1", length: 16784 },
];

// NC_ accession → chr ID
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

function formatLength(len: number): string {
  if (len >= 1000000) return `${(len / 1000000).toFixed(1)} Mb`;
  return `${(len / 1000).toFixed(1)} kb`;
}

function parseLocParam(locParam: string): string {
  // locParam format: "chr1:start..end" or "NC_006088.5:start..end"
  const match = locParam.match(/^(.+?):(\d+)\.\.(\d+)$/);
  if (!match) return "chr1:1..5000000";

  const [, refName, startStr, endStr] = match;
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);
  if (isNaN(start) || isNaN(end)) return "chr1:1..5000000";

  // Convert NC_ accession to chr ID
  const chrId = toChrId(refName);

  // Add padding ±5%, min 500bp
  const pad = Math.max(Math.floor((end - start) * 0.05), 500);
  const paddedStart = Math.max(1, start - pad);
  const paddedEnd = end + pad;

  return `${chrId}:${paddedStart}..${paddedEnd}`;
}

export default function JBrowsePage() {
  const [searchParams] = useSearchParams();

  // Compute initial location from ?loc= param; falls back to default
  const initialLoc = useMemo(() => {
    const locParam = searchParams.get("loc");
    if (!locParam) return "chr1:1..5000000";
    return parseLocParam(locParam);
  }, [searchParams]);

  // Build viewState with the correct initial location
  const viewState = useMemo(() => {
    return createViewState({
      ...jbrowseConfig,
      defaultSession: {
        ...jbrowseConfig.defaultSession,
        view: {
          ...jbrowseConfig.defaultSession.view,
          init: {
            ...jbrowseConfig.defaultSession.view.init,
            loc: initialLoc,
          },
        },
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally only once on mount

  const handleChrClick = (chr: typeof chromosomes[0]) => {
    const endPos = Math.min(chr.length, 5000000);
    viewState.session.view.navToLocString(`${chr.id}:1..${endPos}`);
  };

  return (
    <Stack gap="md">
      <Title order={2}>JBrowse</Title>
      <Text c="dimmed">GRCg6a 鸡基因组浏览器 - 使用本地基因组数据</Text>

      <SimpleGrid cols={{ base: 4, sm: 6, md: 8 }}>
        {chromosomes.map((chr) => (
          <Button
            key={chr.id}
            variant="light"
            size="xs"
            onClick={() => handleChrClick(chr)}
          >
            {chr.name} ({formatLength(chr.length)})
          </Button>
        ))}
      </SimpleGrid>

      <Card withBorder radius="md" p="md">
        <JBrowseLinearGenomeView viewState={viewState} />
      </Card>
    </Stack>
  );
}
