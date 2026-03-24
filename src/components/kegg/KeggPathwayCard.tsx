import { Card, Group, Box, Text, Button, Badge, Anchor, Modal, Image } from "@mantine/core";
import { IconEye, IconFocus2, IconDownload } from "@tabler/icons-react";
import type { KEGGPathway } from "../../lib/geneApi";
import { useDisclosure } from "@mantine/hooks";
import KeggInteractiveViewer from "./KeggInteractiveViewer";

const IMG_BASE = "http://localhost:8000";

interface KeggPathwayCardProps {
  pathway: KEGGPathway;
  geneId: string;
}

export default function KeggPathwayCard({ pathway, geneId }: KeggPathwayCardProps) {
  const [viewerOpen, { open: openViewer, close: closeViewer }] = useDisclosure(false);
  const [imgOpen, { open: openImg, close: closeImg }] = useDisclosure(false);

  const imgUrl = `${IMG_BASE}/kegg-images/${pathway.pathway_id}.png`;

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = imgUrl;
    a.download = `${pathway.pathway_id}.png`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <>
      <Card key={pathway.pathway_id} withBorder padding="sm" radius="md">
        <Group justify="space-between">
          <Box>
            <Text size="sm" fw={500}>{pathway.pathway_name}</Text>
            <Text size="xs" c="dimmed">{pathway.pathway_id}</Text>
          </Box>
          <Group gap="xs">
            {/* View Pathway — Modal 显示静态图片 */}
            <Button variant="light" size="xs" leftSection={<IconEye size={14} />} onClick={openImg}>
              View Pathway
            </Button>

            {/* Interactive KGML — 右侧 Drawer */}
            <Button variant="light" color="red" size="xs" leftSection={<IconFocus2 size={14} />} onClick={openViewer}>
              Interactive KGML
            </Button>

            {/* Download — 下载 PNG */}
            <Button variant="light" color="gray" size="xs" leftSection={<IconDownload size={14} />} onClick={handleDownload}>
              Download
            </Button>

            {/* KEGG 外链 */}
            <Anchor href={pathway.official_link} target="_blank" rel="noopener noreferrer">
              <Badge variant="light" color="teal">KEGG</Badge>
            </Anchor>
          </Group>
        </Group>
      </Card>

      {/* 静态图片 Modal */}
      <Modal
        opened={imgOpen}
        onClose={closeImg}
        title={
          <Box>
            <Text fw={600} size="sm">{pathway.pathway_name}</Text>
            <Text size="xs" c="dimmed">{pathway.pathway_id}</Text>
          </Box>
        }
        size="xl"
        centered
        overlayProps={{ backgroundOpacity: 0.3, blur: 3 }}
      >
        <Image
          src={imgUrl}
          alt={pathway.pathway_name}
          radius="md"
          mah={600}
          style={{ background: "#f8f9fa", width: "100%" }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <Group justify="space-between" mt="md">
          <Text size="xs" c="dimmed">If image is not available,{" "}
            <Anchor
              href={`https://www.kegg.jp/kegg-bin/show_pathway?map=${pathway.pathway_id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              view on KEGG website
            </Anchor>
          </Text>
          <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={handleDownload}>
            Download
          </Button>
        </Group>
      </Modal>

      {/* 可交互 KEGG 通路查看器 */}
      <KeggInteractiveViewer
        pathwayId={pathway.pathway_id}
        pathwayName={pathway.pathway_name}
        pngUrl={`/kegg-images/${pathway.pathway_id}.png`}
        geneId={geneId}
        opened={viewerOpen}
        onClose={closeViewer}
      />
    </>
  );
}
