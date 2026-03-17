import {
  Box,
  Card,
  Group,
  Loader,
  Paper,
  Badge,
  Stack,
  Text,
  Title,
  Pagination,
  Button,
} from "@mantine/core";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { IconArrowLeft, IconDna, IconChevronRight } from "@tabler/icons-react";
import type { ChromosomeDetail, GeneResult } from "../lib/geneApi";
import { getChromosome, getChromosomeGenes } from "../lib/geneApi";

const PAGE_SIZE = 20;

export default function ChromosomePage() {
  const { seqid } = useParams<{ seqid: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");
  const pageParam = searchParams.get("page");
  const currentPage = pageParam ? parseInt(pageParam, 10) : 1;

  const [chromosome, setChromosome] = useState<ChromosomeDetail | null>(null);
  const [genes, setGenes] = useState<GeneResult[]>([]);
  const [totalGenes, setTotalGenes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const start = startParam ? parseInt(startParam, 10) : undefined;
  const end = endParam ? parseInt(endParam, 10) : undefined;

  useEffect(() => {
    if (!seqid) return;

    const fetchChromosome = async () => {
      setLoading(true);
      setError(null);
      try {
        const chromData = await getChromosome(seqid);
        setChromosome(chromData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load chromosome");
      } finally {
        setLoading(false);
      }
    };

    fetchChromosome();
  }, [seqid]);

  useEffect(() => {
    if (!seqid) return;

    const fetchGenes = async () => {
      setLoading(true);
      try {
        const offset = (currentPage - 1) * PAGE_SIZE;
        const result = await getChromosomeGenes(
          seqid,
          start,
          end,
          PAGE_SIZE,
          offset
        );
        setGenes(result.items);
        setTotalGenes(result.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load genes");
      } finally {
        setLoading(false);
      }
    };

    fetchGenes();
  }, [seqid, currentPage, start, end]);

  const totalPages = Math.ceil(totalGenes / PAGE_SIZE);

  const handlePageChange = (page: number) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("page", page.toString());
    setSearchParams(newParams);
  };

  const clearRegionFilter = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("start");
    newParams.delete("end");
    newParams.delete("page");
    setSearchParams(newParams);
  };

  if (loading) {
    return (
      <Paper withBorder radius="xl" p="xl">
        <Group justify="center" gap="md">
          <Loader size="md" />
          <Text c="dimmed">Loading chromosome information...</Text>
        </Group>
      </Paper>
    );
  }

  if (error || !chromosome) {
    return (
      <Paper withBorder radius="xl" p="xl">
        <Text c="red">Error: {error || "Chromosome not found"}</Text>
        <Link to="/">
          <Text c="cyan" mt="md">
            ← Back to Home
          </Text>
        </Link>
      </Paper>
    );
  }

  return (
    <Stack gap="lg">
      {/* Back link */}
      <Link to="/" style={{ textDecoration: "none" }}>
        <Group gap="xs" c="cyan">
          <IconArrowLeft size={16} />
          <Text size="sm">Back to Search</Text>
        </Group>
      </Link>

      {/* Chromosome Header */}
      <Paper withBorder radius="xl" p="xl">
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <Box>
              <Group gap="sm">
                <IconDna size={28} color="var(--mantine-color-cyan-6)" />
                <Title order={2}>
                  {chromosome.chr_name || chromosome.seqid}
                </Title>
                <Badge color="cyan" variant="light">
                  Chromosome
                </Badge>
              </Group>
              {chromosome.description && (
                <Text c="dimmed" size="sm" mt={4}>
                  {chromosome.description}
                </Text>
              )}
            </Box>
          </Group>

          <Group grow>
            <Box>
              <Text size="xs" c="dimmed" tt="uppercase">
                Accession
              </Text>
              <Text fw={500}>{chromosome.seqid}</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed" tt="uppercase">
                Length
              </Text>
              <Text fw={500}>{chromosome.length.toLocaleString()} bp</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed" tt="uppercase">
                Total Genes
              </Text>
              <Text fw={500}>{chromosome.gene_count.toLocaleString()}</Text>
            </Box>
          </Group>

          {/* Region filter indicator */}
          {(start !== undefined || end !== undefined) && (
            <Paper withBorder radius="md" p="sm" bg="gray.0">
              <Group justify="space-between">
                <Box>
                  <Text size="sm" fw={500}>
                    Region Filter
                  </Text>
                  <Text size="xs" c="dimmed">
                    {seqid}
                    {start !== undefined && end !== undefined
                      ? `:${start.toLocaleString()}-${end.toLocaleString()}`
                      : start !== undefined
                      ? `:${start.toLocaleString()}-`
                      : `-${end?.toLocaleString()}`}
                  </Text>
                </Box>
                <Button variant="subtle" size="xs" onClick={clearRegionFilter}>
                  Clear Filter
                </Button>
              </Group>
            </Paper>
          )}
        </Stack>
      </Paper>

      {/* Genes List */}
      <Paper withBorder radius="xl" p="xl">
        <Group justify="space-between" mb="md">
          <Title order={4}>
            Genes {(start !== undefined || end !== undefined) && `in Region`}
            {totalGenes > 0 && ` (${totalGenes.toLocaleString()} total)`}
          </Title>
        </Group>

        {loading ? (
          <Group justify="center" gap="md">
            <Loader size="sm" />
            <Text c="dimmed">Loading genes...</Text>
          </Group>
        ) : genes.length === 0 ? (
          <Text c="dimmed">No genes found in this region</Text>
        ) : (
          <Stack gap="sm">
            {genes.map((gene) => (
              <Card key={gene.gene_id} withBorder padding="sm" radius="md">
                <Group justify="space-between" wrap="nowrap">
                  <Box>
                    <Group gap="xs">
                      <Text fw={500} size="sm">
                        {gene.gene_symbol || gene.gene_id}
                      </Text>
                      <Badge size="xs" variant="light">
                        {gene.biotype || "gene"}
                      </Badge>
                    </Group>
                    <Text c="dimmed" size="xs">
                      {gene.name || gene.gene_id}
                    </Text>
                  </Box>
                  <Group gap="md" wrap="nowrap">
                    <Box style={{ textAlign: "right" }}>
                      <Text size="xs" c="dimmed">
                        {gene.seqid}:{gene.start.toLocaleString()}-{gene.end.toLocaleString()}
                      </Text>
                      <Group gap="xs">
                        <Badge
                          size="xs"
                          variant="outline"
                          color={gene.strand === "+" ? "teal" : "orange"}
                        >
                          {gene.strand}
                        </Badge>
                        <Text size="xs" c="dimmed">
                          {gene.length.toLocaleString()} bp
                        </Text>
                      </Group>
                    </Box>
                    <Link to={`/gene/${encodeURIComponent(gene.gene_id)}`}>
                      <IconChevronRight size={16} style={{ opacity: 0.5 }} />
                    </Link>
                  </Group>
                </Group>
              </Card>
            ))}
          </Stack>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <Group justify="center" mt="lg">
            <Pagination
              total={totalPages}
              value={currentPage}
              onChange={handlePageChange}
              size="sm"
            />
          </Group>
        )}
      </Paper>
    </Stack>
  );
}
