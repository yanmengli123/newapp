import { Drawer, Badge, Stack, Text, Group, Box, Chip, ActionIcon, Tooltip } from "@mantine/core";
import type { GOEnrichmentResult } from "../../lib/goEnrichmentApi";

interface Props {
  term: GOEnrichmentResult | null;
  onClose: () => void;
}

const ONTOLOGY_COLORS = {
  P: { color: "blue", label: "Biological Process" },
  C: { color: "orange", label: "Cellular Component" },
  F: { color: "green", label: "Molecular Function" },
};

function formatPValue(p: number): string {
  if (p < 0.0001) return p.toExponential(2);
  return p.toFixed(6);
}

export default function GOEnrichmentTermDrawer({ term, onClose }: Props) {
  if (!term) return null;

  const ont = ONTOLOGY_COLORS[term.ontology as keyof typeof ONTOLOGY_COLORS];

  return (
    <Drawer
      opened={!!term}
      onClose={onClose}
      title={
        <Group gap="xs">
          <Text fw={700}>{term.go_id}</Text>
          <Badge color={ont.color}>{term.ontology}</Badge>
        </Group>
      }
      position="right"
      size="md"
    >
      <Stack gap="md">
        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Term Name</Text>
          <Text fw={500}>{term.term_name}</Text>
        </Box>

        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Ontology</Text>
          <Chip color={ont.color} checked={false} readOnly>{ont.label}</Chip>
        </Box>

        <Group grow>
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>p-value</Text>
            <Text fw={600} style={{ fontFamily: "monospace" }}>{formatPValue(term.p_value)}</Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>FDR</Text>
            <Text fw={600} style={{ fontFamily: "monospace" }} c="red">{formatPValue(term.fdr)}</Text>
          </Box>
        </Group>

        <Group grow>
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Gene Ratio</Text>
            <Text fw={600}>{term.gene_ratio}</Text>
            <Text size="xs" c="dimmed">({term.query_count} / {term.query_total})</Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>BG Ratio</Text>
            <Text fw={600}>{term.background_ratio}</Text>
            <Text size="xs" c="dimmed">({term.background_count} / {term.background_total})</Text>
          </Box>
        </Group>

        {term.hit_genes.length > 0 && (
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Hit Genes ({term.hit_genes.length})
            </Text>
            <Box
              mt={4}
              p="xs"
              style={{
                backgroundColor: "#f8f9fa",
                borderRadius: 6,
                maxHeight: 150,
                overflow: "auto",
                fontFamily: "monospace",
                fontSize: 12,
              }}
            >
              {term.hit_genes.map((gene) => (
                <Text key={gene} size="xs" style={{ fontFamily: "monospace" }}>{gene}</Text>
              ))}
            </Box>
          </Box>
        )}

        {term.hit_symbols.length > 0 && (
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Hit Symbols ({term.hit_symbols.length})
            </Text>
            <Group gap={4}>
              {term.hit_symbols.slice(0, 20).map((sym) => (
                <Badge key={sym} size="sm" variant="light" color="cyan">{sym}</Badge>
              ))}
              {term.hit_symbols.length > 20 && (
                <Text size="xs" c="dimmed">... and {term.hit_symbols.length - 20} more</Text>
              )}
            </Group>
          </Box>
        )}

        {term.hit_ncbi_ids.length > 0 && (
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Hit NCBI IDs ({term.hit_ncbi_ids.length})
            </Text>
            <Text size="xs" style={{ fontFamily: "monospace" }}>
              {term.hit_ncbi_ids.slice(0, 20).join(", ")}
              {term.hit_ncbi_ids.length > 20 ? " ..." : ""}
            </Text>
          </Box>
        )}

        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>External Links</Text>
          <Group gap="xs" mt={4}>
            <Tooltip label="View in AmiGO">
              <ActionIcon
                component="a"
                href={`https://amigo.geneontology.org/amigo/term/${term.go_id}`}
                target="_blank"
                rel="noopener noreferrer"
                variant="light"
              >
                <Text size="xs">AmiGO</Text>
              </ActionIcon>
            </Tooltip>
            <Tooltip label="View in QuickGO">
              <ActionIcon
                component="a"
                href={`https://www.ebi.ac.uk/QuickGO/term/${term.go_id}`}
                target="_blank"
                rel="noopener noreferrer"
                variant="light"
              >
                <Text size="xs">QuickGO</Text>
              </ActionIcon>
            </Tooltip>
          </Group>
        </Box>
      </Stack>
    </Drawer>
  );
}