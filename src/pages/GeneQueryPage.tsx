import {
  Box,
  Button,
  Card,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  ThemeIcon,
  Anchor,
} from "@mantine/core";
import { IconSearch, IconExternalLink, IconDna, IconDatabase, IconWorld } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { searchGenes } from "../lib/geneApi";

const EXTERNAL_LINKS = [
  {
    name: "NCBI Gallus gallus",
    description: "National Center for Biotechnology Information - Chicken genome reference",
    url: "https://www.ncbi.nlm.nih.gov/datasets/genome/GCF_016699045.2/",
    icon: IconDatabase,
    color: "blue",
  },
  {
    name: "Ensembl GRCg6a",
    description: "Ensembl Genome Browser - Chicken GRCg6a assembly",
    url: "https://www.ensembl.org/Gallus_gallus/Info/Index",
    icon: IconWorld,
    color: "green",
  },
  {
    name: "NCBI RefSeq",
    description: "NCBI RefSeq database for chicken genes",
    url: "https://www.ncbi.nlm.nih.gov/nuccore/?term=Gallus+gallus+GRCg6a",
    icon: IconDna,
    color: "cyan",
  },
  {
    name: "UCSC Chicken",
    description: "UCSC Genome Browser - Chicken (Gallus gallus)",
    url: "https://genome.ucsc.edu/cgi-bin/hgTracks?db=galGal7",
    icon: IconExternalLink,
    color: "orange",
  },
];

