/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState, useCallback, useMemo } from "react";
import { Paper, Stack, Group, Text, Badge, ActionIcon, Tooltip, Box, Select } from "@mantine/core";
import { IconZoomIn, IconZoomOut, IconDownload, IconRotateClockwise } from "@tabler/icons-react";
import type { TranscriptResult } from "../../lib/geneApi";

interface GeneStructurePlotProps {
  transcripts: TranscriptResult[];
  geneSymbol?: string;
}

interface CdsRegion {
  start: number;
  end: number;
  phase: number;
  cds_id: string;
  protein_id: string | null;
}

interface UtrRegion {
  start: number;
  end: number;
  type: "5UTR" | "3UTR";
}

interface ExonRegion {
  start: number;
  end: number;
  exon_id: string;
  cdsRegions: CdsRegion[];
  utrRegions: UtrRegion[];
}

interface ProcessedTranscript {
  tx: TranscriptResult;
  relativeExons: ExonRegion[];
  totalLength: number;
  txStart: number;
  strand: "+" | "-";
}

// ── Color palette ─────────────────────────────────────────────────────────────
const C = {
  bodyLine: "#555555",
  intron: "#999999",
  cds: "#3182ce",
  cdsBorder: "#2c6da8",
  cdsHover: "#4299e1",
  utr5: "#cbd5e0",
  utr3: "#a0aec0",
  utrBorder: "#8898aa",
  spliceGt: "#e53e3e",
  spliceAg: "#c53030",
  axis: "#555555",
  tick: "#999999",
  rulerBg: "#f8f9fa",
  labelText: "#666",
  rulerText: "#888",
  tooltipBg: "rgba(18,18,24,0.95)",
  arrow: "#555555",
  exonLabelBg: "#f0f0f0",
};

// ── Layout constants ────────────────────────────────────────────────────────────
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 30;
const BODY_H = 5;
const RULER_H = 48;
const CDS_H = 26;
const UTR_H = 16;
const STRAND_H = 18;    // strand label row
const LABEL_W = 0;
const RIGHT_PAD = 28;
const SPLICE_R = 4;
const SVG_ASPECT = 900;
// Layout:
// [Ruler + Strand: RULER_H + STRAND_H = 66]
// [CDS block: CDS_H = 26]
// [body line: BODY_H = 5]
// [UTR block: UTR_H = 16]
// [exon labels: 20]
// [padding: 10]
const svgHeight = RULER_H + STRAND_H + CDS_H + 8 + BODY_H + 8 + UTR_H + 24;

// gene body centre Y
const BODY_Y = RULER_H + STRAND_H + CDS_H + 8 + BODY_H / 2;   // = 66+26+8+2.5 = 102.5
const BODY_TOP = BODY_Y - BODY_H / 2;   // = 100
const BODY_BOTTOM = BODY_Y + BODY_H / 2; // = 105

// ── Data processing ────────────────────────────────────────────────────────────

function processTranscript(tx: TranscriptResult): ProcessedTranscript {
  const exons = [...tx.exons].sort((a, b) => a.start - b.start);
  const cdsSegs = [...tx.cds_segments].sort((a, b) => a.start - b.start);
  const txStart = exons[0]?.start ?? 0;
  const txEnd = exons[exons.length - 1]?.end ?? 0;

  const rel = exons.map((exon) => {
    const er = { start: exon.start - txStart, end: exon.end - txStart, exon_id: exon.exon_id ?? "" };
    const ov = cdsSegs.filter((c) => c.start < exon.end && c.end > exon.start);
    ov.sort((a, b) => a.start - b.start);

    const cdsRegions: CdsRegion[] = ov.map((c) => ({
      start: Math.max(c.start - txStart, er.start),
      end: Math.min(c.end - txStart, er.end),
      phase: parseInt(c.phase, 10) || 0,
      cds_id: c.cds_id ?? "",
      protein_id: c.protein_id ?? null,
    }));

    const utrRegions: UtrRegion[] = [];
    if (cdsRegions.length === 0) {
      utrRegions.push({ start: er.start, end: er.end, type: "5UTR" as const });
    } else {
      const f = cdsRegions[0];
      const l = cdsRegions[cdsRegions.length - 1];
      if (er.start < f.start) utrRegions.push({ start: er.start, end: f.start, type: "5UTR" as const });
      if (l.end < er.end) utrRegions.push({ start: l.end, end: er.end, type: "3UTR" as const });
    }

    return { ...er, cdsRegions, utrRegions };
  });

  return { tx, relativeExons: rel, totalLength: txEnd - txStart, txStart, strand: tx.strand as "+" | "-" };
}

