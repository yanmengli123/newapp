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
  Anchor,
  Modal,
  Image,
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
  IconLink,
  IconEye,
} from "@tabler/icons-react";
import type { GenePageResponse, TranscriptResult, GOAnnotationsResponse, KEGGAnnotationsResponse, KEGGPathway } from "../lib/geneApi";
import { getGenePage, getChromosome, getGeneGOAnnotations, getGeneKEGGAnnotations } from "../lib/geneApi";

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
  const [pathwayModalOpen, setPathwayModalOpen] = useState(false);
  const [selectedPathway, setSelectedPathway] = useState<{id: string; name: string} | null>(null);

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

  // Open pathway image modal
  const viewPathwayImage = useCallback((pathwayId: string, pathwayName: string) => {
    setSelectedPathway({ id: pathwayId, name: pathwayName });
    setPathwayModalOpen(true);
  }, []);

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
                  {gene.biotype || "gene"}
                </Badge>
              </Group>
              <Text c="dimmed" size="sm" mt={4}>
                {gene.name || gene.gene_id}
              </Text>
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
        </Group>

        {!goAnnotations || goAnnotations.total === 0 ? (
          <Text c="dimmed" size="sm">No GO annotations available</Text>
        ) : (
          <Stack gap="md">
            {/* Extract go_annotations safely */}
            {(() => {
              const go = goAnnotations.go_annotations;
              if (!go) return <Text c="dimmed">No GO annotations available</Text>;

              return (
                <>
            {/* Biological Process */}
            {go.biological_process.length > 0 && (
              <Box>
                <Text size="sm" fw={500} mb="xs" c="blue">
                  Biological Process ({go.biological_process.length})
                </Text>
                <Group gap="xs">
                  {go.biological_process.slice(0, 10).map((go) => (
                    <Anchor
                      key={go.go_id}
                      href={`https://amigo.geneontology.org/amigo/term/${go.go_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="xs"
                    >
                      <Badge variant="light" color="blue" size="sm">
                        {go.go_id} {go.go_name}
                      </Badge>
                    </Anchor>
                  ))}
                  {go.biological_process.length > 10 && (
                    <Text size="xs" c="dimmed">+{go.biological_process.length - 10} more</Text>
                  )}
                </Group>
              </Box>
            )}

            {/* Molecular Function */}
            {go.molecular_function.length > 0 && (
              <Box>
                <Text size="sm" fw={500} mb="xs" c="green">
                  Molecular Function ({go.molecular_function.length})
                </Text>
                <Group gap="xs">
                  {go.molecular_function.slice(0, 10).map((go) => (
                    <Anchor
                      key={go.go_id}
                      href={`https://amigo.geneontology.org/amigo/term/${go.go_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="xs"
                    >
                      <Badge variant="light" color="green" size="sm">
                        {go.go_id} {go.go_name}
                      </Badge>
                    </Anchor>
                  ))}
                  {go.molecular_function.length > 10 && (
                    <Text size="xs" c="dimmed">+{go.molecular_function.length - 10} more</Text>
                  )}
                </Group>
              </Box>
            )}

            {/* Cellular Component */}
            {go.cellular_component.length > 0 && (
              <Box>
                <Text size="sm" fw={500} mb="xs" c="orange">
                  Cellular Component ({go.cellular_component.length})
                </Text>
                <Group gap="xs">
                  {go.cellular_component.slice(0, 10).map((go) => (
                    <Anchor
                      key={go.go_id}
                      href={`https://amigo.geneontology.org/amigo/term/${go.go_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="xs"
                    >
                      <Badge variant="light" color="orange" size="sm">
                        {go.go_id} {go.go_name}
                      </Badge>
                    </Anchor>
                  ))}
                  {go.cellular_component.length > 10 && (
                    <Text size="xs" c="dimmed">+{go.cellular_component.length - 10} more</Text>
                  )}
                </Group>
              </Box>
            )}
                </>
              );
            })()}
          </Stack>
        )}
      </Paper>

      {/* KEGG Pathways */}
      {keggAnnotations && keggAnnotations.pathways && keggAnnotations.pathways.length > 0 && (
        <Paper withBorder radius="xl" p="xl">
          <Group gap="sm" mb="md">
            <IconLink size={20} color="var(--mantine-color-teal-6)" />
            <Title order={4}>KEGG Pathways</Title>
          </Group>

          <Stack gap="sm">
            {keggAnnotations.pathways.map((pathway) => (
              <Card key={pathway.pathway_id} withBorder padding="sm" radius="md">
                <Group justify="space-between">
                  <Box>
                    <Text size="sm" fw={500}>
                      {pathway.pathway_name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {pathway.pathway_id}
                    </Text>
                  </Box>
                  <Group gap="xs">
                    <Button
                      variant="light"
                      size="xs"
                      leftSection={<IconEye size={14} />}
                      onClick={() => viewPathwayImage(pathway.pathway_id, pathway.pathway_name)}
                    >
                      View Pathway
                    </Button>
                    <Anchor
                      href={pathway.kegg_link}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Badge variant="light" color="teal">
                        KEGG
                      </Badge>
                    </Anchor>
                  </Group>
                </Group>
              </Card>
            ))}
          </Stack>
        </Paper>
      )}

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
      <Modal
        opened={pathwayModalOpen}
        onClose={() => setPathwayModalOpen(false)}
        title={selectedPathway?.name || "KEGG Pathway"}
        size="xl"
        centered
      >
        {selectedPathway && (
          <Box>
            <Image
              src={`http://localhost:8000/kegg-images/${selectedPathway.id}.png`}
              alt={selectedPathway.name}
              radius="md"
              mah={600}
              style={{ background: '#f8f9fa' }}
            />
            <Text c="dimmed" size="xs" mt="xs">
              If image is not available,{' '}
              <Anchor
                href={`https://www.kegg.jp/kegg-bin/show_pathway?map=${selectedPathway.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                view on KEGG website
              </Anchor>
            </Text>
            <Group justify="space-between" mt="md">
              <Text size="xs" c="dimmed">
                Pathway ID: {selectedPathway.id}
              </Text>
              <Anchor
                href={`https://www.kegg.jp/kegg-bin/show_pathway?map=${selectedPathway.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="light" size="xs">
                  Open in KEGG
                </Button>
              </Anchor>
            </Group>
          </Box>
        )}
      </Modal>
    </Stack>
  );
}
