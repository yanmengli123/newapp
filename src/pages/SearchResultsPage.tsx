import { useEffect, useRef, useState } from "react";
import { Container, Group, Loader, Paper, Stack, Text, Title } from "@mantine/core";
import { IconArrowRight } from "@tabler/icons-react";
import { Link, useSearchParams } from "react-router-dom";
import type { GeneResult } from "../lib/geneApi";
import { searchGenes } from "../lib/geneApi";

export default function SearchResultsPage() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";

  const [results, setResults] = useState<GeneResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!q.trim()) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const res = await searchGenes(q, 50);
        if (cancelled || requestIdRef.current !== requestId) return;
        setResults(res.items);
        setTotal(res.total);
      } catch (err) {
        if (cancelled || requestIdRef.current !== requestId) return;
        setError(err instanceof Error ? err.message : "Search failed");
        setResults([]);
      } finally {
        if (!cancelled && requestIdRef.current === requestId) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [q]);

  return (
    <Container size="lg" px={0}>
      <Stack gap="md">
        <Title order={2}>Search Results</Title>
        <Text c="dimmed" size="sm">
          {q ? `Query: "${q}"` : "No query provided"}
        </Text>

        {loading && (
          <Group justify="center" py="xl">
            <Loader size="sm" />
          </Group>
        )}

        {error && (
          <Paper withBorder p="md" radius="md">
            <Text c="red" size="sm">{error}</Text>
          </Paper>
        )}

        {!loading && !error && (!q || results.length === 0) && (
          <Paper withBorder p="md" radius="md">
            <Text c="dimmed" size="sm">
              {q ? `No genes matched "${q}".` : "Enter a query to search genes."}
            </Text>
          </Paper>
        )}

        {!loading && results.length > 0 && (
          <>
            <Text size="xs" c="dimmed">
              {results.length} of {total} matches
            </Text>
            <Stack gap={0}>
              {results.map((gene) => (
                <Paper
                  key={gene.gene_id}
                  component={Link}
                  to={`/gene/${encodeURIComponent(gene.gene_id)}`}
                  p="sm"
                  radius="md"
                  withBorder
                  style={{ display: "block", textDecoration: "none" }}
                >
                  <Group justify="space-between" wrap="nowrap">
                    <Stack gap={2}>
                      <Text fw={500} size="sm">
                        {gene.gene_symbol || gene.gene_id}
                      </Text>
                      <Text c="dimmed" size="xs">
                        {gene.name || gene.gene_id}
                      </Text>
                    </Stack>
                    <Group gap="xs" wrap="nowrap">
                      <Text size="xs" c="dimmed">
                        {gene.seqid}:{gene.start}-{gene.end}
                      </Text>
                      <Text size="xs" c="dimmed">{gene.strand}</Text>
                      <IconArrowRight size={14} style={{ opacity: 0.5 }} />
                    </Group>
                  </Group>
                </Paper>
              ))}
            </Stack>
          </>
        )}
      </Stack>
    </Container>
  );
}