function pickDefault(transcripts: ProcessedTranscript[]): ProcessedTranscript {
  return (
    transcripts.find((pt) => pt.tx.protein_count > 0) ??
    transcripts.find((pt) => pt.tx.rna_sequence) ??
    transcripts.reduce((a, b) => (b.totalLength > a.totalLength ? b : a))
  );
}

function formatBp(bp: number): string {
  if (bp >= 1_000_000) return `${(bp / 1_000_000).toFixed(1)}Mb`;
  if (bp >= 1_000) return `${(bp / 1_000).toFixed(0)}kb`;
  return `${bp}bp`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function bpToPx(bp: number, svgW: number, totalLen: number, zoom: number, pan: number): number {
  const innerW = svgW - LABEL_W - RIGHT_PAD;
  return LABEL_W + ((bp - pan) / totalLen) * (innerW * zoom);
}

// ── Tooltip content ─────────────────────────────────────────────────────────────

function ExonTooltipContent({
  region,
  exonIdx,
  txStart,
  seqid,
  strand,
  txAcc,
  geneSymbol,
}: {
  region: ExonRegion;
  exonIdx: number;
  txStart: number;
  seqid: string;
  strand: string;
  txAcc: string;
  geneSymbol?: string;
}) {
  const absStart = txStart + region.start;
  const absEnd = txStart + region.end;
  const absLen = absEnd - absStart;
  const utr5Len = region.utrRegions.filter((u) => u.type === "5UTR").reduce((s, u) => s + (u.end - u.start), 0);
  const utr3Len = region.utrRegions.filter((u) => u.type === "3UTR").reduce((s, u) => s + (u.end - u.start), 0);
  const cdsLen = region.cdsRegions.reduce((s, c) => s + (c.end - c.start), 0);

  const strandLabel = strand === "+" ? "Forward (+) — 5'→3'" : "Reverse (−) — 3'→5'";

  return (
    <Stack gap={4} style={{ minWidth: 280 }}>
      {/* Header */}
      <Group justify="space-between" align="center">
        <Group gap={4}>
          <Badge size="xs" color="blue" variant="filled">Exon {exonIdx + 1}</Badge>
          <Badge size="xs" color={strand === "+" ? "teal" : "orange"} variant="light">
            {strandLabel}
          </Badge>
        </Group>
        <Text size="xs" c="#a0aec0" ff="monospace">{absLen.toLocaleString()} bp</Text>
      </Group>

      {/* Gene / Transcript info */}
      {geneSymbol && (
        <Group justify="space-between">
          <Text size="xs" c="dimmed">Gene</Text>
          <Text size="xs" c="white" fw={600}>{geneSymbol}</Text>
        </Group>
      )}
      <Group justify="space-between">
        <Text size="xs" c="dimmed">Transcript</Text>
        <Text size="xs" c="white" ff="monospace">{txAcc}</Text>
      </Group>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">Chromosome</Text>
        <Text size="xs" c="white" ff="monospace">{seqid}</Text>
      </Group>

      <Box style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "2px 0" }} />

      {/* Genomic position */}
      <Group justify="space-between">
        <Text size="xs" c="dimmed">Genomic Range</Text>
        <Text size="xs" c="white" ff="monospace" fw={600}>
          {absStart.toLocaleString()} — {absEnd.toLocaleString()}
        </Text>
      </Group>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">Strand</Text>
        <Badge size="xs" color={strand === "+" ? "teal" : "orange"} variant="outline">
          {strand === "+" ? "+ (forward)" : "− (reverse)"}
        </Badge>
      </Group>

      <Box style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "2px 0" }} />

      {/* Structure breakdown */}
      <Text size="xs" fw={700} c="#90cdf4" mb={-2}>Structure Breakdown</Text>

      <Group justify="space-between">
        <Text size="xs" c="dimmed">CDS (coding)</Text>
        <Text size="xs" c="white" ff="monospace">
          {cdsLen > 0 ? `${cdsLen.toLocaleString()} bp (${((cdsLen/absLen)*100).toFixed(1)}%)` : "—"}
        </Text>
      </Group>
      {utr5Len > 0 && (
        <Group justify="space-between">
          <Text size="xs" c="dimmed">5&apos; UTR</Text>
          <Text size="xs" c="#cbd5e0" ff="monospace">
            {utr5Len.toLocaleString()} bp
          </Text>
        </Group>
      )}
      {utr3Len > 0 && (
        <Group justify="space-between">
          <Text size="xs" c="dimmed">3&apos; UTR</Text>
          <Text size="xs" c="#a0aec0" ff="monospace">
            {utr3Len.toLocaleString()} bp
          </Text>
        </Group>
      )}

      {/* CDS segments detail */}
      {region.cdsRegions.length > 0 && (
        <>
          <Box style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "2px 0" }} />
          <Text size="xs" fw={700} c="#90cdf4" mb={-2}>CDS Segments ({region.cdsRegions.length})</Text>
          {region.cdsRegions.map((cds, i) => (
            <Group key={i} justify="space-between">
              <Text size="xs" c="#90cdf4">
                CDS {i + 1}
                <Text span c="dimmed"> · phase {cds.phase}</Text>
              </Text>
              <Text size="xs" c="white" ff="monospace">
                {(txStart + cds.start).toLocaleString()}—{(txStart + cds.end).toLocaleString()}
              </Text>
            </Group>
          ))}
        </>
      )}

      {/* Relative position */}
      <Box style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "2px 0" }} />
      <Group justify="space-between">
        <Text size="xs" c="dimmed">Relative to Tx Start</Text>
        <Text size="xs" c="#a0aec0" ff="monospace">
          {region.start.toLocaleString()}—{region.end.toLocaleString()} bp
        </Text>
      </Group>
    </Stack>
  );
}

