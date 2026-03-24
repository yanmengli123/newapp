import { Card, Group, Box, Text, Button, Badge, Anchor } from "@mantine/core";
import { IconEye, IconFocus2 } from "@tabler/icons-react";
import type { KEGGPathway } from "../../lib/geneApi";
import { useDisclosure } from "@mantine/hooks";
import { useCallback } from "react";
import KeggInteractiveViewer from "./KeggInteractiveViewer";

interface KeggPathwayCardProps {
  pathway: KEGGPathway;
  geneId: string;
}

export default function KeggPathwayCard({ pathway, geneId }: KeggPathwayCardProps) {
  const [viewerOpen, { open: openViewer, close: closeViewer }] = useDisclosure(false);

  const handleViewPathway = useCallback(() => {
    window.open(
      `http://localhost:8000/kegg-images/${pathway.pathway_id}.png`,
      "_blank",
      "noopener"
    );
  }, [pathway.pathway_id]);

  return (
    <>
      <Card key={pathway.pathway_id} withBorder padding="sm" radius="md">
        <Group justify="space-between">
          <Box>
            <Text size="sm" fw={500}>
              {pathway.pathway_name}
            </Text>
            <Text size="xs" c="dimmed">
              {pathway.pathway_id}
            </Text>
          </Box>
          <Group gap="xs">
            {/* View Pathway — 打开静态图片 */}
            <Button
              variant="light"
              size="xs"
              leftSection={<IconEye size={14} />}
              onClick={handleViewPathway}
            >
              View Pathway
            </Button>

            {/* Interactive KGML — 新增：打开可交互 viewer */}
            <Button
              variant="light"
              color="red"
              size="xs"
              leftSection={<IconFocus2 size={14} />}
              onClick={openViewer}
            >
              Interactive KGML
            </Button>

            {/* KEGG 外链 */}
            <Anchor
              href={pathway.official_link}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Badge variant="light" color="teal">
                KEGG
              </Badge>
            </Anchor>
          </Group>
        </Group>
      </Card>

      {/* 可交互 KEGG 通路查看器 */}
      <KeggInteractiveViewer
        pathwayId={pathway.pathway_id}
        pathwayName={pathway.pathway_name}
        pngUrl={pathway.png_url || `/static/kegg_pathways/${pathway.pathway_id}.png`}
        geneId={geneId}
        opened={viewerOpen}
        onClose={closeViewer}
      />
    </>
  );
}
