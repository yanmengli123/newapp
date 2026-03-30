import { Badge, Paper, Group, Title, Stack } from "@mantine/core";
import { IconLink } from "@tabler/icons-react";
import type { KEGGAnnotationsResponse } from "../../lib/geneApi";
import KeggPathwayCard from "./KeggPathwayCard";

interface KeggPathwaysSectionProps {
  keggAnnotations: KEGGAnnotationsResponse;
  geneId: string;
  kegg_gene_id?: string | null;
}

export default function KeggPathwaysSection({ keggAnnotations, geneId, kegg_gene_id }: KeggPathwaysSectionProps) {
  const pathways = keggAnnotations.pathways || keggAnnotations.items || [];
  const effectiveKeggId = kegg_gene_id || keggAnnotations.kegg_gene_id;

  if (pathways.length === 0) return null;

  return (
    <Paper withBorder radius="xl" p="xl">
      <Group gap="sm" mb="md">
        <IconLink size={20} color="var(--mantine-color-teal-6)" />
        <Title order={4}>KEGG Pathways</Title>
        {effectiveKeggId && (
          <Badge variant="outline" color="gray" size="xs">
            KEGG: {effectiveKeggId}
          </Badge>
        )}
        {keggAnnotations.ncbi_gene_id && (
          <Badge variant="outline" color="gray" size="xs">
            NCBI: {keggAnnotations.ncbi_gene_id}
          </Badge>
        )}
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
