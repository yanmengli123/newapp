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
  Tooltip,
  Tabs,
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
  IconInfoCircle,
  IconClipboardCopy,
  IconExternalLink,
} from "@tabler/icons-react";
import type {
  GenePageResponse,
  TranscriptResult,
} from "../lib/geneApi";
import { getGenePage, getChromosome } from "../lib/geneApi";
import KeggPathwaysSection from "../components/kegg/KeggPathwaysSection";
import GOTermCard from "../components/go/GOTermCard";
import ExpressionSection from "../components/expression/ExpressionSection";
import GeneStructurePlot from "../components/gene/GeneStructurePlot";

// NC_ accession → chr ID (same mapping as JBrowsePage)
const NC_TO_CHR: [string, string][] = [
  ["NC_006088.5", "chr1"], ["NC_006089.5", "chr2"], ["NC_006090.5", "chr3"],
  ["NC_006091.5", "chr4"], ["NC_006092.5", "chr5"], ["NC_006093.5", "chr6"],
  ["NC_006094.5", "chr7"], ["NC_006095.5", "chr8"], ["NC_006096.5", "chr9"],
  ["NC_006097.5", "chr10"], ["NC_006098.5", "chr11"], ["NC_006099.5", "chr12"],
  ["NC_006100.5", "chr13"], ["NC_006101.5", "chr14"], ["NC_006102.5", "chr15"],
  ["NC_006103.5", "chr16"], ["NC_006104.5", "chr17"], ["NC_006105.5", "chr18"],
  ["NC_006106.5", "chr19"], ["NC_006107.5", "chr20"], ["NC_006108.5", "chr21"],
  ["NC_006109.5", "chr22"], ["NC_006110.5", "chr23"], ["NC_006111.5", "chr24"],
  ["NC_006112.4", "chr25"], ["NC_006113.5", "chr26"], ["NC_006114.5", "chr27"],
  ["NC_006115.5", "chr28"], ["NC_008465.4", "chr29"], ["NC_028739.2", "chr30"],
  ["NC_028740.2", "chr31"], ["NC_006119.4", "chr32"], ["NC_006126.5", "chrW"],
  ["NC_006127.5", "chrZ"], ["NC_040902.1", "chrMT"],
];

function toChrId(seqid: string): string {
  if (seqid.startsWith("chr")) return seqid;
  return NC_TO_CHR.find(([k]) => k === seqid)?.[1] ?? seqid;
}

// ── Protein structure access panel ─────────────────────────────────────────────

interface ProteinStructureAccessPanelProps {
  proteinId: string;
  proteinSequence: string;
  geneSymbol: string;
  transcriptAcc: string | null;
}

/** Build FASTA text for a protein */
function buildProteinFasta(
  proteinId: string,
  proteinSequence: string,
  geneSymbol: string,
  transcriptAcc: string | null,
): string {
  const seq = proteinSequence.replace(/\s+/g, "").trim();
  const header = `>${proteinId} gene=${geneSymbol} transcript=${transcriptAcc || "unknown"}`;
  const wrapped = seq.match(/.{1,60}/g)?.join("\n") || seq;
  return `${header}\n${wrapped}\n`;
}

/** Check if a protein_id looks like a RefSeq accession (for NCBI link) */
function isRefSeqAccession(proteinId: string): boolean {
  return /^(NP_|XP_|YP_|WP_|AP_)\d+/i.test(proteinId.trim());
}

