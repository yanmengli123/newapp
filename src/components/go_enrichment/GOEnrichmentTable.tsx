import { Box, Pagination, Table, Text, Badge, Group, Tooltip } from "@mantine/core";
import { useState, useEffect } from "react";
import type { GOEnrichmentResult } from "../../lib/goEnrichmentApi";

interface Props {
  terms: GOEnrichmentResult[];
  onRowClick: (term: GOEnrichmentResult) => void;
}

const PAGE_SIZE = 20;

const ONTOLOGY_COLORS = {
  P: { color: "blue", label: "P" },
  C: { color: "orange", label: "C" },
  F: { color: "green", label: "F" },
};

type SortField = "fdr" | "p_value" | "query_count" | "background_count";
type SortDirection = "asc" | "desc";

function formatPValue(p: number): string {
  if (p < 0.0001) return p.toExponential(2);
  return p.toFixed(4);
}

function formatFDR(f: number): string {
  if (f < 0.0001) return f.toExponential(2);
  return f.toFixed(4);
}

export default function GOEnrichmentTable({ terms, onRowClick }: Props) {
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>("fdr");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Reset to page 1 whenever the terms prop changes (e.g. filter toggle)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(1); }, [terms]);

  const sorted = [...terms].sort((a, b) => {
    const av = a[sortField];
    const bv = b[sortField];
    const delta = av - bv;
    return sortDirection === "asc" ? delta : -delta;
  });

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (terms.length === 0) {
    return (
      <Box py="xl" ta="center">
        <Text c="dimmed" size="sm">
          No significant GO terms found. This may mean your gene set is too small,
          or no GO term was enriched after FDR correction. Try relaxing the FDR cutoff
          or lowering the min overlap setting.
        </Text>
      </Box>
    );
  }

  const handleSort = (field: SortField) => {
    setPage(1);
    if (sortField === field) {
      setSortDirection((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDirection(field === "query_count" || field === "background_count" ? "desc" : "asc");
  };

  const sortLabel = (field: SortField, label: string) => (
    <Text span fw={600}>
      {label}{sortField === field ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}
    </Text>
  );

  return (
    <Box>
      <Table striped highlightOnHover withTableBorder withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>GO ID</Table.Th>
            <Table.Th>ON</Table.Th>
            <Table.Th>Description</Table.Th>
            <Table.Th
              style={{ cursor: "pointer" }}
              onClick={(e) => { e.stopPropagation(); handleSort("query_count"); }}
            >
              {sortLabel("query_count", "Gene Ratio")}
            </Table.Th>
            <Table.Th
              style={{ cursor: "pointer" }}
              onClick={(e) => { e.stopPropagation(); handleSort("background_count"); }}
            >
              {sortLabel("background_count", "BG Ratio")}
            </Table.Th>
            <Table.Th
              style={{ cursor: "pointer" }}
              onClick={(e) => { e.stopPropagation(); handleSort("p_value"); }}
            >
              {sortLabel("p_value", "p-value")}
            </Table.Th>
            <Table.Th
              style={{ cursor: "pointer" }}
              onClick={(e) => { e.stopPropagation(); handleSort("fdr"); }}
            >
              {sortLabel("fdr", "FDR")}
            </Table.Th>
            <Table.Th>Sig</Table.Th>
            <Table.Th>Hit Genes</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {paged.map((term) => {
            const ont = ONTOLOGY_COLORS[term.ontology as keyof typeof ONTOLOGY_COLORS];
            return (
              <Table.Tr
                key={`${term.go_id}-${term.namespace}`}
                style={{ cursor: "pointer" }}
                onClick={() => onRowClick(term)}
              >
                <Table.Td>
                  <Text
                    size="sm"
                    fw={600}
                    style={{ fontFamily: "monospace" }}
                    component="a"
                    href={`https://amigo.geneontology.org/amigo/term/${term.go_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {term.go_id}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge color={ont.color} size="sm">{ont.label}</Badge>
                </Table.Td>
                <Table.Td>
                  <Tooltip label={term.term_name} multiline maw={300}>
                    <Text size="sm" lineClamp={2}>{term.term_name}</Text>
                  </Tooltip>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" fw={600}>{term.gene_ratio}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">{term.background_ratio}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" style={{ fontFamily: "monospace" }}>{formatPValue(term.p_value)}</Text>
                </Table.Td>
                <Table.Td>
                  <Text
                    size="sm"
                    fw={600}
                    style={{ fontFamily: "monospace" }}
                    c={term.fdr < 0.05 ? "red" : undefined}
                  >
                    {formatFDR(term.fdr)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge
                    size="sm"
                    color={term.significant ? "green" : "gray"}
                    variant={term.significant ? "filled" : "outline"}
                  >
                    {term.significant ? "Sig" : "NS"}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Tooltip label={term.hit_genes.join(", ")} maw={400}>
                    <Text size="sm" lineClamp={1}>{term.hit_genes.slice(0, 3).join(", ")}{term.hit_genes.length > 3 ? " ..." : ""}</Text>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>

      {totalPages > 1 && (
        <Group justify="space-between" mt="md">
          <Text size="sm" c="dimmed">
            Showing {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length}
          </Text>
          <Pagination total={totalPages} value={page} onChange={setPage} size="sm" />
        </Group>
      )}
    </Box>
  );
}
