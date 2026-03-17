import { useState } from "react";
import { Button, Card, Stack, Text, Title, SimpleGrid } from "@mantine/core";
import {
  createViewState,
  JBrowseLinearGenomeView,
} from "@jbrowse/react-linear-genome-view2";
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

function formatLength(len: number): string {
  if (len >= 1000000) {
    return `${(len / 1000000).toFixed(1)} Mb`;
  }
  return `${(len / 1000).toFixed(1)} kb`;
}

export default function JBrowsePage() {
  const [viewState] = useState(() =>
    createViewState({
      ...jbrowseConfig,
    }),
  );

  const handleChrClick = (chr: typeof chromosomes[0]) => {
    // 跳转到染色体起始位置，显示前 5Mb 区域
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
