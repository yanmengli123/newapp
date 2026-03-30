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
  Divider,
  Button,
  Accordion,
  Table,
  ScrollArea,
  Progress,
  Tooltip,
  Alert,
} from "@mantine/core";
import { useParams, Link } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import {
  IconArrowLeft,
  IconDna,
  IconDownload,
  IconCode,
  IconSquare,
  IconDna2,
  IconApi,
  IconChartBar,
  IconGenderMale,
  IconGenderFemale,
} from "@tabler/icons-react";
import type {
  GenePageResponse,
  TranscriptResult,
  GOAnnotationsResponse,
  KEGGAnnotationsResponse,
  KEGGPathway,
} from "../lib/geneApi";
import { getGenePage, getChromosome, getGeneGOAnnotations, getGeneKEGGAnnotations } from "../lib/geneApi";
import KeggPathwaysSection from "../components/kegg/KeggPathwaysSection";
import GOTermCard from "../components/go/GOTermCard";

export default function GenePage() {
  const { geneId } = useParams<{ geneId: string }>();
  const [data, setData] = useState<GenePageResponse | null>(null);
  const [chromosomeGeneCount, setChromosomeGeneCount] = useState<number | null>(null);
  const [goAnnotations, setGoAnnotations] = useState<GOAnnotationsResponse | null>(null);
  const [keggAnnotations, setKeggAnnotations] = useState<KEGGAnnotationsResponse | null>(null);
  const [loadingAnnotations, setLoadingAnnotations] = useState(false);
  const [loading, setLoading] = useState(true);
  const [downloadingFasta, setDownloadingFasta] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!geneId) return;

    const fetchGene = async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch with sequences for full details
        const result = await getGenePage(geneId, true);
        setData(result);

        // Fetch chromosome details to get gene_count
        const chromData = await getChromosome(result.gene.seqid);
        setChromosomeGeneCount(chromData.gene_count);

        // Fetch GO and KEGG annotations
        setLoadingAnnotations(true);
        try {
          const [goData, keggData] = await Promise.all([
            getGeneGOAnnotations(geneId),
            getGeneKEGGAnnotations(geneId).catch(() => null)
          ]);

          // Transform GO data from API format to component format
          const transformedGoData = {
            ...goData,
            go_annotations: {
              biological_process: goData.items?.filter(item => item.go_namespace === 'biological_process') || [],
              molecular_function: goData.items?.filter(item => item.go_namespace === 'molecular_function') || [],
              cellular_component: goData.items?.filter(item => item.go_namespace === 'cellular_component') || [],
            }
          };
          setGoAnnotations(transformedGoData);

          // Transform KEGG data from API format to component format
          if (keggData) {
            const pathways = keggData.items || keggData.pathways || [];
            const transformedKeggData = {
              ...keggData,
              total: keggData.total || keggData.summary?.pathway_count || pathways.length,
              pathways: pathways.map((p: KEGGPathway) => ({
                ...p,
                kegg_link: p.official_link || p.kegg_link || ''
              }))
            };
            setKeggAnnotations(transformedKeggData);
          }
        } catch (annErr) {
          console.error('Failed to load annotations:', annErr);
        } finally {
          setLoadingAnnotations(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load gene");
      } finally {
        setLoading(false);
      }
    };

    fetchGene();
  }, [geneId]);

  // Download FASTA file
  const downloadFasta = useCallback(async () => {
    if (!geneId) return;

    setDownloadingFasta(true);
    try {
      const result = await getGenePage(geneId, true);

      // Build FASTA content
      let fastaContent = '';

      // Gene-level FASTA (using transcript sequences if available)
      const geneSymbol = result.gene.gene_symbol || result.gene.gene_id;
      const geneDesc = `${result.gene.seqid}:${result.gene.start}-${result.gene.end} strand=${result.gene.strand} gene=${geneSymbol}`;

      // Try to get RNA sequence from first transcript
      const transcriptWithSeq = result.transcripts.find(tx => tx.rna_sequence);

      if (transcriptWithSeq?.rna_sequence) {
        fastaContent = `>${transcriptWithSeq.transcript_acc || transcriptWithSeq.transcript_id} ${geneDesc}\n`;
        // Format sequence with 80 characters per line
        const seq = transcriptWithSeq.rna_sequence;
        for (let i = 0; i < seq.length; i += 80) {
          fastaContent += seq.slice(i, i + 80) + '\n';
        }
      } else {
        // If no sequence available, create a placeholder FASTA
        fastaContent = `>${result.gene.gene_id} ${geneDesc} [No sequence available]\nNNNN\n`;
      }

      // Create and download file
      const blob = new Blob([fastaContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${geneSymbol || result.gene.gene_id}.fa`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download FASTA:', err);
    } finally {
      setDownloadingFasta(false);
    }
  }, [geneId]);

  // Download Transcript FASTA
  const downloadTranscriptFasta = useCallback((transcript: TranscriptResult) => {
    if (!transcript || !data) return;

    const txId = transcript.transcript_acc || transcript.transcript_id;
    const geneSymbol = data?.gene.gene_symbol || data?.gene.gene_id || '';
    const geneDesc = `${transcript.seqid}:${transcript.start}-${transcript.end} strand=${transcript.strand} gene=${geneSymbol}`;

    let fastaContent: string;
    if (transcript.rna_sequence) {
      fastaContent = `>${txId} ${geneDesc}\n`;
      const seq = transcript.rna_sequence;
      for (let i = 0; i < seq.length; i += 80) {
        fastaContent += seq.slice(i, i + 80) + '\n';
      }
    } else {
      fastaContent = `>${txId} ${geneDesc} [No sequence available]\nNNNN\n`;
    }

    const blob = new Blob([fastaContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${txId}.fa`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [data]);

  // Download all Exons as FASTA (with location info only - no actual sequence from API)
  const downloadExonsFasta = useCallback((transcript: TranscriptResult) => {
    if (!transcript || !data) return;

    const geneSymbol = data.gene.gene_symbol || data.gene.gene_id;
    let fastaContent = '';

    // Add header note
    fastaContent += `# Exons for transcript: ${transcript.transcript_acc || transcript.transcript_id}\n`;
    fastaContent += `# Gene: ${geneSymbol}\n`;
    fastaContent += `# Note: Sequence not available from API - showing location coordinates only\n`;
    fastaContent += `#\n`;

    transcript.exons.forEach((exon, idx) => {
      const exonId = exon.exon_id || `exon_${idx + 1}`;
      const desc = `${exon.seqid}:${exon.start}-${exon.end} strand=${exon.strand} exon=${idx + 1} length=${exon.length}bp`;
      fastaContent += `>${exonId} ${desc}\n`;
      fastaContent += `# Coordinates: ${exon.start}-${exon.end} on ${exon.seqid}\n`;
    });

    const blob = new Blob([fastaContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${transcript.transcript_acc || transcript.transcript_id}_exons.fa`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [data]);

  // Download all CDS as FASTA (with location info only - no actual sequence from API)
  const downloadCdsFasta = useCallback((transcript: TranscriptResult) => {
    if (!transcript || !data) return;

    const geneSymbol = data.gene.gene_symbol || data.gene.gene_id;
    let fastaContent = '';

    // Add header note
    fastaContent += `# CDS Segments for transcript: ${transcript.transcript_acc || transcript.transcript_id}\n`;
    fastaContent += `# Gene: ${geneSymbol}\n`;
    fastaContent += `# Note: Sequence not available from API - showing location coordinates only\n`;
    fastaContent += `#\n`;

    transcript.cds_segments.forEach((cds, idx) => {
      const cdsId = cds.cds_id || `cds_${idx + 1}`;
      const desc = `${cds.seqid}:${cds.start}-${cds.end} strand=${cds.strand} cds=${idx + 1} phase=${cds.phase} length=${cds.length}bp`;
      fastaContent += `>${cdsId} ${desc}\n`;
      fastaContent += `# Coordinates: ${cds.start}-${cds.end} on ${cds.seqid}\n`;
    });

    const blob = new Blob([fastaContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${transcript.transcript_acc || transcript.transcript_id}_cds.fa`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [data]);

  // Download all Proteins as FASTA (with info only - no actual sequence from API)
  const downloadProteinsFasta = useCallback((transcript: TranscriptResult) => {
    if (!transcript || !data) return;

    const geneSymbol = data.gene.gene_symbol || data.gene.gene_id;
    let fastaContent = '';

    // Add header note
    fastaContent += `# Proteins for transcript: ${transcript.transcript_acc || transcript.transcript_id}\n`;
    fastaContent += `# Gene: ${geneSymbol}\n`;
    fastaContent += `# Note: Sequence not available from API - showing protein info only\n`;
    fastaContent += `#\n`;

    if (transcript.proteins.length === 0) {
      fastaContent += `# No proteins available for this transcript\n`;
    }

    transcript.proteins.forEach((protein) => {
      const protId = protein.protein_id;
      const desc = `gene=${geneSymbol} protein_length=${protein.protein_length || 'N/A'}aa cds_length=${protein.cds_length || 'N/A'}bp`;
      fastaContent += `>${protId} ${desc}\n`;
      if (protein.protein_description) {
        fastaContent += `# Description: ${protein.protein_description}\n`;
      }
    });

    const blob = new Blob([fastaContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${transcript.transcript_acc || transcript.transcript_id}_proteins.fa`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [data]);

  if (loading) {
    return (
      <Paper withBorder radius="xl" p="xl">
        <Group justify="center" gap="md">
          <Loader size="md" />
          <Text c="dimmed">Loading gene information...</Text>
        </Group>
      </Paper>
    );
  }

  if (error || !data) {
    return (
      <Paper withBorder radius="xl" p="xl">
        <Text c="red">Error: {error || "Gene not found"}</Text>
        <Link to="/">
          <Text c="cyan" mt="md">
            ← Back to Home
          </Text>
        </Link>
      </Paper>
    );
  }

  const { gene, chromosome, transcript_count, transcripts } = data;

  return (
    <Stack gap="lg">
      {/* Back link */}
      <Link to="/" style={{ textDecoration: "none" }}>
        <Group gap="xs" c="cyan">
          <IconArrowLeft size={16} />
          <Text size="sm">Back to Search</Text>
        </Group>
      </Link>

      {/* Gene Header */}
      <Paper withBorder radius="xl" p="xl">
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <Box>
              <Group gap="sm">
                <IconDna size={28} color="var(--mantine-color-cyan-6)" />
                <Title order={2}>{gene.gene_symbol || gene.gene_id}</Title>
                <Badge color="cyan" variant="light">
                  {gene.gene_type || gene.biotype || "gene"}
                </Badge>
                {(gene.is_canonical === true) && (
                  <Badge color="green" variant="filled" size="sm">
                    Canonical
                  </Badge>
                )}
                {(gene.is_canonical === false) && (
                  <Badge color="gray" variant="light" size="sm">
                    Non-canonical
                  </Badge>
                )}
              </Group>
              <Text c="dimmed" size="sm" mt={4}>
                {gene.name || gene.gene_id}
              </Text>
              {gene.aliases && gene.aliases.length > 0 && (
                <Group gap={4} mt={4}>
                  <Text size="xs" c="dimmed">Aliases:</Text>
                  {gene.aliases.map((alias, i) => (
                    <Badge
                      key={i}
                      size="xs"
                      variant={alias.is_primary ? "filled" : "light"}
                      color={alias.is_primary ? "cyan" : "gray"}
                    >
                      {alias.alias}{alias.alias_type ? ` (${alias.alias_type})` : ""}
                    </Badge>
                  ))}
                </Group>
              )}
              {/* Cross-reference IDs */}
              <Group gap={4} mt={4}>
                {gene.ncbi_gene_id && (
                  <Badge size="xs" variant="outline" color="gray">
                    NCBI: {gene.ncbi_gene_id}
                  </Badge>
                )}
                {gene.ensembl_gene_id && (
                  <Badge size="xs" variant="outline" color="gray">
                    Ensembl: {gene.ensembl_gene_id}
                  </Badge>
                )}
                {gene.kegg_gene_id && (
                  <Badge size="xs" variant="outline" color="gray">
                    KEGG: {gene.kegg_gene_id}
                  </Badge>
                )}
              </Group>
            </Box>
            <Group gap="sm">
              <Button
                variant="light"
                leftSection={<IconDownload size={16} />}
                loading={downloadingFasta}
                onClick={downloadFasta}
              >
                Download FASTA
              </Button>
              <Badge
                size="lg"
                variant="outline"
                color={gene.strand === "+" ? "teal" : "orange"}
              >
                {gene.strand === "+" ? "Forward (+)" : "Reverse (-)"}
              </Badge>
            </Group>
          </Group>

          <Divider />

          <Group grow>
            <Box>
              <Text size="xs" c="dimmed" tt="uppercase">
                Gene ID
              </Text>
              <Text fw={500}>{gene.gene_id}</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed" tt="uppercase">
                Chromosome
              </Text>
              <Link
                to={`/chromosome/${gene.seqid}`}
                style={{ textDecoration: "none" }}
              >
                <Text fw={500} c="cyan">
                  {gene.seqid}
                </Text>
              </Link>
            </Box>
            <Box>
              <Text size="xs" c="dimmed" tt="uppercase">
                Location
              </Text>
              <Text fw={500}>
                {gene.start.toLocaleString()} - {gene.end.toLocaleString()}
              </Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed" tt="uppercase">
                Length
              </Text>
              <Text fw={500}>{gene.length.toLocaleString()} bp</Text>
            </Box>
          </Group>
        </Stack>
      </Paper>

      {/* Chromosome Info */}
      <Paper withBorder radius="xl" p="xl">
        <Title order={4} mb="md">
          Chromosome Information
        </Title>
        <Group grow>
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase">
              Chromosome
            </Text>
            <Link
              to={`/chromosome/${chromosome.seqid}`}
              style={{ textDecoration: "none" }}
            >
              <Text fw={500} c="cyan">
                {chromosome.chr_name || chromosome.seqid}
              </Text>
            </Link>
          </Box>
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase">
              Length
            </Text>
            <Text fw={500}>{chromosome.length.toLocaleString()} bp</Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase">
              Gene Count
            </Text>
            <Text fw={500}>{chromosomeGeneCount?.toLocaleString() || "N/A"}</Text>
          </Box>
        </Group>
      </Paper>

      {/* GO Annotations */}
      <Paper withBorder radius="xl" p="xl">
        <Group gap="sm" mb="md">
          <IconApi size={20} color="var(--mantine-color-cyan-6)" />
          <Title order={4}>GO Annotations</Title>
          {loadingAnnotations && <Loader size="xs" />}
          {goAnnotations?.summary && (
            <Badge variant="light" color="gray" size="sm">
              {goAnnotations.summary.total} terms
            </Badge>
          )}
          {goAnnotations?.ncbi_gene_id && (
            <Badge variant="outline" color="gray" size="xs">
              NCBI: {goAnnotations.ncbi_gene_id}
            </Badge>
          )}
          {goAnnotations?.ensembl_gene_id && (
            <Badge variant="outline" color="gray" size="xs">
              Ensembl: {goAnnotations.ensembl_gene_id}
            </Badge>
          )}
        </Group>

        {!goAnnotations || !goAnnotations.items?.length ? (
          <Text c="dimmed" size="sm">No GO annotations available</Text>
        ) : (
          <Accordion variant="separated" radius="md" defaultValue="biological_process">
            {/* Biological Process */}
            {goAnnotations.items.filter(i => i.go_namespace === "biological_process").length > 0 && (
              <Accordion.Item value="biological_process">
                <Accordion.Control
                  bg="var(--mantine-color-blue-0)"
                  style={{ borderRadius: 8 }}
                >
                  <Group gap="xs">
                    <Text size="sm" fw={600} c="blue">Biological Process</Text>
                    <Badge color="blue" variant="light" size="xs">
                      {goAnnotations.items.filter(i => i.go_namespace === "biological_process").length}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="sm">
                    {goAnnotations.items
                      .filter(i => i.go_namespace === "biological_process")
                      .map(item => (
                        <GOTermCard key={item.go_id} item={item} />
                      ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            )}

            {/* Molecular Function */}
            {goAnnotations.items.filter(i => i.go_namespace === "molecular_function").length > 0 && (
              <Accordion.Item value="molecular_function">
                <Accordion.Control
                  bg="var(--mantine-color-green-0)"
                  style={{ borderRadius: 8 }}
                >
                  <Group gap="xs">
                    <Text size="sm" fw={600} c="green">Molecular Function</Text>
                    <Badge color="green" variant="light" size="xs">
                      {goAnnotations.items.filter(i => i.go_namespace === "molecular_function").length}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="sm">
                    {goAnnotations.items
                      .filter(i => i.go_namespace === "molecular_function")
                      .map(item => (
                        <GOTermCard key={item.go_id} item={item} />
                      ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            )}

            {/* Cellular Component */}
            {goAnnotations.items.filter(i => i.go_namespace === "cellular_component").length > 0 && (
              <Accordion.Item value="cellular_component">
                <Accordion.Control
                  bg="var(--mantine-color-orange-0)"
                  style={{ borderRadius: 8 }}
                >
                  <Group gap="xs">
                    <Text size="sm" fw={600} c="orange">Cellular Component</Text>
                    <Badge color="orange" variant="light" size="xs">
                      {goAnnotations.items.filter(i => i.go_namespace === "cellular_component").length}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="sm">
                    {goAnnotations.items
                      .filter(i => i.go_namespace === "cellular_component")
                      .map(item => (
                        <GOTermCard key={item.go_id} item={item} />
                      ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            )}
          </Accordion>
        )}
      </Paper>

      {/* Expression (normcount — DESeq2, day_deseq2_36 dataset) */}
      {data?.expression ? (
        <Paper withBorder radius="xl" p="xl">
          <Group gap="sm" mb="md">
            <IconChartBar size={20} color="var(--mantine-color-violet-6)" />
            <Title order={4}>Expression</Title>
            <Badge variant="light" color="violet" size="sm">
              {data.expression.samples?.length ?? 0} samples
            </Badge>
            {data.expression.metric && (
              <Badge variant="outline" color="violet" size="sm">
                {data.expression.metric.metric_name}
              </Badge>
            )}
            {data.expression.metric?.unit_desc && (
              <Badge variant="light" color="violet" size="sm">
                {data.expression.metric.unit_desc}
              </Badge>
            )}
            {data.expression.dataset && (
              <Tooltip label={data.expression.dataset.description ?? ""}>
                <Badge variant="dot" color="gray" size="sm" style={{ cursor: "help" }}>
                  {data.expression.dataset.dataset_name}
                </Badge>
              </Tooltip>
            )}
            {data.expression.dataset?.sample_scope && (
              <Badge variant="outline" color="gray" size="sm">
                {data.expression.dataset.sample_scope}
              </Badge>
            )}
            {data.expression.dataset?.normalization_family && (
              <Badge variant="light" color="gray" size="sm">
                {data.expression.dataset.normalization_family}
              </Badge>
            )}
            {data.expression.status === "available" && data.expression.summary && (
              <Badge variant="light" color="gray" size="sm">
                Mean: {data.expression.summary.mean_normcount?.toFixed(2) ?? "0.00"}
              </Badge>
            )}
            {data.expression.status === "available" && data.expression.summary && (
              <Badge
                variant="light"
                color={
                  data.expression.summary.sex_bias === "Female_higher"
                    ? "pink"
                    : data.expression.summary.sex_bias === "Male_higher"
                      ? "blue"
                      : "gray"
                }
                size="sm"
              >
                {data.expression.summary.sex_bias?.replace(/_/g, " ") ?? "Unknown"}
              </Badge>
            )}
          </Group>

          {/* No data message */}
          {data.expression.status === "no_data" && (
            <Alert
              color="gray"
              variant="light"
              title="No expression data"
              icon={<IconChartBar size={16} />}
            >
              This gene does not have expression profiling data in the current dataset.
            </Alert>
          )}

          {/* Zero expression warning */}
          {data.expression.status === "zero_expression" && (
            <Alert
              color="yellow"
              variant="light"
              title="Zero expression"
              mb="md"
            >
              All samples show zero expression (normcount = 0) for this gene — it may not be
              expressed in the studied developmental stages.
            </Alert>
          )}

          {/* Summary stats row */}
          {data.expression.status === "available" && data.expression.summary && (
            <Group gap="xl" mb="md">
              <Box>
                <Text size="xs" c="dimmed">Max NormCount</Text>
                <Text size="sm" fw={600}>{data.expression.summary.max_normcount?.toFixed(4) ?? "—"}</Text>
                <Text size="xs" c="dimmed">{data.expression.summary.max_normcount_sample ?? "—"}</Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">Min NormCount</Text>
                <Text size="sm" fw={600}>{data.expression.summary.min_normcount?.toFixed(4) ?? "—"}</Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">Mean NormCount</Text>
                <Text size="sm" fw={600}>{data.expression.summary.mean_normcount?.toFixed(4) ?? "—"}</Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">Std NormCount</Text>
                <Text size="sm" fw={600}>{data.expression.summary.std_normcount?.toFixed(4) ?? "—"}</Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">Expressed</Text>
                <Text size="sm" fw={600}>
                  {data.expression.summary.expressed_samples ?? 0}/{data.expression.samples?.length ?? 0}
                </Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">Zero Samples</Text>
                <Text size="sm" fw={600}>{data.expression.summary.zero_samples ?? 0}</Text>
              </Box>
            </Group>
          )}

          {/* Expression table */}
          {data.expression.status !== "no_data" && data.expression.samples && (
            <ScrollArea>
              <Table striped highlightOnHover withTableBorder withColumnBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Sample</Table.Th>
                    <Table.Th>Stage</Table.Th>
                    <Table.Th>Stage Label</Table.Th>
                    <Table.Th>Sex</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>NormCount</Table.Th>
                    <Table.Th style={{ minWidth: 120 }}>Relative Level</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.expression.samples.map(sample => {
                    const maxNc = data.expression!.summary?.max_normcount || 1;
                    const ncVal = sample.normcount ?? 0;
                    const pct = maxNc > 0 ? Math.min((ncVal / maxNc) * 100, 100) : 0;
                    const isZero = ncVal === 0;
                    return (
                      <Table.Tr key={sample.sample_id} style={isZero ? { opacity: 0.5 } : undefined}>
                        <Table.Td>
                          <Text size="sm" fw={500}>{sample.sample_name ?? "—"}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge variant="light" color="gray" size="xs">
                            {sample.stage ?? "—"}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">{sample.stage_label ?? "—"}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4}>
                            {sample.sex === "Male" ? (
                              <IconGenderMale size={14} color="var(--mantine-color-blue-6)" />
                            ) : (
                              <IconGenderFemale size={14} color="var(--mantine-color-pink-6)" />
                            )}
                            <Text size="xs" c="dimmed">{sample.sex ?? "—"}</Text>
                            <Text size="xs" c="dimmed">R{sample.replicate ?? "—"}</Text>
                          </Group>
                        </Table.Td>
                        <Table.Td style={{ textAlign: "right" }}>
                          <Text
                            size="sm"
                            fw={500}
                            style={{ fontVariantNumeric: "tabular-nums", color: isZero ? "dimmed" : undefined }}
                          >
                            {ncVal.toFixed(4)}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Tooltip label={`${pct.toFixed(1)}% of max`}>
                            <Progress
                              value={pct}
                              color={isZero ? "gray" : pct > 80 ? "violet" : pct > 30 ? "indigo" : "gray"}
                              size="sm"
                              radius="xl"
                              style={{ minWidth: 100 }}
                            />
                          </Tooltip>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </Paper>
      ) : null}

      {/* KEGG Pathways (Interactive KGML Viewer) */}
      {keggAnnotations && (keggAnnotations.pathways?.length || keggAnnotations.items?.length) ? (
        <KeggPathwaysSection
          keggAnnotations={keggAnnotations}
          geneId={data?.gene.gene_id || geneId || ""}
          kegg_gene_id={data?.gene.kegg_gene_id}
        />
      ) : null}

      {/* Transcripts */}
      <Paper withBorder radius="xl" p="xl">
        <Title order={4} mb="md">
          Transcripts ({transcript_count})
        </Title>

        {transcripts.length === 0 ? (
          <Text c="dimmed">No transcripts found</Text>
        ) : (
          <Accordion variant="separated" radius="md">
            {transcripts.map((tx) => (
              <Accordion.Item key={tx.transcript_id} value={tx.transcript_id}>
                <Accordion.Control>
                  <Group justify="space-between" wrap="nowrap" style={{ width: '100%' }}>
                    <Box>
                      <Group gap="xs">
                        <Text fw={500} size="sm">
                          {tx.transcript_acc || tx.transcript_id}
                        </Text>
                        <Badge size="xs" variant="light">
                          {tx.feature_type}
                        </Badge>
                        {tx.rna_sequence && (
                          <Badge size="xs" color="green" variant="light">
                            RNA
                          </Badge>
                        )}
                      </Group>
                      <Text c="dimmed" size="xs">
                        {tx.product || "-"}
                      </Text>
                    </Box>
                    <Group gap="md" wrap="nowrap">
                      <Box style={{ textAlign: "right" }}>
                        <Text size="xs" c="dimmed">
                          {tx.seqid}:{tx.start.toLocaleString()}-{tx.end.toLocaleString()}
                        </Text>
                        <Group gap="xs">
                          <Badge size="xs" variant="outline">
                            {tx.exon_count} exons
                          </Badge>
                          <Badge size="xs" variant="outline">
                            {tx.cds_segment_count} CDS
                          </Badge>
                          <Badge size="xs" variant="outline">
                            {tx.protein_count} proteins
                          </Badge>
                        </Group>
                      </Box>
                    </Group>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="md">
                    {/* Transcript Info */}
                    <Box>
                      <Title order={5} mb="sm">Transcript Information</Title>
                      <Group grow>
                        <Box>
                          <Text size="xs" c="dimmed" tt="uppercase">Transcript ID</Text>
                          <Text fw={500} size="sm">{tx.transcript_id}</Text>
                        </Box>
                        <Box>
                          <Text size="xs" c="dimmed" tt="uppercase">Transcript Accession</Text>
                          <Text fw={500} size="sm">{tx.transcript_acc || "N/A"}</Text>
                        </Box>
                        <Box>
                          <Text size="xs" c="dimmed" tt="uppercase">Length</Text>
                          <Text fw={500} size="sm">{tx.length.toLocaleString()} bp</Text>
                        </Box>
                        <Box>
                          <Text size="xs" c="dimmed" tt="uppercase">Strand</Text>
                          <Badge size="sm" variant="outline" color={tx.strand === "+" ? "teal" : "orange"}>
                            {tx.strand}
                          </Badge>
                        </Box>
                      </Group>
                      {tx.product && (
                        <Box mt="sm">
                          <Text size="xs" c="dimmed" tt="uppercase">Product</Text>
                          <Text size="sm">{tx.product}</Text>
                        </Box>
                      )}
                      <Button
                        variant="light"
                        size="xs"
                        mt="sm"
                        leftSection={<IconDownload size={14} />}
                        onClick={() => downloadTranscriptFasta(tx)}
                      >
                        Download Transcript FASTA
                      </Button>
                    </Box>

                    <Divider />

                    {/* Exons */}
                    <Box>
                      <Group justify="space-between" mb="sm">
                        <Group gap="xs">
                          <IconDna2 size={16} />
                          <Title order={5}>Exons ({tx.exon_count})</Title>
                        </Group>
                        <Button
                          variant="light"
                          size="xs"
                          leftSection={<IconDownload size={14} />}
                          onClick={() => downloadExonsFasta(tx)}
                        >
                          Export Locs
                        </Button>
                      </Group>
                      <Stack gap="xs">
                        {tx.exons.map((exon, idx) => (
                          <Group key={exon.exon_id} justify="space-between">
                            <Text size="xs">Exon {idx + 1}</Text>
                            <Text size="xs" c="dimmed">
                              {exon.seqid}:{exon.start.toLocaleString()}-{exon.end.toLocaleString()} ({exon.length.toLocaleString()} bp)
                            </Text>
                          </Group>
                        ))}
                      </Stack>
                    </Box>

                    <Divider />

                    {/* CDS Segments */}
                    <Box>
                      <Group justify="space-between" mb="sm">
                        <Group gap="xs">
                          <IconCode size={16} />
                          <Title order={5}>CDS Segments ({tx.cds_segment_count})</Title>
                        </Group>
                        <Button
                          variant="light"
                          size="xs"
                          leftSection={<IconDownload size={14} />}
                          onClick={() => downloadCdsFasta(tx)}
                        >
                          Export Locs
                        </Button>
                      </Group>
                      <Stack gap="xs">
                        {tx.cds_segments.map((cds, idx) => (
                          <Group key={cds.cds_id} justify="space-between" wrap="wrap">
                            <Group gap="xs">
                              <Text size="xs">CDS {idx + 1}</Text>
                              {cds.protein_id && (
                                <Badge size="xs" variant="light">{cds.protein_id}</Badge>
                              )}
                            </Group>
                            <Text size="xs" c="dimmed">
                              {cds.seqid}:{cds.start.toLocaleString()}-{cds.end.toLocaleString()} (phase: {cds.phase})
                            </Text>
                          </Group>
                        ))}
                      </Stack>
                    </Box>

                    <Divider />

                    {/* Proteins */}
                    <Box>
                      <Group justify="space-between" mb="sm">
                        <Group gap="xs">
                          <IconSquare size={16} />
                          <Title order={5}>Proteins ({tx.protein_count})</Title>
                        </Group>
                        <Button
                          variant="light"
                          size="xs"
                          leftSection={<IconDownload size={14} />}
                          onClick={() => downloadProteinsFasta(tx)}
                        >
                          Export Info
                        </Button>
                      </Group>
                      {tx.proteins.length > 0 ? (
                        <Stack gap="sm">
                          {tx.proteins.map((protein) => (
                            <Card key={protein.protein_id} withBorder padding="sm" radius="md">
                              <Group grow>
                                <Box>
                                  <Text size="xs" c="dimmed" tt="uppercase">Protein ID</Text>
                                  <Text fw={500} size="sm">{protein.protein_id}</Text>
                                </Box>
                                <Box>
                                  <Text size="xs" c="dimmed" tt="uppercase">CDS Length</Text>
                                  <Text fw={500} size="sm">{protein.cds_length ? `${protein.cds_length} bp` : "N/A"}</Text>
                                </Box>
                                <Box>
                                  <Text size="xs" c="dimmed" tt="uppercase">Protein Length</Text>
                                  <Text fw={500} size="sm">{protein.protein_length ? `${protein.protein_length} aa` : "N/A"}</Text>
                                </Box>
                              </Group>
                              {protein.protein_description && (
                                <Box mt="sm">
                                  <Text size="xs" c="dimmed" tt="uppercase">Description</Text>
                                  <Text size="xs">{protein.protein_description}</Text>
                                </Box>
                              )}
                            </Card>
                          ))}
                        </Stack>
                      ) : (
                        <Text c="dimmed" size="sm">No protein information available</Text>
                      )}
                    </Box>

                    {/* RNA Sequence */}
                    {tx.rna_sequence && (
                      <>
                        <Divider />
                        <Box>
                          <Group gap="xs" mb="sm">
                            <IconDna2 size={16} />
                            <Title order={5}>RNA Sequence</Title>
                          </Group>
                          <Paper withBorder p="sm" radius="md" bg="gray.0">
                            <Text
                              size="xs"
                              ff="monospace"
                              style={{ wordBreak: "break-all", whiteSpace: "pre-wrap" }}
                            >
                              {tx.rna_sequence}
                            </Text>
                          </Paper>
                          <Text size="xs" c="dimmed" mt="xs">
                            Total length: {tx.rna_length?.toLocaleString()} bp
                          </Text>
                        </Box>
                      </>
                    )}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}
      </Paper>

      {/* KEGG Pathway Image Modal */}
      {/* (已迁移到 KeggInteractiveViewer，通过 KeggPathwaysSection 打开) */}
    </Stack>
  );
}
