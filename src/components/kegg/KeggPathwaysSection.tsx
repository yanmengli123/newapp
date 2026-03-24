import { Paper, Group, Title, Stack } from "@mantine/core";
import { IconLink } from "@tabler/icons-react";
import type { KEGGAnnotationsResponse } from "../../lib/geneApi";
import KeggPathwayCard from "./KeggPathwayCard";

interface KeggPathwaysSectionProps {
  keggAnnotations: KEGGAnnotationsResponse;
  geneId: string;
}

export default function KeggPathwaysSection({ keggAnnotations, geneId }: KeggPathwaysSectionProps) {
  const pathways = keggAnnotations.pathways || keggAnnotations.items || [];

  if (pathways.length === 0) return null;

  return (
    <Paper withBorder radius="xl" p="xl">
      <Group gap="sm" mb="md">
        <IconLink size={20} color="var(--mantine-color-teal-6)" />
        <Title order={4}>KEGG Pathways</Title>
      </Group>

      <Stack gap="sm">
        {pathways.map((pathway) => (
          <KeggPathwayCard
            key={pathway.pathway_id}
            pathway={pathway}
            geneId={geneId}
          />
        ))}
      </Stack>
    </Paper>
  );
}