export default function GeneQueryPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    // Try to parse the query and navigate appropriately
    const query = searchQuery.trim();

    // If it's a gene ID (starts with gene-), navigate to gene page
    if (/^gene-/.test(query)) {
      navigate(`/gene/${encodeURIComponent(query)}`);
      return;
    }

    // If it's a chromosome accession (NC_xxx), navigate to chromosome page
    if (/^NC_\d+\.\d+$/.test(query)) {
      navigate(`/chromosome/${encodeURIComponent(query)}`);
      return;
    }

    // If it's a region (NC_xxx:start-end), navigate to chromosome with params
    const regionMatch = query.match(/^(NC_\d+\.\d+):(\d+)-(\d+)$/);
    if (regionMatch) {
      navigate(`/chromosome/${regionMatch[1]}?start=${regionMatch[2]}&end=${regionMatch[3]}`);
      return;
    }

    // Otherwise, search for gene by symbol/name using API
    try {
      const result = await searchGenes(query, 1);
      if (result.items.length > 0) {
        navigate(`/gene/${encodeURIComponent(result.items[0].gene_id)}`);
      } else {
        // No results found - navigate to home
        navigate(`/?q=${encodeURIComponent(query)}`);
      }
    } catch (error) {
      console.error("Search error:", error);
      navigate(`/?q=${encodeURIComponent(query)}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  return (
    <Stack gap="xl">
      {/* Header */}
      <Paper withBorder radius="xl" p="xl">
        <Stack gap="lg">
          <Group>
            <ThemeIcon size={48} radius="xl" variant="light" color="cyan">
              <IconSearch size={24} />
            </ThemeIcon>
            <Box>
              <Title order={2}>Gene Query</Title>
              <Text c="dimmed" size="sm">
                Search genes by ID, symbol, or browse external databases
              </Text>
            </Box>
          </Group>

          <Group gap="sm">
            <TextInput
              placeholder="Enter gene ID (e.g., gene-LOC112532827), gene symbol, or chromosome (e.g., NC_006088.5)"
              size="lg"
              style={{ flex: 1 }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <Button variant="light" size="lg" onClick={handleSearch}>
              Search
            </Button>
          </Group>

          <Group gap="xs">
            <Text size="xs" c="dimmed">Try:</Text>
            <Anchor
              size="xs"
              c="cyan"
              style={{ cursor: "pointer" }}
              onClick={() => setSearchQuery("gene-LOC112532827")}
            >
              gene-LOC112532827
            </Anchor>
            <Text size="xs" c="dimmed">|</Text>
            <Anchor
              size="xs"
              c="cyan"
              style={{ cursor: "pointer" }}
              onClick={() => setSearchQuery("NC_006088.5")}
            >
              NC_006088.5
            </Anchor>
            <Text size="xs" c="dimmed">|</Text>
            <Anchor
              size="xs"
              c="cyan"
              style={{ cursor: "pointer" }}
              onClick={() => setSearchQuery("CLC2DL5")}
            >
              CLC2DL5
            </Anchor>
          </Group>
        </Stack>
      </Paper>

      {/* External Links */}
      <Paper withBorder radius="xl" p="xl">
        <Stack gap="lg">
          <Title order={4}>External Databases</Title>
          <Text c="dimmed" size="sm">
            Access official GRCg6a chicken genome resources from major databases
          </Text>

          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {EXTERNAL_LINKS.map((link) => (
              <Card
                key={link.name}
                withBorder
                radius="md"
                padding="md"
                component="a"
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: "none", transition: "transform 0.2s" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <Group justify="space-between" align="flex-start">
                  <Group gap="sm">
                    <ThemeIcon size={40} radius="md" variant="light" color={link.color}>
                      <link.icon size={20} />
                    </ThemeIcon>
                    <Box>
                      <Group gap="xs">
                        <Text fw={600} size="sm">
                          {link.name}
                        </Text>
                        <IconExternalLink size={12} />
                      </Group>
                      <Text size="xs" c="dimmed">
                        {link.description}
                      </Text>
                    </Box>
                  </Group>
                </Group>
              </Card>
            ))}
          </SimpleGrid>
        </Stack>
      </Paper>

      {/* Quick Examples */}
      <Paper withBorder radius="xl" p="xl">
        <Stack gap="md">
          <Title order={4}>Quick Examples</Title>
          <Text c="dimmed" size="sm">
            Try these example queries to explore the database
          </Text>

          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Card withBorder radius="md" padding="sm">
              <Stack gap="xs">
                <Text fw={600} size="sm">Gene by ID</Text>
                <Text size="xs" c="dimmed">
                  Search by gene identifier
                </Text>
                <Button
                  variant="light"
                  size="xs"
                  onClick={() => navigate("/gene/gene-LOC112532827")}
                >
                  LOC112532827
                </Button>
              </Stack>
            </Card>

            <Card withBorder radius="md" padding="sm">
              <Stack gap="xs">
                <Text fw={600} size="sm">Chromosome View</Text>
                <Text size="xs" c="dimmed">
                  Browse chromosome genes
                </Text>
                <Button
                  variant="light"
                  size="xs"
                  onClick={() => navigate("/chromosome/NC_006088.5")}
                >
                  Chr 1 (NC_006088.5)
                </Button>
              </Stack>
            </Card>

            <Card withBorder radius="md" padding="sm">
              <Stack gap="xs">
                <Text fw={600} size="sm">Region Search</Text>
                <Text size="xs" c="dimmed">
                  View genes in a region
                </Text>
                <Button
                  variant="light"
                  size="xs"
                  onClick={() =>
                    navigate("/chromosome/NC_006088.5?start=1000000&end=2000000")
                  }
                >
                  1Mb - 2Mb
                </Button>
              </Stack>
            </Card>
          </SimpleGrid>
        </Stack>
      </Paper>

      {/* Data Summary */}
      <Paper withBorder radius="xl" p="xl">
        <Group justify="space-between" align="center">
          <Box>
            <Text fw={600} size="sm">GRCg6a Chicken Genome Database</Text>
            <Text size="xs" c="dimmed">
              Built with GFF3 annotations from NCBI RefSeq
            </Text>
          </Box>
          <Group gap="lg">
            <Box ta="center">
              <Text fw={700} size="xl" c="cyan">
                35
              </Text>
              <Text size="xs" c="dimmed">
                Chromosomes
              </Text>
            </Box>
            <Box ta="center">
              <Text fw={700} size="xl" c="cyan">
                23,640
              </Text>
              <Text size="xs" c="dimmed">
                Genes
              </Text>
            </Box>
            <Box ta="center">
              <Text fw={700} size="xl" c="cyan">
                NC_
              </Text>
              <Text size="xs" c="dimmed">
                RefSeq Accessions
              </Text>
            </Box>
          </Group>
        </Group>
      </Paper>
    </Stack>
  );
}
