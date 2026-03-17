import {
  ActionIcon,
  Box,
  Button,
  Group,
  Kbd,
  Loader,
  Paper,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useDebouncedValue, useClickOutside } from "@mantine/hooks";
import { IconSearch, IconX, IconArrowRight } from "@tabler/icons-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { GeneResult, SearchType } from "../../lib/geneApi";
import { searchGenes, parseSearchQuery } from "../../lib/geneApi";

interface SuggestionItem extends GeneResult {
  searchType: SearchType;
}

export default function GeneSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, 400);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useClickOutside(() => setShowSuggestions(false));

  // Fetch suggestions when debounced query changes
  useEffect(() => {
    if (!debouncedQuery.trim() || debouncedQuery.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const parsed = parseSearchQuery(debouncedQuery);

    // For gene ID, chromosome, or region, navigate directly
    if (parsed.type === "gene_id") {
      navigateToGene(parsed.value);
      return;
    }

    if (parsed.type === "region" || parsed.type === "chromosome") {
      if (parsed.type === "region" && parsed.seqid) {
        navigateToRegion(parsed.seqid, parsed.start!, parsed.end!);
      } else {
        navigateToChromosome(parsed.value);
      }
      return;
    }

    // For symbol/name, show suggestions
    const fetchSuggestions = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await searchGenes(debouncedQuery, 8);
        const items: SuggestionItem[] = result.items.map((gene) => ({
          ...gene,
          searchType: "symbol" as SearchType,
        }));
        setSuggestions(items);
        setShowSuggestions(true);
        setSelectedIndex(-1);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    };

    fetchSuggestions();
  }, [debouncedQuery]);

  // Navigation functions
  const navigateToGene = useCallback((geneId: string) => {
    setShowSuggestions(false);
    setQuery("");
    navigate(`/gene/${encodeURIComponent(geneId)}`);
  }, [navigate]);

  const navigateToChromosome = useCallback((seqid: string) => {
    setShowSuggestions(false);
    setQuery("");
    navigate(`/chromosome/${encodeURIComponent(seqid)}`);
  }, [navigate]);

  const navigateToRegion = useCallback((seqid: string, start: number, end: number) => {
    setShowSuggestions(false);
    setQuery("");
    navigate(`/chromosome/${encodeURIComponent(seqid)}?start=${start}&end=${end}`);
  }, [navigate]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === "Enter") {
        handleFullSearch();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          const item = suggestions[selectedIndex];
          if (item.searchType === "symbol") {
            navigateToGene(item.gene_id);
          }
        } else {
          handleFullSearch();
        }
        break;
      case "Escape":
        setShowSuggestions(false);
        setSelectedIndex(-1);
        break;
    }
  };

  // Full search when pressing enter without selecting
  const handleFullSearch = async () => {
    if (!query.trim()) return;

    const parsed = parseSearchQuery(query);

    if (parsed.type === "gene_id") {
      navigateToGene(parsed.value);
    } else if (parsed.type === "region") {
      navigateToRegion(parsed.seqid!, parsed.start!, parsed.end!);
    } else if (parsed.type === "chromosome") {
      navigateToChromosome(parsed.value);
    } else {
      // Symbol search - navigate to first result or show all
      if (suggestions.length > 0) {
        navigateToGene(suggestions[0].gene_id);
      } else {
        // Navigate to search results page
        navigate(`/search?q=${encodeURIComponent(query)}`);
      }
    }
    setShowSuggestions(false);
  };

  const clearSearch = () => {
    setQuery("");
    setSuggestions([]);
    setShowSuggestions(false);
    setSelectedIndex(-1);
    setError(null);
    inputRef.current?.focus();
  };

  return (
    <Paper withBorder radius="xl" p="xl">
      <Stack gap="md">
        <Box>
          <Text fw={600} size="lg">
            Search Genes & Regions
          </Text>
          <Text c="dimmed" size="sm">
            Enter gene ID, symbol, chromosome accession, or region (e.g., NC_006088.5:5000-20000)
          </Text>
        </Box>

        <Box ref={containerRef} style={{ position: "relative" }}>
          <Group gap="sm">
            <TextInput
              ref={inputRef}
              placeholder="Search genes, chromosomes, or regions..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowSuggestions(true);
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => query.length >= 2 && setShowSuggestions(true)}
              style={{ flex: 1 }}
              rightSection={
                query ? (
                  <ActionIcon variant="subtle" onClick={clearSearch}>
                    <IconX size={16} />
                  </ActionIcon>
                ) : loading ? (
                  <Loader size={16} />
                ) : null
              }
              rightSectionWidth={query ? 36 : loading ? 36 : 0}
            />
            <Button
              onClick={handleFullSearch}
              loading={loading}
              leftSection={<IconSearch size={16} />}
            >
              Search
            </Button>
          </Group>

          {/* Suggestions dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <Paper
              shadow="md"
              withBorder
              radius="md"
              mt={4}
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                zIndex: 1000,
                maxHeight: 360,
                overflow: "auto",
              }}
            >
              <Stack gap={0}>
                {suggestions.map((gene, index) => (
                  <Box
                    key={gene.gene_id}
                    p="sm"
                    style={{
                      cursor: "pointer",
                      backgroundColor:
                        index === selectedIndex ? "var(--mantine-color-gray-1)" : "transparent",
                      transition: "background-color 0.15s ease",
                    }}
                    onClick={() => navigateToGene(gene.gene_id)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Box>
                        <Text fw={500} size="sm">
                          {gene.gene_symbol || gene.gene_id}
                        </Text>
                        <Text c="dimmed" size="xs">
                          {gene.name || gene.gene_id}
                        </Text>
                      </Box>
                      <Group gap="xs" wrap="nowrap">
                        <Text size="xs" c="dimmed">
                          {gene.seqid}:{gene.start}-{gene.end}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {gene.strand}
                        </Text>
                        <IconArrowRight size={14} style={{ opacity: 0.5 }} />
                      </Group>
                    </Group>
                  </Box>
                ))}
              </Stack>
              <Box p="xs" style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}>
                <Group gap="xs">
                  <Kbd size="xs">↑↓</Kbd>
                  <Text size="xs" c="dimmed">navigate</Text>
                  <Kbd size="xs">Enter</Kbd>
                  <Text size="xs" c="dimmed">select</Text>
                  <Kbd size="xs">Esc</Kbd>
                  <Text size="xs" c="dimmed">close</Text>
                </Group>
              </Box>
            </Paper>
          )}

          {/* Loading state */}
          {loading && query.length >= 2 && suggestions.length === 0 && (
            <Paper
              shadow="md"
              withBorder
              radius="md"
              mt={4}
              p="md"
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                zIndex: 1000,
              }}
            >
              <Group justify="center" gap="sm">
                <Loader size="sm" />
                <Text size="sm" c="dimmed">Searching...</Text>
              </Group>
            </Paper>
          )}

          {/* Error state */}
          {error && (
            <Paper
              shadow="md"
              withBorder
              radius="md"
              mt={4}
              p="md"
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                zIndex: 1000,
              }}
            >
              <Text c="red" size="sm">{error}</Text>
            </Paper>
          )}
        </Box>

        {/* Quick examples */}
        <Group gap="xs">
          <Text size="xs" c="dimmed">Try:</Text>
          <Text
            size="xs"
            c="cyan"
            style={{ cursor: "pointer" }}
            onClick={() => setQuery("gene-LOC112532827")}
          >
            gene-LOC112532827
          </Text>
          <Text size="xs" c="dimmed">|</Text>
          <Text
            size="xs"
            c="cyan"
            style={{ cursor: "pointer" }}
            onClick={() => setQuery("NC_006088.5")}
          >
            NC_006088.5
          </Text>
          <Text size="xs" c="dimmed">|</Text>
          <Text
            size="xs"
            c="cyan"
            style={{ cursor: "pointer" }}
            onClick={() => setQuery("NC_006088.5:1000000-2000000")}
          >
            NC_006088.5:1000000-2000000
          </Text>
        </Group>
      </Stack>
    </Paper>
  );
}