/** ProteinStructureAccessPanel — AlphaFold引导 + RCSB PDB教程 + 条件NCBI按钮 */
function ProteinStructureAccessPanel({
  proteinId,
  proteinSequence,
  geneSymbol,
  transcriptAcc,
}: ProteinStructureAccessPanelProps) {
  if (!proteinSequence || proteinSequence.replace(/\s+/g, "").trim().length === 0) {
    return null;
  }

  const cleanSeq = proteinSequence.replace(/\s+/g, "").trim();
  const fastaText = buildProteinFasta(proteinId, proteinSequence, geneSymbol, transcriptAcc);
  const canShowNcbi = isRefSeqAccession(proteinId);
  // TODO: replace with actual analytics call
  // analytics.track("structure_access_view", { protein_id: proteinId, gene_symbol: geneSymbol });

  return (
    <Box mt="sm">
      <Divider label="Structure Prediction" labelPosition="left" />
      <Stack gap="xs" mt="xs">
        {/* Step instructions */}
        <Alert
          variant="light"
          color="blue"
          title="How to predict 3D structure"
          icon={<IconInfoCircle size={14} />}
          py="xs"
        >
          <Text size="xs" mb={4}>
            <strong>Step 1:</strong> Copy the protein sequence below.
          </Text>
          <Text size="xs" mb={4}>
            <strong>Step 2:</strong> Go to AlphaFold Server at&nbsp;
            <Text component="span" ff="monospace" size="xs">
              https://alphafoldserver.com/
            </Text>
          </Text>
          <Text size="xs" mb={4}>
            <strong>Step 3:</strong> Paste the sequence and your email.
          </Text>
          <Text size="xs">
            <strong>Step 4:</strong> Wait for the result (email notification).
          </Text>
        </Alert>

        {/* Action buttons */}
        <Group gap="xs">
          <Button
            component="a"
            href="https://alphafoldserver.com/"
            target="_blank"
            rel="noopener noreferrer"
            size="xs"
            color="blue"
            variant="filled"
            leftSection={<IconExternalLink size={13} />}
          >
            AlphaFold Server
          </Button>

          <Button
            component="a"
            href="https://www.rcsb.org/"
            target="_blank"
            rel="noopener noreferrer"
            size="xs"
            color="orange"
            variant="light"
            leftSection={<IconExternalLink size={13} />}
          >
            RCSB PDB
          </Button>

          {canShowNcbi && (
            <Button
              component="a"
              href={`https://www.ncbi.nlm.nih.gov/protein/${proteinId}`}
              target="_blank"
              rel="noopener noreferrer"
              size="xs"
              variant="light"
              color="green"
              leftSection={<IconExternalLink size={13} />}
            >
              NCBI Protein
            </Button>
          )}
        </Group>

        {/* Protein sequence display */}
        <Alert
          variant="light"
          color="teal"
          title="Protein sequence — copy & paste to RCSB PDB"
          icon={<IconClipboardCopy size={14} />}
          py="xs"
        >
          <Text
            component="pre"
            size="xs"
            ff="monospace"
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0, background: "transparent" }}
          >
            {cleanSeq}
          </Text>
          <Group gap="xs" mt="xs">
            <Button
              size="xs"
              variant="light"
              color="teal"
              leftSection={<IconClipboardCopy size={12} />}
              onClick={() => navigator.clipboard.writeText(cleanSeq).catch(() => {})}
            >
              Copy Sequence
            </Button>
            <Button
              size="xs"
              variant="light"
              color="gray"
              leftSection={<IconClipboardCopy size={12} />}
              onClick={() => navigator.clipboard.writeText(fastaText).catch(() => {})}
            >
              Copy FASTA
            </Button>
            <Text size="xs" c="dimmed">
              {cleanSeq.length} aa
            </Text>
          </Group>
        </Alert>

        {/* RCSB PDB tutorial */}
        <Alert
          variant="light"
          color="orange"
          title="RCSB PDB — How to search by protein sequence"
          icon={<IconInfoCircle size={14} />}
          py="xs"
        >
          <Text size="xs" mb={4}>
            <strong>①</strong> 打开 RCSB PDB：<Text component="span" ff="monospace" size="xs">https://www.rcsb.org</Text>
          </Text>
          <Text size="xs" mb={4}>
            <strong>②</strong> 点击上方蓝色导航栏 <Text component="span" ff="monospace" size="xs">Sequence Similarity</Text> 标签（不要用 Attribute Search）
          </Text>
          <Text size="xs" mb={4}>
            <strong>③</strong> 在序列输入框中粘贴上方蛋白序列（仅一字母序列，不要带 <Text component="span" ff="monospace" size="xs">&gt;</Text> 标题行）
          </Text>
          <Text size="xs" mb={4}>
            <strong>④</strong> 勾选 <Text component="span" ff="monospace" size="xs">Include CSM</Text>（可同时搜索实验结构 + AlphaFold/ModelArchive 计算模型）
          </Text>
          <Text size="xs" mb={4}>
            <strong>⑤</strong> 点击 <Text component="span" ff="monospace" size="xs">Search</Text>，从结果列表中找到目标蛋白对应结构，点击查看 3D 结构
          </Text>
          <Text size="xs" c="dimmed">
            提示：RCSB 支持直接以蛋白一字母序列搜索，无需输入 PDB ID；Include CSM 开启后可同时搜到实验结构和 AI 预测模型（AlphaFold / SwissModel）
          </Text>
        </Alert>
      </Stack>
    </Box>
  );
}

