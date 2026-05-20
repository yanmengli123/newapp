import { Box, Pagination, Table, Text, Badge, Group, Tooltip } from "@mantine/core";
import { useState, useEffect, useMemo } from "react";
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

type SortField = "fdr" | "p_value" | "gene_ratio" | "background_ratio";
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

  const sorted = useMemo(() => [...terms].sort((a, b) => {
    let av: number;
    let bv: number;
    if (sortField === "gene_ratio") {
      av = a.query_total > 0 ? a.query_count / a.query_total : 0;
      bv = b.query_total > 0 ? b.query_count / b.query_total : 0;
    } else if (sortField === "background_ratio") {
      av = a.background_total > 0 ? a.background_count / a.background_total : 0;
      bv = b.background_total > 0 ? b.background_count / b.background_total : 0;
    } else {
      av = a[sortField];
      bv = b[sortField];
    }
    const delta = av - bv;
    return sortDirection === "asc" ? delta : -delta;
  }), [terms, sortField, sortDirection]);

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
    setSortDirection(field === "gene_ratio" || field === "background_ratio" ? "desc" : "asc");
  };

  const sortLabel = (field: SortField, label: string) => (
    <Text span fw={600}>
      {label}{sortField === field ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}
    </Text>
  );

  return (
    <Box style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
      <Table striped highlightOnHover withTableBorder withColumnBorders aria-label="GO enrichment results">
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ whiteSpace: "nowrap" }}>GO ID</Table.Th>
            <Table.Th style={{ whiteSpace: "nowrap" }}>ON</Table.Th>
            <Table.Th>Description</Table.Th>
            <Table.Th
              style={{ cursor: "pointer", whiteSpace: "nowrap" }}
              aria-sort={sortField === "gene_ratio" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}
              onClick={(e) => { e.stopPropagation(); handleSort("gene_ratio"); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleSort("gene_ratio"); }}
            >
              {sortLabel("gene_ratio", "Gene Ratio")}
            </Table.Th>
            <Table.Th
              style={{ cursor: "pointer", whiteSpace: "nowrap" }}
              aria-sort={sortField === "background_ratio" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}
              onClick={(e) => { e.stopPropagation(); handleSort("background_ratio"); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleSort("background_ratio"); }}
            >
              {sortLabel("background_ratio", "BG Ratio")}
            </Table.Th>
            <Table.Th
              style={{ cursor: "pointer" }}
              aria-sort={sortField === "p_value" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}
              onClick={(e) => { e.stopPropagation(); handleSort("p_value"); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleSort("p_value"); }}
            >
              {sortLabel("p_value", "p-value")}
            </Table.Th>
            <Table.Th
              style={{ cursor: "pointer" }}
              aria-sort={sortField === "fdr" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}
              onClick={(e) => { e.stopPropagation(); handleSort("fdr"); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleSort("fdr"); }}
            >
              {sortLabel("fdr", "FDR")}
            </Table.Th>
            <Table.Th style={{ whiteSpace: "nowrap" }}>Sig</Table.Th>
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
                    c={term.significant ? "red" : undefined}
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
