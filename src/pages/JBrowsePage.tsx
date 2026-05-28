import { useMemo, useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  createViewState,
  JBrowseLinearGenomeView,
} from "@jbrowse/react-linear-genome-view2";
import { Link, useSearchParams } from "react-router-dom";
import {
  comparativeConfig,
  comparativeTrackIds,
  jbrowseConfig,
  jbrowseModes,
} from "../jbrowseConfig";

type JBrowseMode = "single" | "comparative";

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
  const match = locParam.match(/^(.+?):(\d+)\.\.(\d+)$/);
  if (!match) return "chr1:1..5000000";
  const [, refName, startStr, endStr] = match;
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);
  if (Number.isNaN(start) || Number.isNaN(end)) return "chr1:1..5000000";
  return `${toChrId(refName)}:${start}..${end}`;
}

function getInitialMode(searchParams: URLSearchParams): JBrowseMode {
  return searchParams.get("mode") === "comparative" ? "comparative" : "single";
}

export default function JBrowsePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<JBrowseMode>(() => getInitialMode(searchParams));

  const locParam = searchParams.get("loc");

  useEffect(() => {
    setViewMode(getInitialMode(searchParams));
  }, [searchParams]);

  const initialLoc = useMemo(() => {
    if (!locParam) return "chr1:1..5000000";
    return parseLocParam(locParam);
  }, [locParam]);

  const geneLoc = useMemo(() => {
    if (!locParam) return "";
    return parseLocParam(locParam);
  }, [locParam]);

  const singleViewState = useMemo(() => createViewState({
    ...jbrowseConfig,
    location: initialLoc,
  }), [initialLoc]);

  const comparativeViewState = useMemo(() => createViewState({
    ...comparativeConfig,
    location: initialLoc,
    defaultSession: {
      name: "GRCg6a vs GRCg7b",
      view: {
        id: "comparativeLinearGenomeView",
        type: "LinearGenomeView",
        init: {
          assembly: "GRCg6a",
          loc: initialLoc,
          tracks: [comparativeTrackIds.grcg6aGenes],
        },
      },
    },
  }), [initialLoc]);

  const viewState = viewMode === "single" ? singleViewState : comparativeViewState;
  const currentMode = jbrowseModes[viewMode];
  const navRef = useRef("");

  useEffect(() => {
    if (!geneLoc || navRef.current === `${viewMode}:${geneLoc}`) return;
    navRef.current = `${viewMode}:${geneLoc}`;
    const timer = setTimeout(() => {
      try {
        viewState.session.view.navToLocString(geneLoc);
        const locMatch = geneLoc.match(/^(.+?):(\d+)\.\.(\d+)$/);
        if (locMatch) {
          const [, refName, startStr, endStr] = locMatch;
          viewState.session.view.setHighlight([{
            refName,
            start: parseInt(startStr, 10),
            end: parseInt(endStr, 10),
            assemblyName: "GRCg6a",
          }]);
        }
      } catch {
        // JBrowse can still be initializing immediately after mode switches.
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [geneLoc, viewMode, viewState]);

  const switchMode = (mode: JBrowseMode) => {
    const next = new URLSearchParams(searchParams);
    if (mode === "comparative") next.set("mode", "comparative");
    else next.delete("mode");
    setSearchParams(next, { replace: true });
    setViewMode(mode);
  };

  const handleChrClick = (chr: typeof chromosomes[0]) => {
    const endPos = Math.min(chr.length, 5000000);
    viewState.session.view.navToLocString(`${chr.id}:1..${endPos}`);
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start" gap="md">
        <div>
          <Title order={2}>JBrowse</Title>
          <Text c="dimmed" size="sm">
            GRCg6a primary genome browser with optional GRCg6a vs GRCg7b comparison mode.
          </Text>
        </div>

        <Group gap="xs">
          <Button
            variant={viewMode === "single" ? "filled" : "light"}
            onClick={() => switchMode("single")}
          >
            GRCg6a
          </Button>
          <Button
            variant={viewMode === "comparative" ? "filled" : "light"}
            onClick={() => switchMode("comparative")}
          >
            GRCg6a vs GRCg7b
          </Button>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <Card withBorder radius="sm" p="md">
          <Text size="xs" tt="uppercase" c="dimmed" fw={700}>Mode</Text>
          <Text fw={700}>{currentMode.label}</Text>
        </Card>
        <Card withBorder radius="sm" p="md">
          <Text size="xs" tt="uppercase" c="dimmed" fw={700}>Configuration</Text>
          <Text fw={700}>{currentMode.config}</Text>
        </Card>
        <Card withBorder radius="sm" p="md">
          <Text size="xs" tt="uppercase" c="dimmed" fw={700}>Tracks</Text>
          <Group gap={6} mt={4}>
            {currentMode.tracks.map((track) => (
              <Badge key={track} variant="light">{track}</Badge>
            ))}
          </Group>
        </Card>
      </SimpleGrid>

      {viewMode === "comparative" && (
        <Card withBorder radius="sm" p="md" bg="blue.0">
          <Group justify="space-between" align="flex-start" gap="md">
            <Stack gap={4}>
              <Text fw={700}>Comparison mode is using GRCg6a as the primary assembly.</Text>
              <Text size="sm" c="dimmed">
                The embedded browser loads GRCg6a and GRCg7b gene tracks; synteny blocks and dotplot are available in Comparative.
              </Text>
            </Stack>
            <Button component={Link} to="/comparative" variant="light">
              Open Comparative
            </Button>
          </Group>
        </Card>
      )}

      <SimpleGrid cols={{ base: 4, sm: 6, md: 8 }}>
        {chromosomes.map((chr) => (
          <Button
            key={chr.id}
            variant="light"
            size="xs"
            onClick={() => handleChrClick(chr)}
            title={`${chr.seqid} ${formatLength(chr.length)}`}
          >
            {chr.name} ({formatLength(chr.length)})
          </Button>
        ))}
      </SimpleGrid>

      <Card withBorder radius="sm" p={0} style={{ minHeight: 680, overflow: "hidden" }}>
        <JBrowseLinearGenomeView key={viewMode} viewState={viewState} />
      </Card>
    </Stack>
  );
}