interface GenomicRegionResult {
  seqid: string;
  nc_accession: string;
  start: number;
  end: number;
  length: number;
  seq: string;
}

async function fetchGenomicSeq(loc: string, revcomp = false): Promise<GenomicRegionResult> {
  const base = import.meta.env.VITE_API_BASE || "";
  const url = `${base}/genes/genomic?loc=${encodeURIComponent(loc)}${revcomp ? "&revcomp=true" : ""}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to fetch sequence");
  }
  return res.json();
}

export default function GenePage() {
  const { geneId } = useParams<{ geneId: string }>();
  const [data, setData] = useState<GenePageResponse | null>(null);
  const [chromosomeGeneCount, setChromosomeGeneCount] = useState<number | null>(null);
  // Annotations now come from page response - no separate loading needed
  const [loading, setLoading] = useState(true);
  const [downloadingFasta, setDownloadingFasta] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [exonSeqs, setExonSeqs] = useState<Record<string, GenomicRegionResult[]>>({});
  const [cdsSeqs, setCdsSeqs] = useState<Record<string, GenomicRegionResult[]>>({});
  const [fetchingExons, setFetchingExons] = useState<Record<string, boolean>>({});
  const [fetchingCds, setFetchingCds] = useState<Record<string, boolean>>({});

  // ========== Layer 1: Load main page data (no sequences) ==========
  useEffect(() => {
    if (!geneId) return;

    const loadGenePage = async () => {
      setLoading(true);
      setPageError(null);
      try {
        // Load sequences on page view so protein/cds sequences are available.
        const result = await getGenePage(geneId, true);
        setData(result);

        // Chromosome details
        const chromData = await getChromosome(result.gene.seqid);
        setChromosomeGeneCount(chromData.gene_count);
      } catch (err) {
        setPageError(err instanceof Error ? err.message : 'Failed to load gene page');
      } finally {
        setLoading(false);
      }
    };

    loadGenePage();
  }, [geneId]);

  // ========== Layer 2: Hydrate page state (called after data loads) ==========
  // No-op - UI state initialized via useState above
  // Separation of concerns: data fetching vs UI state

  // ========== Layer 3: Reserved for sequence loading on demand ==========
  // Note: sequences can be loaded on demand when user expands a transcript
  // Currently sequences come from the full page load if include_sequences=true

  // Download FASTA file — always fetches the full gene genomic region
  const downloadFasta = useCallback(async () => {
    if (!geneId) return;

    setDownloadingFasta(true);
    try {
      const result = await getGenePage(geneId, true);

      const geneSymbol = result.gene.gene_symbol || result.gene.gene_id;
      const geneDesc = `${toChrId(result.gene.seqid)}:${result.gene.start}-${result.gene.end} strand=${result.gene.strand} gene=${geneSymbol}`;

      // Always fetch the full gene genomic region via /genes/genomic
      const loc = `${toChrId(result.gene.seqid)}:${result.gene.start}-${result.gene.end}`;
      const region = await fetchGenomicSeq(loc, result.gene.strand === "-");

      const fastaContent = `>${result.gene.gene_id} ${geneDesc}\n${region.seq.match(/.{1,80}/g)?.join('\n') || region.seq}\n`;

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

  // Download Transcript FASTA — uses rna_sequence from DB, falls back to /genes/genomic
  const downloadTranscriptFasta = useCallback(async (transcript: TranscriptResult) => {
    if (!transcript || !data) return;

    const txId = transcript.transcript_acc || transcript.transcript_id;
    const geneSymbol = data?.gene.gene_symbol || data?.gene.gene_id || '';
    // For negative strand, swap coords so header shows mRNA 5'→3' orientation
    const txStart = transcript.strand === "-" ? Math.max(transcript.start, transcript.end) : Math.min(transcript.start, transcript.end);
    const txEnd = transcript.strand === "-" ? Math.min(transcript.start, transcript.end) : Math.max(transcript.start, transcript.end);
    const geneDesc = `${toChrId(transcript.seqid)}:${txStart}-${txEnd} strand=${transcript.strand} gene=${geneSymbol}`;

    let seq: string | null = transcript.rna_sequence;

    // Fall back to genomic fetch if DB has no rna_sequence
    if (!seq) {
      try {
        const loc = `${toChrId(transcript.seqid)}:${transcript.start}-${transcript.end}`;
        const region = await fetchGenomicSeq(loc, transcript.strand === "-");
        seq = region.seq;
      } catch {
        seq = null;
      }
    }

    let fastaContent: string;
    if (seq) {
      fastaContent = `>${txId} ${geneDesc}\n`;
      const wrapped = seq.match(/.{1,80}/g)?.join('\n') || seq;
      fastaContent += wrapped + '\n';
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

  // Download all Exons as FASTA (actual genomic sequences)
  const downloadExonsFasta = useCallback(async (transcript: TranscriptResult) => {
    if (!transcript || !data) return;

    const geneSymbol = data.gene.gene_symbol || data.gene.gene_id;
    let fastaContent = '';

    fastaContent += `# Exons for transcript: ${transcript.transcript_acc || transcript.transcript_id}\n`;
    fastaContent += `# Gene: ${geneSymbol}\n`;
    fastaContent += `#\n`;

    for (let idx = 0; idx < transcript.exons.length; idx++) {
      const exon = transcript.exons[idx];
      const exonId = exon.exon_id || `exon_${idx + 1}`;
      const chrId = toChrId(exon.seqid);
      const loc = `${chrId}:${exon.start}-${exon.end}`;
      const desc = `${chrId}:${exon.start}-${exon.end} strand=${exon.strand} exon=${idx + 1} length=${exon.length}bp`;

      try {
        const region = await fetchGenomicSeq(loc, transcript.strand === "-");
        fastaContent += `>${exonId} ${desc}\n`;
        const wrapped = region.seq.match(/.{1,80}/g)?.join('\n') || region.seq;
        fastaContent += wrapped + '\n';
      } catch {
        fastaContent += `>${exonId} ${desc} [Sequence unavailable]\nNNNN\n`;
      }
    }

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

  // Download all CDS as FASTA (actual genomic sequences)
  const downloadCdsFasta = useCallback(async (transcript: TranscriptResult) => {
    if (!transcript || !data) return;

    const geneSymbol = data.gene.gene_symbol || data.gene.gene_id;
    let fastaContent = '';

    fastaContent += `# CDS Segments for transcript: ${transcript.transcript_acc || transcript.transcript_id}\n`;
    fastaContent += `# Gene: ${geneSymbol}\n`;
    fastaContent += `#\n`;

    for (let idx = 0; idx < transcript.cds_segments.length; idx++) {
      const cds = transcript.cds_segments[idx];
      const cdsId = cds.cds_id || `cds_${idx + 1}`;
      const chrId = toChrId(cds.seqid);
      const loc = `${chrId}:${cds.start}-${cds.end}`;
      const desc = `${chrId}:${cds.start}-${cds.end} strand=${cds.strand} cds=${idx + 1} phase=${cds.phase} length=${cds.length}bp`;

      try {
        const region = await fetchGenomicSeq(loc, transcript.strand === "-");
        fastaContent += `>${cdsId} ${desc}\n`;
        const wrapped = region.seq.match(/.{1,80}/g)?.join('\n') || region.seq;
        fastaContent += wrapped + '\n';
      } catch {
        fastaContent += `>${cdsId} ${desc} [Sequence unavailable]\nNNNN\n`;
      }
    }

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

  // Fetch all exon genomic sequences
  const fetchExonSequences = useCallback(async (tx: TranscriptResult) => {
    if (!tx.exons.length) return;
    setFetchingExons(prev => ({ ...prev, [tx.transcript_id]: true }));
    try {
      const results = await Promise.all(
        tx.exons.map(exon => {
          const loc = `${toChrId(exon.seqid)}:${exon.start}-${exon.end}`;
          return fetchGenomicSeq(loc, tx.strand === "-");
        })
      );
      setExonSeqs(prev => ({ ...prev, [tx.transcript_id]: results }));
    } finally {
      setFetchingExons(prev => ({ ...prev, [tx.transcript_id]: false }));
    }
  }, []);

  // Fetch all CDS genomic sequences
  const fetchCdsSequences = useCallback(async (tx: TranscriptResult) => {
    if (!tx.cds_segments.length) return;
    setFetchingCds(prev => ({ ...prev, [tx.transcript_id]: true }));
    try {
      const results = await Promise.all(
        tx.cds_segments.map(cds => {
          const loc = `${toChrId(cds.seqid)}:${cds.start}-${cds.end}`;
          return fetchGenomicSeq(loc, tx.strand === "-");
        })
      );
      setCdsSeqs(prev => ({ ...prev, [tx.transcript_id]: results }));
    } finally {
      setFetchingCds(prev => ({ ...prev, [tx.transcript_id]: false }));
    }
  }, []);

  // Download a single genomic region as FASTA
  const downloadGenomicRegion = (region: GenomicRegionResult, label: string) => {
    const geneSymbol = data?.gene.gene_symbol || data?.gene.gene_id || "";
    const fasta = `>${region.seqid}:${region.start}-${region.end} gene=${geneSymbol} length=${region.length}bp\n${region.seq.match(/.{1,60}/g)?.join("\n") || region.seq}\n`;
    const blob = new Blob([fasta], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${label}_${region.seqid}_${region.start}-${region.end}.fa`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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

  if (pageError || !data) {
    return (
      <Paper withBorder radius="xl" p="xl">
        <Text c="red">Error: {pageError || "Gene not found"}</Text>
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
          {data.annotations?.go?.summary && (
            <Badge variant="light" color="gray" size="sm">
              {data.annotations.go.summary.total} terms
            </Badge>
          )}
          {data.annotations?.go?.ncbi_gene_id && (
            <Badge variant="outline" color="gray" size="xs">
              NCBI: {data.annotations.go.ncbi_gene_id}
            </Badge>
          )}
          {data.annotations?.go?.ensembl_gene_id && (
            <Badge variant="outline" color="gray" size="xs">
              Ensembl: {data.annotations.go.ensembl_gene_id}
            </Badge>
          )}
        </Group>

        {!data.annotations?.go || !data.annotations.go.items?.length ? (
          <Text c="dimmed" size="sm">No GO annotations available</Text>
        ) : (
          <Accordion variant="separated" radius="md" defaultValue="biological_process">
            {/* Biological Process */}
            {data.annotations.go.items.filter(i => i.go_namespace === "biological_process").length > 0 && (
              <Accordion.Item value="biological_process">
                <Accordion.Control
                  bg="var(--mantine-color-blue-0)"
                  style={{ borderRadius: 8 }}
                >
                  <Group gap="xs">
                    <Text size="sm" fw={600} c="blue">Biological Process</Text>
                    <Badge color="blue" variant="light" size="xs">
                      {data.annotations.go.items.filter(i => i.go_namespace === "biological_process").length}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="sm">
                    {data.annotations.go.items
                      .filter(i => i.go_namespace === "biological_process")
                      .map(item => (
                        <GOTermCard key={item.go_id} item={item} />
                      ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            )}

            {/* Molecular Function */}
            {data.annotations.go.items.filter(i => i.go_namespace === "molecular_function").length > 0 && (
              <Accordion.Item value="molecular_function">
                <Accordion.Control
                  bg="var(--mantine-color-green-0)"
                  style={{ borderRadius: 8 }}
                >
                  <Group gap="xs">
                    <Text size="sm" fw={600} c="green">Molecular Function</Text>
                    <Badge color="green" variant="light" size="xs">
                      {data.annotations.go.items.filter(i => i.go_namespace === "molecular_function").length}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="sm">
                    {data.annotations.go.items
                      .filter(i => i.go_namespace === "molecular_function")
                      .map(item => (
                        <GOTermCard key={item.go_id} item={item} />
                      ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            )}

            {/* Cellular Component */}
            {data.annotations.go.items.filter(i => i.go_namespace === "cellular_component").length > 0 && (
              <Accordion.Item value="cellular_component">
                <Accordion.Control
                  bg="var(--mantine-color-orange-0)"
                  style={{ borderRadius: 8 }}
                >
                  <Group gap="xs">
                    <Text size="sm" fw={600} c="orange">Cellular Component</Text>
                    <Badge color="orange" variant="light" size="xs">
                      {data.annotations.go.items.filter(i => i.go_namespace === "cellular_component").length}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="sm">
                    {data.annotations.go.items
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

      {/* Expression Module — isolated component, geneId change forces full remount */}
      {data?.expression ? (
        <ExpressionSection
          key={geneId}
          geneId={geneId!}
          initialExpression={data.expression}
        />
      ) : null}

      {/* KEGG Pathways (Interactive KGML Viewer) */}
      {data.annotations?.kegg && (data.annotations.kegg.pathways?.length || data.annotations.kegg.items?.length) ? (
        <KeggPathwaysSection
          keggAnnotations={data.annotations.kegg}
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
          <>
            {/* Gene Structure Plot — all transcripts combined */}
            <GeneStructurePlot
              transcripts={transcripts}
              geneSymbol={data?.gene.gene_symbol}
            />

            <Divider my="md" />

            {/* Individual transcript accordion */}
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
                          <Tooltip
                            label="Copy a coordinate (e.g. chr1:944136-944228) and paste it into the JBrowse search box at /jbrowse to view the actual sequence."
                            multiline
                            w={280}
                            withArrow
                          >
                            <IconInfoCircle size={14} color="var(--mantine-color-dimmed)" style={{ cursor: "pointer" }} />
                          </Tooltip>
                        </Group>
                        <Button
                          variant="light"
                          size="xs"
                          leftSection={<IconDownload size={14} />}
                          onClick={() => downloadExonsFasta(tx)}
                        >
                          Export FASTA
                        </Button>
                        <Button
                          variant="light"
                          size="xs"
                          color="teal"
                          leftSection={fetchingExons[tx.transcript_id] ? <Loader size={12} /> : <IconDna2 size={14} />}
                          onClick={() => fetchExonSequences(tx)}
                          disabled={fetchingExons[tx.transcript_id]}
                        >
                          {fetchingExons[tx.transcript_id] ? "Fetching..." : "Fetch Sequences"}
                        </Button>
                      </Group>
                      <Stack gap="xs">
                        {tx.exons.map((exon, idx) => (
                          <Group key={exon.exon_id} justify="space-between">
                            <Text size="xs">Exon {idx + 1}</Text>
                            <Text size="xs" c="dimmed">
                              {toChrId(exon.seqid)}:{exon.start.toLocaleString()}-{exon.end.toLocaleString()} ({exon.length.toLocaleString()} bp)
                            </Text>
                          </Group>
                        ))}
                      </Stack>
                      {/* Fetched exon sequences */}
                      {exonSeqs[tx.transcript_id] && (
                        <Accordion variant="contained" radius="md" mt="xs">
                          <Accordion.Item value="exon-seqs">
                            <Accordion.Control icon={<IconDna2 size={14} />}>
                              Exon Sequences ({exonSeqs[tx.transcript_id].length})
                            </Accordion.Control>
                            <Accordion.Panel>
                              <Stack gap="xs">
                                {exonSeqs[tx.transcript_id].map((seq, idx) => (
                                  <Card key={idx} withBorder padding="xs" radius="sm">
                                    <Group justify="space-between" mb="xs">
                                      <Text size="xs" fw={500}>Exon {idx + 1}</Text>
                                      <Button
                                        size="xs"
                                        variant="subtle"
                                        leftSection={<IconDownload size={11} />}
                                        onClick={() => downloadGenomicRegion(seq, `exon${idx + 1}`)}
                                      >
                                        Download
                                      </Button>
                                    </Group>
                                    <Paper withBorder p="xs" radius="sm" bg="gray.0" style={{ maxHeight: 100, overflow: "auto" }}>
                                      <Text size="xs" ff="monospace" style={{ wordBreak: "break-all", whiteSpace: "pre-wrap" }}>
                                        {seq.seq}
                                      </Text>
                                    </Paper>
                                    <Text size="xs" c="dimmed" mt={4}>
                                      {seq.seqid}:{seq.start.toLocaleString()}-{seq.end.toLocaleString()} · {seq.length.toLocaleString()} bp
                                    </Text>
                                  </Card>
                                ))}
                              </Stack>
                            </Accordion.Panel>
                          </Accordion.Item>
                        </Accordion>
                      )}
                    </Box>

                    <Divider />

                    {/* CDS Segments */}
                    <Box>
                      <Group justify="space-between" mb="sm">
                        <Group gap="xs">
                          <IconCode size={16} />
                          <Title order={5}>CDS Segments ({tx.cds_segment_count})</Title>
                          <Tooltip
                            label="Copy a coordinate (e.g. chr1:944136-944228) and paste it into the JBrowse search box at /jbrowse to view the actual sequence."
                            multiline
                            w={280}
                            withArrow
                          >
                            <IconInfoCircle size={14} color="var(--mantine-color-dimmed)" style={{ cursor: "pointer" }} />
                          </Tooltip>
                        </Group>
                        <Button
                          variant="light"
                          size="xs"
                          leftSection={<IconDownload size={14} />}
                          onClick={() => downloadCdsFasta(tx)}
                        >
                          Export FASTA
                        </Button>
                        <Button
                          variant="light"
                          size="xs"
                          color="teal"
                          leftSection={fetchingCds[tx.transcript_id] ? <Loader size={12} /> : <IconCode size={14} />}
                          onClick={() => fetchCdsSequences(tx)}
                          disabled={fetchingCds[tx.transcript_id]}
                        >
                          {fetchingCds[tx.transcript_id] ? "Fetching..." : "Fetch Sequences"}
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
                              {toChrId(cds.seqid)}:{cds.start.toLocaleString()}-{cds.end.toLocaleString()} (phase: {cds.phase})
                            </Text>
                          </Group>
                        ))}
                      </Stack>
                      {/* Fetched CDS sequences */}
                      {cdsSeqs[tx.transcript_id] && (
                        <Accordion variant="contained" radius="md" mt="xs">
                          <Accordion.Item value="cds-seqs">
                            <Accordion.Control icon={<IconCode size={14} />}>
                              CDS Sequences ({cdsSeqs[tx.transcript_id].length})
                            </Accordion.Control>
                            <Accordion.Panel>
                              <Stack gap="xs">
                                {cdsSeqs[tx.transcript_id].map((seq, idx) => (
                                  <Card key={idx} withBorder padding="xs" radius="sm">
                                    <Group justify="space-between" mb="xs">
                                      <Group gap="xs">
                                        <Text size="xs" fw={500}>CDS {idx + 1}</Text>
                                        {tx.cds_segments[idx]?.protein_id && (
                                          <Badge size="xs" variant="light">{tx.cds_segments[idx].protein_id}</Badge>
                                        )}
                                      </Group>
                                      <Button
                                        size="xs"
                                        variant="subtle"
                                        leftSection={<IconDownload size={11} />}
                                        onClick={() => downloadGenomicRegion(seq, `cds${idx + 1}`)}
                                      >
                                        Download
                                      </Button>
                                    </Group>
                                    <Paper withBorder p="xs" radius="sm" bg="gray.0" style={{ maxHeight: 100, overflow: "auto" }}>
                                      <Text size="xs" ff="monospace" style={{ wordBreak: "break-all", whiteSpace: "pre-wrap" }}>
                                        {seq.seq}
                                      </Text>
                                    </Paper>
                                    <Text size="xs" c="dimmed" mt={4}>
                                      {seq.seqid}:{seq.start.toLocaleString()}-{seq.end.toLocaleString()} · {seq.length.toLocaleString()} bp · phase: {tx.cds_segments[idx]?.phase}
                                    </Text>
                                  </Card>
                                ))}
                              </Stack>
                            </Accordion.Panel>
                          </Accordion.Item>
                        </Accordion>
                      )}
                    </Box>

                    <Divider />

                    {/* Proteins */}
                    <Box>
                      <Group gap="xs" mb="sm">
                        <IconSquare size={16} />
                        <Title order={5}>Proteins ({tx.protein_count})</Title>
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

                              {/* Protein Sequence */}
                              {protein.protein_sequence && (
                                <>
                                  <Divider mt="sm" />
                                  <Accordion variant="contained" radius="md">
                                    <Accordion.Item value={`${protein.protein_id}-prot`}>
                                      <Accordion.Control icon={<IconCode size={14} />}>
                                        Protein Sequence ({protein.protein_length} aa)
                                      </Accordion.Control>
                                      <Accordion.Panel>
                                        <Tabs defaultValue="seq" variant="pills">
                                          <Tabs.List>
                                            <Tabs.Tab value="seq">Pure Sequence</Tabs.Tab>
                                            <Tabs.Tab value="fasta">FASTA</Tabs.Tab>
                                          </Tabs.List>
                                          <Tabs.Panel value="seq">
                                            <Paper withBorder p="sm" radius="md" bg="gray.0" style={{ maxHeight: 200, overflow: "auto" }}>
                                              <Text size="xs" ff="monospace" style={{ wordBreak: "break-all", whiteSpace: "pre-wrap" }}>
                                                {protein.protein_sequence}
                                              </Text>
                                            </Paper>
                                            <Group justify="flex-end" mt="xs">
                                              {(() => {
                                                const clean = protein.protein_sequence.replace(/\s+/g, "").trim();
                                                return (
                                                  <Button size="xs" variant="light" leftSection={<IconClipboardCopy size={12} />} onClick={() => navigator.clipboard.writeText(clean).catch(() => {})}>
                                                    Copy Sequence
                                                  </Button>
                                                );
                                              })()}
                                            </Group>
                                          </Tabs.Panel>
                                          <Tabs.Panel value="fasta">
                                            <Paper withBorder p="sm" radius="md" bg="gray.0" style={{ maxHeight: 200, overflow: "auto" }}>
                                              <Text size="xs" ff="monospace" style={{ wordBreak: "break-all", whiteSpace: "pre-wrap" }}>
                                                {`>${protein.protein_id} gene=${data.gene.gene_symbol || data.gene.gene_id} length=${protein.protein_length}aa\n${protein.protein_sequence.match(/.{1,60}/g)?.join("\n") || protein.protein_sequence}`}
                                              </Text>
                                            </Paper>
                                            <Group justify="flex-end" mt="xs">
                                              {(() => {
                                                const fastaVal = `>${protein.protein_id} gene=${data.gene.gene_symbol || data.gene.gene_id} length=${protein.protein_length}aa\n${protein.protein_sequence}\n`;
                                                return (
                                                  <Button size="xs" variant="light" leftSection={<IconClipboardCopy size={12} />} onClick={() => navigator.clipboard.writeText(fastaVal).catch(() => {})}>
                                                    Copy FASTA
                                                  </Button>
                                                );
                                              })()}
                                              <Button
                                                size="xs"
                                                variant="light"
                                                leftSection={<IconDownload size={12} />}
                                                onClick={() => {
                                                  const geneSymbol = data.gene.gene_symbol || data.gene.gene_id;
                                                  const seq = protein.protein_sequence;
                                                  const fasta = `>${protein.protein_id} gene=${geneSymbol} length=${protein.protein_length}aa\n${seq ? (seq.match(/.{1,60}/g)?.join("\n") || seq) : ""}\n`;
                                                  const blob = new Blob([fasta], { type: "text/plain" });
                                                  const url = URL.createObjectURL(blob);
                                                  const a = document.createElement("a");
                                                  a.href = url;
                                                  a.download = `${protein.protein_id}.fa`;
                                                  document.body.appendChild(a);
                                                  a.click();
                                                  document.body.removeChild(a);
                                                  URL.revokeObjectURL(url);
                                                }}
                                              >
                                                Download FASTA
                                              </Button>
                                            </Group>
                                          </Tabs.Panel>
                                        </Tabs>
                                      </Accordion.Panel>
                                    </Accordion.Item>
                                  </Accordion>
                                  {/* Structure Prediction Access */}
                                  <ProteinStructureAccessPanel
                                    proteinId={protein.protein_id}
                                    proteinSequence={protein.protein_sequence}
                                    geneSymbol={data.gene.gene_symbol || data.gene.gene_id}
                                    transcriptAcc={tx.transcript_acc}
                                  />
                                </>
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
                          <Group justify="space-between" mb="sm">
                            <Group gap="xs">
                              <IconDna2 size={16} />
                              <Title order={5}>RNA Sequence</Title>
                            </Group>
                            <Button
                              variant="light"
                              size="xs"
                              leftSection={<IconDownload size={14} />}
                              onClick={() => downloadTranscriptFasta(tx)}
                            >
                              Download FASTA
                            </Button>
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
          </>
        )}
      </Paper>

      {/* KEGG Pathway Image Modal */}
      {/* (已迁移到 KeggInteractiveViewer，通过 KeggPathwaysSection 打开) */}
    </Stack>
  );
}