// ── SVG: Ruler ───────────────────────────────────────────────────────────────

function RulerSvg({
  totalLength,
  zoom,
  panOffset,
  svgWidth,
}: {
  totalLength: number;
  zoom: number;
  panOffset: number;
  svgWidth: number;
}) {
  const innerW = svgWidth - LABEL_W - RIGHT_PAD;
  const pxPerBp = (innerW * zoom) / totalLength;
  const visibleEnd = panOffset + totalLength / zoom;

  let interval = 100;
  const scales: [number, number][] = [
    [0.5, 1000], [0.2, 500], [0.1, 200],
    [0.05, 100], [0.02, 50], [0.01, 20],
    [0.005, 10], [0.002, 5], [0.001, 2],
  ];
  for (const [ppb, int] of scales) {
    if (pxPerBp >= ppb) { interval = int; break; }
  }

  const first = Math.floor(panOffset / interval) * interval;
  const ticks: number[] = [];
  for (let p = first; p <= visibleEnd + interval; p += interval) {
    if (p >= panOffset - interval) ticks.push(p);
  }

  const toX = (bp: number) => bpToPx(bp, svgWidth, totalLength, zoom, panOffset);

  return (
    <g>
      <rect x={LABEL_W} y={0} width={svgWidth - LABEL_W - RIGHT_PAD} height={RULER_H} fill={C.rulerBg} />
      {/* axis line */}
      <line x1={LABEL_W} y1={RULER_H} x2={svgWidth - RIGHT_PAD} y2={RULER_H} stroke={C.axis} strokeWidth={1} />
      {ticks.map((bp) => {
        const x = toX(bp);
        if (x < LABEL_W - 2 || x > svgWidth - RIGHT_PAD + 2) return null;
        return (
          <g key={bp}>
            <line x1={x} y1={RULER_H - 5} x2={x} y2={RULER_H} stroke={C.tick} strokeWidth={1} />
            <text x={x} y={RULER_H - 8} textAnchor="middle" fontSize={8} fill={C.rulerText} fontFamily="monospace">
              {formatBp(bp)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ── SVG: Strand arrow ────────────────────────────────────────────────────────

function StrandSvg({ strand }: { strand: string }) {
  const ay = RULER_H + 10;
  const ax = LABEL_W + 8;
  if (strand === "+") {
    return (
      <g>
        <line x1={ax} y1={ay} x2={ax + 22} y2={ay} stroke={C.arrow} strokeWidth={2} strokeLinecap="round" />
        <polygon points={`${ax + 22},${ay - 5} ${ax + 30},${ay} ${ax + 22},${ay + 5}`} fill={C.arrow} />
        <text x={ax} y={ay + 14} fontSize={9} fill={C.rulerText} fontFamily="monospace">+ strand (forward)</text>
      </g>
    );
  }
  return (
    <g>
      <line x1={ax + 22} y1={ay} x2={ax} y2={ay} stroke={C.arrow} strokeWidth={2} strokeLinecap="round" />
      <polygon points={`${ax},${ay - 5} ${ax - 8},${ay} ${ax},${ay + 5}`} fill={C.arrow} />
      <text x={ax} y={ay + 14} fontSize={9} fill={C.rulerText} fontFamily="monospace">− strand (reverse)</text>
    </g>
  );
}

// ── Legend ──────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <Group gap="lg" wrap="wrap">
      <Group gap={5}>
        <svg width={22} height={14}>
          <rect x={1} y={1} width={20} height={12} rx={3} fill={C.cds} stroke={C.cdsBorder} strokeWidth={1} />
        </svg>
        <Text size="xs" c="dimmed">CDS</Text>
      </Group>
      <Group gap={5}>
        <svg width={22} height={14}>
          <rect x={1} y={2} width={20} height={10} rx={2} fill={C.utr5} stroke={C.utrBorder} strokeWidth={0.8} />
        </svg>
        <Text size="xs" c="dimmed">5&apos;/3&apos; UTR</Text>
      </Group>
      <Group gap={5}>
        <svg width={22} height={14}>
          <line x1={0} y1={7} x2={22} y2={7} stroke={C.bodyLine} strokeWidth={3} strokeLinecap="round" />
        </svg>
        <Text size="xs" c="dimmed">Intron / body</Text>
      </Group>
      <Group gap={5}>
        <svg width={14} height={12}>
          <polygon points={`3,10 11,10 7,2`} fill={C.spliceGt} />
        </svg>
        <Text size="xs" c="dimmed">5&apos; splice (GT)</Text>
      </Group>
      <Group gap={5}>
        <svg width={14} height={12}>
          <polygon points={`3,2 11,2 7,10`} fill={C.spliceAg} />
        </svg>
        <Text size="xs" c="dimmed">3&apos; splice (AG)</Text>
      </Group>
    </Group>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function GeneStructurePlot({ transcripts, geneSymbol }: GeneStructurePlotProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, offset: 0 });
  const [tooltip, setTooltip] = useState<{
    mouseX: number;
    mouseY: number;
    exonIdx: number;
    region: ExonRegion;
  } | null>(null);

  const processed = useMemo(() => transcripts.map(processTranscript), [transcripts]);
  const defaultPt = useMemo(() => pickDefault(processed), [processed]);
  const [selectedTxId, setSelectedTxId] = useState<string>(defaultPt.tx.transcript_id);

  const currentPt = useMemo(
    () => processed.find((p) => p.tx.transcript_id === selectedTxId) ?? defaultPt,
    [processed, selectedTxId, defaultPt]
  );

  const totalLength = Math.max(currentPt.totalLength, 1);
  const svgWidth = SVG_ASPECT;

  // ── Zoom / Pan ──
  const zoomIn = useCallback(() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.5)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.5)), []);
  const reset = useCallback(() => { setZoom(1); setPanOffset(0); }, []);

  const onMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX, offset: panOffset });
    setTooltip(null);
  }, [panOffset]);

  const onMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (isDragging) {
      const dx = e.clientX - dragStart.x;
      const innerW = svgWidth - LABEL_W - RIGHT_PAD;
      const pxPerBp = (innerW * zoom) / totalLength;
      const dxBp = -dx / pxPerBp;
      const maxOffset = totalLength - totalLength / zoom;
      setPanOffset(Math.max(0, Math.min(maxOffset, dragStart.offset + dxBp)));
      setTooltip(null);
    }
  }, [isDragging, dragStart, zoom, totalLength, svgWidth]);

  const onMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const onWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.85 : 1.18;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * delta));
    if (newZoom === zoom) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const relX = (mouseX - LABEL_W) / ((svgWidth - LABEL_W - RIGHT_PAD) * zoom);
    const bpAtMouse = relX * totalLength + panOffset;
    const newOffset = bpAtMouse - relX * totalLength / newZoom;
    const maxOffset = totalLength - totalLength / newZoom;
    setPanOffset(Math.max(0, Math.min(maxOffset, newOffset)));
    setZoom(newZoom);
  }, [zoom, panOffset, totalLength, svgWidth]);

  // ── Handle block hover — find which exon is under mouse ──
  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (isDragging) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    const svgMouseX = e.clientX - rect.left;
    const svgMouseY = e.clientY - rect.top;

    // Convert to SVG viewBox coordinates
    const vbMouseX = (svgMouseX / rect.width) * svgWidth;
    const vbMouseY = (svgMouseY / rect.height) * svgHeight;

    // Check if mouse is in the CDS or UTR band
    const cdsTop = BODY_TOP - CDS_H;
    const utrBottom = BODY_BOTTOM + UTR_H;

    if (vbMouseY < cdsTop - 2 || vbMouseY > utrBottom + 2) {
      setTooltip(null);
      return;
    }

    // Find which exon the mouse is over
    for (let ei = 0; ei < currentPt.relativeExons.length; ei++) {
      const exon = currentPt.relativeExons[ei];
      const exStart = bpToPx(exon.start, svgWidth, totalLength, zoom, panOffset);
      const exEnd = bpToPx(exon.end, svgWidth, totalLength, zoom, panOffset);

      if (vbMouseX >= exStart && vbMouseX <= exEnd) {
        // Check CDS region
        for (const cds of exon.cdsRegions) {
          const cdsStart = bpToPx(cds.start, svgWidth, totalLength, zoom, panOffset);
          const cdsEnd = bpToPx(cds.end, svgWidth, totalLength, zoom, panOffset);
          if (vbMouseX >= cdsStart && vbMouseX <= cdsEnd && vbMouseY <= BODY_TOP && vbMouseY >= cdsTop) {
            setTooltip({ mouseX: svgMouseX, mouseY: svgMouseY, exonIdx: ei, region: exon });
            return;
          }
        }
        // Check UTR region
        for (const utr of exon.utrRegions) {
          const utrStart = bpToPx(utr.start, svgWidth, totalLength, zoom, panOffset);
          const utrEnd = bpToPx(utr.end, svgWidth, totalLength, zoom, panOffset);
          if (vbMouseX >= utrStart && vbMouseX <= utrEnd && vbMouseY >= BODY_BOTTOM && vbMouseY <= utrBottom) {
            setTooltip({ mouseX: svgMouseX, mouseY: svgMouseY, exonIdx: ei, region: exon });
            return;
          }
        }
      }
    }
    setTooltip(null);
  }, [isDragging, currentPt, zoom, panOffset, svgWidth, totalLength]);

  // ── Export PNG ──
  const exportPng = useCallback(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const ser = new XMLSerializer();
    const svgStr = ser.serializeToString(svgEl);
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const ctx = cv.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const a = document.createElement("a");
      a.href = cv.toDataURL("image/png");
      a.download = `gene_structure_${geneSymbol || "plot"}.png`;
      a.click();
    };
    img.src = url;
  }, [geneSymbol]);

  if (processed.length === 0) {
    return (
      <Paper withBorder p="md">
        <Text size="sm" c="dimmed">No transcript data</Text>
      </Paper>
    );
  }

  const transcriptOptions = processed.map((pt) => {
    const parts = [pt.tx.transcript_acc || pt.tx.transcript_id];
    if (pt.tx.feature_type !== "mRNA") parts.push(pt.tx.feature_type);
    if (pt.tx.protein_count > 0) parts.push(`${pt.tx.protein_count} protein(s)`);
    if (pt.tx.rna_sequence) parts.push("★ RNA");
    return { value: pt.tx.transcript_id, label: parts.join(" | ") };
  });

  const exonLabelY = BODY_BOTTOM + UTR_H + 16;

  return (
    <Stack gap="xs">
      {/* ── Header ── */}
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <Text size="xs" fw={600} c="dimmed">
            Gene Structure — {geneSymbol ?? "Unknown"}
          </Text>
          <Text size="xs" c="dimmed">
            {formatBp(totalLength)} | {currentPt.relativeExons.length} exons
          </Text>
          <Badge size="xs" variant="light" color="gray">
            {currentPt.tx.seqid}
          </Badge>
        </Group>
        <Group gap={4}>
          <Tooltip label="Zoom in">
            <ActionIcon size="sm" variant="subtle" onClick={zoomIn}>
              <IconZoomIn size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Zoom out">
            <ActionIcon size="sm" variant="subtle" onClick={zoomOut}>
              <IconZoomOut size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Reset view">
            <ActionIcon size="sm" variant="subtle" onClick={reset}>
              <IconRotateClockwise size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Export PNG">
            <ActionIcon size="sm" variant="subtle" onClick={exportPng}>
              <IconDownload size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* ── Transcript selector ── */}
      {processed.length > 1 && (
        <Select
          size="xs"
          data={transcriptOptions}
          value={selectedTxId}
          onChange={(v) => {
            setSelectedTxId(v ?? selectedTxId);
            setZoom(1);
            setPanOffset(0);
            setTooltip(null);
          }}
          w={420}
        />
      )}

      {/* ── Legend ── */}
      <Legend />

      {/* ── Plot container ── */}
      <Box
        ref={containerRef}
        style={{
          border: "1px solid #e0e0e0",
          borderRadius: 8,
          overflow: "visible",
          background: "white",
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
          position: "relative",
        }}
      >
        <svg
          ref={svgRef}
          width="100%"
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          onMouseDown={onMouseDown}
          onMouseMove={(e) => { onMouseMove(e); handleSvgMouseMove(e); }}
          onMouseUp={onMouseUp}
          onMouseLeave={() => { setIsDragging(false); setTooltip(null); }}
          onWheel={onWheel}
        >
          {/* Ruler */}
          <RulerSvg totalLength={currentPt.totalLength} zoom={zoom} panOffset={panOffset} svgWidth={svgWidth} />

          {/* Strand label */}
          <StrandSvg strand={currentPt.strand} />

          {/* Gene body line */}
          <line
            x1={bpToPx(0, svgWidth, totalLength, zoom, panOffset)}
            y1={BODY_Y}
            x2={bpToPx(totalLength, svgWidth, totalLength, zoom, panOffset)}
            y2={BODY_Y}
            stroke={C.bodyLine} strokeWidth={BODY_H}
            strokeLinecap="round"
          />

          {/* Intron lines */}
          {currentPt.relativeExons.length > 1 &&
            currentPt.relativeExons.slice(0, -1).map((e, i) => {
              const next = currentPt.relativeExons[i + 1];
              return (
                <line
                  key={i}
                  x1={bpToPx(e.end, svgWidth, totalLength, zoom, panOffset)}
                  y1={BODY_Y}
                  x2={bpToPx(next.start, svgWidth, totalLength, zoom, panOffset)}
                  y2={BODY_Y}
                  stroke={C.intron} strokeWidth={BODY_H}
                  strokeLinecap="butt"
                />
              );
            })}

          {/* CDS blocks */}
          {currentPt.relativeExons.map((exon, ei) =>
            exon.cdsRegions.map((cds, ci) => {
              const x = bpToPx(cds.start, svgWidth, totalLength, zoom, panOffset);
              const w = Math.max(bpToPx(cds.end, svgWidth, totalLength, zoom, panOffset) - x, 2);
              const y = BODY_TOP - CDS_H;
              return (
                <rect
                  key={`cds-${ei}-${ci}`}
                  x={x} y={y} width={w} height={CDS_H}
                  rx={3} ry={3}
                  fill={C.cds} stroke={C.cdsBorder} strokeWidth={1}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(ev) => {
                    ev.preventDefault();
                    const rect = svgRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    const svgMouseX = ((ev.clientX - rect.left) / rect.width) * svgWidth;
                    const svgMouseY = ((ev.clientY - rect.top) / rect.height) * svgHeight;
                    setTooltip({ mouseX: svgMouseX, mouseY: svgMouseY, exonIdx: ei, region: exon });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              );
            })
          )}

          {/* UTR blocks */}
          {currentPt.relativeExons.map((exon, ei) =>
            exon.utrRegions.map((utr, ui) => {
              const x = bpToPx(utr.start, svgWidth, totalLength, zoom, panOffset);
              const w = Math.max(bpToPx(utr.end, svgWidth, totalLength, zoom, panOffset) - x, 2);
              const y = BODY_BOTTOM;
              return (
                <rect
                  key={`utr-${ei}-${ui}`}
                  x={x} y={y} width={w} height={UTR_H}
                  rx={2} ry={2}
                  fill={utr.type === "5UTR" ? C.utr5 : C.utr3}
                  stroke={C.utrBorder} strokeWidth={0.8}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(ev) => {
                    ev.preventDefault();
                    const rect = svgRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    const svgMouseX = ((ev.clientX - rect.left) / rect.width) * svgWidth;
                    const svgMouseY = ((ev.clientY - rect.top) / rect.height) * svgHeight;
                    setTooltip({ mouseX: svgMouseX, mouseY: svgMouseY, exonIdx: ei, region: exon });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              );
            })
          )}

          {/* Splice site triangles */}
          {currentPt.relativeExons.length > 1 &&
            currentPt.relativeExons.slice(0, -1).map((e, i) => {
              const next = currentPt.relativeExons[i + 1];
              const gtX = bpToPx(next.start, svgWidth, totalLength, zoom, panOffset);
              const agX = bpToPx(e.end, svgWidth, totalLength, zoom, panOffset);
              return (
                <g key={`ss-${i}`}>
                  {/* GT — pointing down toward bodyTop */}
                  <polygon
                    points={`${gtX - SPLICE_R},${BODY_TOP} ${gtX + SPLICE_R},${BODY_TOP} ${gtX},${BODY_TOP + SPLICE_R * 1.8}`}
                    fill={C.spliceGt}
                  />
                  {/* AG — pointing up from bodyBottom */}
                  <polygon
                    points={`${agX - SPLICE_R},${BODY_BOTTOM} ${agX + SPLICE_R},${BODY_BOTTOM} ${agX},${BODY_BOTTOM - SPLICE_R * 1.8}`}
                    fill={C.spliceAg}
                  />
                </g>
              );
            })}

          {/* Exon labels */}
          {currentPt.relativeExons.map((exon, ei) => {
            const cx = bpToPx((exon.start + exon.end) / 2, svgWidth, totalLength, zoom, panOffset);
            const exW = bpToPx(exon.end, svgWidth, totalLength, zoom, panOffset) - bpToPx(exon.start, svgWidth, totalLength, zoom, panOffset);
            if (exW < 18) return null;
            return (
              <g key={`lbl-${ei}`}>
                <rect
                  x={cx - exW / 2} y={exonLabelY - 9}
                  width={exW} height={14}
                  rx={3} fill={C.exonLabelBg}
                />
                <text x={cx} y={exonLabelY} textAnchor="middle" fontSize={9} fill={C.labelText} fontFamily="monospace" fontWeight={500}>
                  E{ei + 1}
                </text>
              </g>
            );
          })}

          {/* Zoom % */}
          <text x={svgWidth - 30} y={14} fontSize={9} fill="#bbb" textAnchor="end">
            {Math.round(zoom * 100)}%
          </text>
        </svg>

        {/* ── Floating tooltip — positioned in CSS px, not SVG coords ── */}
        {tooltip && (() => {
          const containerW = containerRef.current?.clientWidth ?? svgWidth;
          // Convert SVG viewBox x to CSS px
          const cssX = (tooltip.mouseX / svgWidth) * containerW;
          // Tooltip width ~260px, clamp to container
          const left = Math.min(cssX + 12, containerW - 270);
          const top = tooltip.mouseY - 120;

          return (
            <div
              style={{
                position: "absolute",
                left,
                top: Math.max(4, top),
                zIndex: 20,
                pointerEvents: "auto",
              }}
              onMouseEnter={() => {}}
              onMouseLeave={() => setTooltip(null)}
            >
              <div
                style={{
                  background: C.tooltipBg,
                  borderRadius: 10,
                  padding: "10px 14px",
                  minWidth: 260,
                  boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
                }}
              >
                <ExonTooltipContent
                  region={tooltip.region}
                  exonIdx={tooltip.exonIdx}
                  txStart={currentPt.txStart}
                  seqid={currentPt.tx.seqid}
                  strand={currentPt.strand}
                  txAcc={currentPt.tx.transcript_acc || currentPt.tx.transcript_id}
                  geneSymbol={geneSymbol}
                />
              </div>
            </div>
          );
        })()}
      </Box>

      {/* ── Info badges ── */}
      <Group gap="xs" wrap="wrap">
        <Badge size="sm" variant="light" color="blue">
          {currentPt.relativeExons.length} exons
        </Badge>
        <Badge size="sm" variant="light" color="blue">
          {currentPt.relativeExons.reduce((s, e) => s + e.cdsRegions.length, 0)} CDS
        </Badge>
        <Badge size="sm" variant="light" color="gray">
          strand {currentPt.strand === "+" ? "+ (forward)" : "− (reverse)"}
        </Badge>
        {currentPt.tx.protein_count > 0 && (
          <Badge size="sm" variant="light" color="green">
            {currentPt.tx.protein_count} protein(s)
          </Badge>
        )}
        {currentPt.tx.rna_sequence && (
          <Badge size="sm" variant="light" color="cyan">
            RNA {currentPt.tx.rna_length?.toLocaleString()} bp
          </Badge>
        )}
        <Text size="xs" c="dimmed">
          Hover blocks for details · Drag to pan · Scroll to zoom
        </Text>
      </Group>
    </Stack>
  );
}
