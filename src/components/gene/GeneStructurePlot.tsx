/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useCallback, useMemo, useRef } from "react";
import { Box, Stack, Group, Text, Badge, ActionIcon, Tooltip, Select, Paper } from "@mantine/core";
import { IconDownload, IconExternalLink } from "@tabler/icons-react";
import type { TranscriptResult } from "../../lib/geneApi";

interface GeneStructurePlotProps {
  transcripts: TranscriptResult[];
  geneSymbol?: string;
  geneStart?: number;
  geneEnd?: number;
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

// ── Scientific Color Palette ───────────────────────────────────────────────────
const C = {
  bg: "#ffffff",
  rulerBg: "#f8f9fa",
  rulerLine: "#d0d5dd",
  rulerTick: "#9ca3af",
  rulerText: "#6b7280",
  labelBg: "#f3f4f6",
  labelText: "#374151",
  labelDim: "#9ca3af",
  intron: "#9ca3af",
  exonShell: "#d8dde6",
  exonShellStroke: "#b0b8c7",
  cds: "#1f4e79",
  cdsHover: "#235789",
  utr: "#aeb9c7",
  utrBorder: "#8c96a5",
  activeRowBg: "#d9ecff",
  activeRowBorder: "#3b82f6",
  hoverRowBg: "#f0f9ff",
  summaryBg: "#f8fafc",
  arrow: "#6b7280",
  tooltipBg: "rgba(18,18,24,0.95)",
  badgeCds: "#1f4e79",
  badgeExon: "#374151",
  badgeUtr: "#6b7280",
};

// ── Layout constants ───────────────────────────────────────────────────────────
const LABEL_W = 200;          // left label column width
const SUMMARY_W = 120;       // right summary column width
const TRACK_H = 52;           // height of one transcript track
const TRACK_PAD = 6;         // gap between tracks
const RULER_H = 32;           // top ruler row
const LOCI_H = 38;            // gene locus overview row
const ROW_LABEL_H = 14;       // text height in label column
const INTRON_H = 2;           // intron line thickness
const EXON_H = 28;           // exon block height
const CDS_H = 20;            // CDS block height (shorter, sits centered in exon)
const UTR_H = 14;            // UTR block height (even shorter)
// Arrow chevrons on intron
const ARROW_H = 8;
const ARROW_W = 8;

// Derived
const TRACK_FULL_H = TRACK_H + TRACK_PAD;
const EXON_TOP_OFFSET = (EXON_H - CDS_H) / 2; // CDS centered inside exon
const UTR_H_OFFSET = (EXON_H - UTR_H) / 2;

function exonMidY(trackIndex: number): number {
  return LOCI_H + RULER_H + trackIndex * TRACK_FULL_H + TRACK_H / 2;
}

function exonBlockY(trackIndex: number): number {
  return LOCI_H + RULER_H + trackIndex * TRACK_FULL_H + (TRACK_H - EXON_H) / 2;
}

function cdsBlockY(trackIndex: number): number {
  return exonBlockY(trackIndex) + EXON_TOP_OFFSET;
}

function utrBlockY(trackIndex: number, is5: boolean): number {
  const ey = exonBlockY(trackIndex);
  return is5 ? ey : ey + EXON_H - UTR_H;
}

function arrowY(trackIndex: number): number {
  return exonMidY(trackIndex) - ARROW_H / 2;
}

function labelBaselineY(trackIndex: number): number {
  return LOCI_H + RULER_H + trackIndex * TRACK_FULL_H + TRACK_H / 2 + ROW_LABEL_H / 3;
}

// ── Data processing (retained from original) ────────────────────────────────

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

function bpToX(bp: number, svgW: number, totalLen: number): number {
  return LABEL_W + (bp / totalLen) * (svgW - LABEL_W - SUMMARY_W);
}

// ── NC_ mapping ──────────────────────────────────────────────────────────────
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

// ── Tooltip ───────────────────────────────────────────────────────────────────

function ExonTooltipContent({
  region, exonIdx, txStart, seqid, strand, txAcc, geneSymbol,
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
  const cdsLen = region.cdsRegions.reduce((s, c) => s + (c.end - c.start), 0);
  const utr5Len = region.utrRegions.filter((u) => u.type === "5UTR").reduce((s, u) => s + (u.end - u.start), 0);
  const utr3Len = region.utrRegions.filter((u) => u.type === "3UTR").reduce((s, u) => s + (u.end - u.start), 0);
  const strandLabel = strand === "+" ? "Forward" : "Reverse";

  return (
    <Stack gap={4} style={{ minWidth: 240 }}>
      <Group justify="space-between" align="center">
        <Group gap={4}>
          <Badge size="xs" color="blue" variant="filled">Exon {exonIdx + 1}</Badge>
          <Badge size="xs" color={strand === "+" ? "teal" : "orange"} variant="light">{strandLabel}</Badge>
        </Group>
        <Text size="xs" c="#9ca3af" ff="monospace">{absLen.toLocaleString()} bp</Text>
      </Group>
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
      <Group justify="space-between">
        <Text size="xs" c="dimmed">Genomic Range</Text>
        <Text size="xs" c="white" ff="monospace" fw={600}>{absStart.toLocaleString()} — {absEnd.toLocaleString()}</Text>
      </Group>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">CDS (coding)</Text>
        <Text size="xs" c="white" ff="monospace">{cdsLen > 0 ? `${cdsLen.toLocaleString()} bp (${((cdsLen / absLen) * 100).toFixed(1)}%)` : "—"}</Text>
      </Group>
      {utr5Len > 0 && (
        <Group justify="space-between">
          <Text size="xs" c="dimmed">5&apos; UTR</Text>
          <Text size="xs" c="#cbd5e0" ff="monospace">{utr5Len.toLocaleString()} bp</Text>
        </Group>
      )}
      {utr3Len > 0 && (
        <Group justify="space-between">
          <Text size="xs" c="dimmed">3&apos; UTR</Text>
          <Text size="xs" c="#a0aec0" ff="monospace">{utr3Len.toLocaleString()} bp</Text>
        </Group>
      )}
    </Stack>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RulerSvg({ totalLength, svgWidth }: { totalLength: number; svgWidth: number }) {
  const innerW = svgWidth - LABEL_W - SUMMARY_W;
  const pxPerBp = innerW / totalLength;

  let interval = 100;
  const scales: [number, number][] = [
    [0.5, 1_000_000], [0.3, 500_000], [0.2, 200_000],
    [0.1, 100_000], [0.05, 50_000], [0.02, 20_000],
    [0.01, 10_000], [0.005, 5_000], [0.002, 2_000], [0.001, 1_000],
  ];
  for (const [ppb, int] of scales) {
    if (pxPerBp >= ppb) { interval = int; break; }
  }

  const first = Math.floor(0 / interval) * interval;
  const ticks: number[] = [];
  for (let p = first; p <= totalLength + interval; p += interval) ticks.push(p);

  return (
    <g>
      <rect x={LABEL_W} y={0} width={innerW} height={RULER_H} fill={C.rulerBg} />
      <line x1={LABEL_W} y1={RULER_H} x2={svgWidth - SUMMARY_W} y2={RULER_H} stroke={C.rulerLine} strokeWidth={1} />
      {ticks.map((bp) => {
        const x = bpToX(bp, svgWidth, totalLength);
        if (x < LABEL_W - 2 || x > svgWidth - SUMMARY_W + 2) return null;
        return (
          <g key={bp}>
            <line x1={x} y1={RULER_H - 5} x2={x} y2={RULER_H} stroke={C.rulerTick} strokeWidth={1} />
            <text x={x} y={RULER_H - 8} textAnchor="middle" fontSize={8} fill={C.rulerText} fontFamily="monospace">
              {formatBp(bp)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function GeneLocusBar({
  geneSymbol, seqid, geneStart, geneEnd, strand, svgWidth, totalLen,
}: {
  geneSymbol?: string; seqid: string; geneStart?: number; geneEnd?: number;
  strand: string; svgWidth: number; totalLen: number;
}) {
  const chrId = seqid.startsWith("chr") ? seqid : (NC_TO_CHR.find(([k]) => k === seqid)?.[1] ?? seqid);
  const strandArrow = strand === "+" ? "→" : "←";
  const span = geneStart && geneEnd ? `${formatBp(geneEnd - geneStart)}` : "";
  const posLabel = geneStart && geneEnd ? `${chrId}:${geneStart.toLocaleString()}-${geneEnd.toLocaleString()}` : "";

  const innerW = svgWidth - LABEL_W - SUMMARY_W;
  const barY = LOCI_H / 2;
  const barH = 6;

  return (
    <g>
      {/* Background strip */}
      <rect x={0} y={0} width={svgWidth} height={LOCI_H} fill={C.labelBg} />
      <line x1={0} y1={LOCI_H} x2={svgWidth} y2={LOCI_H} stroke={C.rulerLine} strokeWidth={1} />

      {/* Gene name */}
      <text x={12} y={barY + barH / 2 + 1} fontSize={11} fill={C.labelText} fontFamily="monospace" fontWeight={600}>
        {geneSymbol || "Gene"}
      </text>

      {/* Locus bar — full gene span as background */}
      <rect
        x={LABEL_W + 4} y={barY + barH / 2 - barH / 2}
        width={innerW - 8} height={barH}
        rx={3} fill={C.intron}
      />

      {/* Strand arrow at right end */}
      <text x={svgWidth - SUMMARY_W - 8} y={barY + barH / 2 + 1} fontSize={10} fill={C.rulerText} textAnchor="end">
        {strandArrow} {posLabel} {span}
      </text>
    </g>
  );
}

function TranscriptTrackRow({
  pt, trackIndex, totalLen, svgWidth, isActive, onSelect,
  hoveredExon, onExonHover, onExonLeave,
}: {
  pt: ProcessedTranscript;
  trackIndex: number;
  totalLen: number;
  svgWidth: number;
  isActive: boolean;
  onSelect: () => void;
  hoveredExon: number | null;
  onExonHover: (exonIdx: number, mouseX: number, mouseY: number) => void;
  onExonLeave: () => void;
}) {
  const y = LOCI_H + RULER_H + trackIndex * TRACK_FULL_H;
  const exonY = exonBlockY(trackIndex);
  const cdsY = cdsBlockY(trackIndex);

  const txAcc = pt.tx.transcript_acc || pt.tx.transcript_id;
  const proteinCount = pt.tx.protein_count ?? 0;
  const rnaLen = pt.tx.rna_length ?? 0;
  const exonCount = pt.relativeExons.length;
  const cdsCount = pt.relativeExons.reduce((s, e) => s + e.cdsRegions.length, 0);
  const is5prime = pt.strand === "+";

  return (
    <g
      style={{ cursor: "pointer" }}
      onClick={onSelect}
    >
      {/* Active / hover row highlight */}
      {isActive && (
        <rect
          x={0} y={y}
          width={svgWidth} height={TRACK_H}
          fill={C.activeRowBg}
          stroke={C.activeRowBorder}
          strokeWidth={1}
          rx={0}
        />
      )}

      {/* Row divider */}
      <line x1={0} y1={y + TRACK_H} x2={svgWidth} y2={y + TRACK_H} stroke={C.rulerLine} strokeWidth={0.5} />

      {/* ── Left label column ── */}
      <rect x={0} y={y} width={LABEL_W} height={TRACK_H} fill={isActive ? C.activeRowBg : C.labelBg} />
      <text x={8} y={y + 18} fontSize={10} fill={C.labelText} fontFamily="monospace" fontWeight={600}>
        {txAcc.length > 24 ? txAcc.slice(0, 22) + "…" : txAcc}
      </text>
      <text x={8} y={y + 32} fontSize={8} fill={C.labelDim} fontFamily="monospace">
        {pt.tx.feature_type || "mRNA"}
        {proteinCount > 0 ? ` · ${proteinCount} prot` : ""}
        {rnaLen > 0 ? ` · ${formatBp(rnaLen)}` : ""}
      </text>

      {/* ── Right summary column ── */}
      <rect x={svgWidth - SUMMARY_W} y={y} width={SUMMARY_W} height={TRACK_H} fill={C.summaryBg} />
      <text x={svgWidth - SUMMARY_W + 8} y={y + 18} fontSize={9} fill={C.labelText} fontFamily="monospace">
        E{exonCount} · CDS{cdsCount}
      </text>
      <text x={svgWidth - SUMMARY_W + 8} y={y + 32} fontSize={8} fill={C.labelDim} fontFamily="monospace">
        {formatBp(pt.totalLength)}
      </text>

      {/* ── Intron line (full track width) ── */}
      <line
        x1={bpToX(0, svgWidth, totalLen)}
        y1={exonMidY(trackIndex)}
        x2={bpToX(pt.totalLength, svgWidth, totalLen)}
        y2={exonMidY(trackIndex)}
        stroke={C.intron}
        strokeWidth={INTRON_H}
      />

      {/* ── Direction arrows on intron ── */}
      {pt.relativeExons.length > 1 && Array.from({ length: Math.min(pt.relativeExons.length - 1, 20) }).map((_, i) => {
        const frac = (i + 0.5) / Math.min(pt.relativeExons.length - 1, 20);
        const bx = pt.totalLength * frac;
        const ax = bpToX(bx, svgWidth, totalLen);
        const ay = arrowY(trackIndex);
        const dir = is5prime ? 1 : -1;
        return (
          <polygon
            key={i}
            points={is5prime
              ? `${ax - ARROW_W / 2},${ay} ${ax + ARROW_W / 2},${ay} ${ax + dir * ARROW_W / 2},${ay + ARROW_H}`
              : `${ax - ARROW_W / 2},${ay + ARROW_H} ${ax + ARROW_W / 2},${ay + ARROW_H} ${ax + dir * ARROW_W / 2},${ay}`}
            fill={C.arrow}
            opacity={0.5}
          />
        );
      })}

      {/* ── Exon blocks + CDS + UTR ── */}
      {pt.relativeExons.map((exon, ei) => {
        const exStart = bpToX(exon.start, svgWidth, totalLen);
        const exEnd = bpToX(exon.end, svgWidth, totalLen);
        const exW = Math.max(exEnd - exStart, 2);

        return (
          <g key={ei}>
            {/* Exon shell (full exon as light block) */}
            <rect
              x={exStart} y={exonY} width={exW} height={EXON_H}
              rx={3} ry={3}
              fill={C.exonShell}
              stroke={C.exonShellStroke}
              strokeWidth={0.8}
              style={{ cursor: "pointer" }}
              onMouseEnter={(ev) => {
                ev.stopPropagation();
                const rect = (ev.target as SVGRectElement).ownerSVGElement?.getBoundingClientRect();
                if (!rect) return;
                onExonHover(ei, ev.clientX - rect.left, ev.clientY - rect.top);
              }}
              onMouseLeave={(ev) => {
                ev.stopPropagation();
                onExonLeave();
              }}
            />

            {/* CDS block (darker, sits on top of exon) */}
            {exon.cdsRegions.map((cds, ci) => {
              const cdsX = bpToX(cds.start, svgWidth, totalLen);
              const cdsEndX = bpToX(cds.end, svgWidth, totalLen);
              const cdsW = Math.max(cdsEndX - cdsX, 2);
              return (
                <rect
                  key={ci}
                  x={cdsX} y={cdsY} width={cdsW} height={CDS_H}
                  rx={2} ry={2}
                  fill={hoveredExon === ei ? C.cdsHover : C.cds}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(ev) => {
                    ev.stopPropagation();
                    const rect = (ev.target as SVGRectElement).ownerSVGElement?.getBoundingClientRect();
                    if (!rect) return;
                    onExonHover(ei, ev.clientX - rect.left, ev.clientY - rect.top);
                  }}
                  onMouseLeave={(ev) => {
                    ev.stopPropagation();
                    onExonLeave();
                  }}
                />
              );
            })}

            {/* UTR blocks */}
            {exon.utrRegions.map((utr, ui) => {
              const utrX = bpToX(utr.start, svgWidth, totalLen);
              const utrEndX = bpToX(utr.end, svgWidth, totalLen);
              const utrW = Math.max(utrEndX - utrX, 2);
              return (
                <rect
                  key={ui}
                  x={utrX} y={utrBlockY(trackIndex, utr.type === "5UTR")}
                  width={utrW} height={UTR_H}
                  rx={1} ry={1}
                  fill={C.utr}
                  stroke={C.utrBorder}
                  strokeWidth={0.6}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(ev) => {
                    ev.stopPropagation();
                    const rect = (ev.target as SVGRectElement).ownerSVGElement?.getBoundingClientRect();
                    if (!rect) return;
                    onExonHover(ei, ev.clientX - rect.left, ev.clientY - rect.top);
                  }}
                  onMouseLeave={(ev) => {
                    ev.stopPropagation();
                    onExonLeave();
                  }}
                />
              );
            })}

            {/* Exon number label */}
            {exW > 20 && (
              <text
                x={exStart + exW / 2} y={exonY + EXON_H / 2 + 3}
                textAnchor="middle" fontSize={8} fill={C.labelText}
                fontFamily="monospace" fontWeight={500}
                style={{ pointerEvents: "none" }}
              >
                E{ei + 1}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function TranscriptSummary({
  pt, svgWidth,
}: {
  pt: ProcessedTranscript;
  svgWidth: number;
}) {
  const txAcc = pt.tx.transcript_acc || pt.tx.transcript_id;
  const cdsCount = pt.relativeExons.reduce((s, e) => s + e.cdsRegions.length, 0);
  const proteinCount = pt.tx.protein_count ?? 0;
  const rnaLen = pt.tx.rna_length ?? 0;
  const chrId = pt.tx.seqid?.startsWith("chr") ? pt.tx.seqid : (NC_TO_CHR.find(([k]) => k === pt.tx.seqid)?.[1] ?? pt.tx.seqid ?? "");

  return (
    <Box
      style={{
        background: C.summaryBg,
        borderTop: `1px solid ${C.rulerLine}`,
        padding: "8px 12px",
        display: "flex",
        gap: 24,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <Group gap={4}>
        <Text size="xs" c="dimmed">Transcript</Text>
        <Text size="xs" fw={600} ff="monospace">{txAcc}</Text>
      </Group>
      <Group gap={4}>
        <Text size="xs" c="dimmed">Location</Text>
        <Text size="xs" ff="monospace">{chrId}:{pt.tx.start?.toLocaleString()}-{pt.tx.end?.toLocaleString()}</Text>
      </Group>
      <Group gap={4}>
        <Text size="xs" c="dimmed">Strand</Text>
        <Badge size="xs" color={pt.strand === "+" ? "teal" : "orange"} variant="light">
          {pt.strand === "+" ? "+ (forward)" : "− (reverse)"}
        </Badge>
      </Group>
      <Group gap={4}>
        <Text size="xs" c="dimmed">Exons</Text>
        <Badge size="xs" color="blue" variant="filled">{pt.relativeExons.length}</Badge>
      </Group>
      <Group gap={4}>
        <Text size="xs" c="dimmed">CDS Segments</Text>
        <Badge size="xs" style={{ background: C.cds, color: "#fff" }}>{cdsCount}</Badge>
      </Group>
      {proteinCount > 0 && (
        <Group gap={4}>
          <Text size="xs" c="dimmed">Proteins</Text>
          <Badge size="xs" color="green" variant="light">{proteinCount}</Badge>
        </Group>
      )}
      {rnaLen > 0 && (
        <Group gap={4}>
          <Text size="xs" c="dimmed">RNA Length</Text>
          <Text size="xs" ff="monospace">{formatBp(rnaLen)}</Text>
        </Group>
      )}
      <Text size="xs" c="dimmed">
        {pt.strand === "+" ? "5'→3'" : "3'→5'"} orientation · click a transcript to select
      </Text>
    </Box>
  );
}

function Legend() {
  return (
    <Group gap="lg" wrap="wrap">
      <Group gap={5}>
        <svg width={22} height={14}>
          <rect x={1} y={1} width={20} height={12} rx={3} fill={C.cds} />
        </svg>
        <Text size="xs" c="dimmed">CDS (coding region)</Text>
      </Group>
      <Group gap={5}>
        <svg width={22} height={14}>
          <rect x={1} y={2} width={20} height={10} rx={2} fill={C.exonShell} stroke={C.exonShellStroke} strokeWidth={0.8} />
        </svg>
        <Text size="xs" c="dimmed">Exon</Text>
      </Group>
      <Group gap={5}>
        <svg width={22} height={14}>
          <rect x={1} y={3} width={20} height={8} rx={1} fill={C.utr} stroke={C.utrBorder} strokeWidth={0.6} />
        </svg>
        <Text size="xs" c="dimmed">5&apos;/3&apos; UTR</Text>
      </Group>
      <Group gap={5}>
        <svg width={22} height={14}>
          <line x1={0} y1={7} x2={22} y2={7} stroke={C.intron} strokeWidth={2} />
        </svg>
        <Text size="xs" c="dimmed">Intron</Text>
      </Group>
      <Group gap={5}>
        <svg width={10} height={10}>
          <polygon points="2,8 8,8 5,2" fill={C.arrow} opacity={0.6} />
        </svg>
        <Text size="xs" c="dimmed">Direction</Text>
      </Group>
    </Group>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function GeneStructurePlot({
  transcripts, geneSymbol, geneStart, geneEnd,
}: GeneStructurePlotProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    mouseX: number;
    mouseY: number;
    exonIdx: number;
    region: ExonRegion;
  } | null>(null);

  const processed = useMemo(() => transcripts.map(processTranscript), [transcripts]);
  const defaultPt = useMemo(() => pickDefault(processed), [processed]);

  const activePt = useMemo(
    () => {
      if (selectedTxId) {
        const found = processed.find((p) => p.tx.transcript_id === selectedTxId);
        if (found) return found;
      }
      return defaultPt;
    },
    [processed, selectedTxId, defaultPt]
  );

  // Use the selected or default transcript's length for the ruler scale
  const totalLen = Math.max(activePt.totalLength, 1);

  // Show up to 10 transcripts; if more, show first 9 + "N more" row
  const MAX_DISPLAY = 10;
  const displayTracks = processed.slice(0, MAX_DISPLAY);
  const extraCount = processed.length - MAX_DISPLAY;

  const svgWidth = LABEL_W + SUMMARY_W + 800;
  const svgHeight = LOCI_H + RULER_H + displayTracks.length * TRACK_FULL_H + (extraCount > 0 ? TRACK_H : 0);

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

  return (
    <Stack gap="xs">
      {/* ── Header ── */}
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <Text size="xs" fw={600} c="dimmed">
            Gene Structure — {geneSymbol ?? "Unknown"}
          </Text>
          <Badge size="xs" variant="light" color="gray">
            {processed.length} transcript{processed.length !== 1 ? "s" : ""}
          </Badge>
          {activePt.tx.seqid && (
            <Badge size="xs" variant="light" color="gray">
              {activePt.tx.seqid.startsWith("chr")
                ? activePt.tx.seqid
                : (NC_TO_CHR.find(([k]) => k === activePt.tx.seqid)?.[1] ?? activePt.tx.seqid)}
            </Badge>
          )}
        </Group>
        <Group gap={4}>
          <Tooltip label="Export PNG">
            <ActionIcon size="sm" variant="subtle" onClick={exportPng}>
              <IconDownload size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Open in JBrowse">
            <ActionIcon
              size="sm" variant="subtle" color="blue"
              component="a"
              href={(() => {
                const { seqid } = activePt.tx;
                if (!seqid) return "#";
                const start = geneStart ?? activePt.tx.start;
                const end = geneEnd ?? activePt.tx.end;
                const chrId = seqid.startsWith("chr") ? seqid
                  : (NC_TO_CHR.find(([k]) => k === seqid)?.[1] ?? seqid);
                const loc = `${chrId}:${Math.max(1, start)}..${end}`;
                const gs = geneSymbol ? `&geneSymbol=${encodeURIComponent(geneSymbol)}` : "";
                return `/jbrowse/gene?loc=${encodeURIComponent(loc)}${gs}`;
              })()}
              style={{ display: "inline-flex", cursor: "pointer" }}
            >
              <IconExternalLink size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* ── Legend ── */}
      <Legend />

      {/* ── Plot container ── */}
      <Box
        ref={containerRef}
        style={{
          border: "1px solid #e0e0e0",
          borderRadius: 8,
          overflow: "auto",
          background: C.bg,
          position: "relative",
        }}
      >
        <svg
          ref={svgRef}
          width="100%"
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ display: "block" }}
        >
          {/* Gene locus overview bar */}
          <GeneLocusBar
            geneSymbol={geneSymbol}
            seqid={activePt.tx.seqid || ""}
            geneStart={geneStart}
            geneEnd={geneEnd}
            strand={activePt.strand}
            svgWidth={svgWidth}
            totalLen={totalLen}
          />

          {/* Ruler (genomic scale) */}
          <RulerSvg totalLength={totalLen} svgWidth={svgWidth} />

          {/* Transcript tracks */}
          {displayTracks.map((pt, trackIndex) => (
            <TranscriptTrackRow
              key={pt.tx.transcript_id}
              pt={pt}
              trackIndex={trackIndex}
              totalLen={totalLen}
              svgWidth={svgWidth}
              isActive={pt.tx.transcript_id === activePt.tx.transcript_id}
              onSelect={() => setSelectedTxId(pt.tx.transcript_id)}
              hoveredExon={tooltip?.exonIdx ?? null}
              onExonHover={(ei, mx, my) => {
                setTooltip({ mouseX: mx, mouseY: my, exonIdx: ei, region: pt.relativeExons[ei] });
              }}
              onExonLeave={() => setTooltip(null)}
            />
          ))}

          {/* "N more transcripts" row */}
          {extraCount > 0 && (
            <g>
              <rect
                x={0}
                y={LOCI_H + RULER_H + displayTracks.length * TRACK_FULL_H}
                width={svgWidth}
                height={TRACK_H}
                fill={C.labelBg}
              />
              <text
                x={svgWidth / 2}
                y={LOCI_H + RULER_H + displayTracks.length * TRACK_FULL_H + TRACK_H / 2 + 4}
                textAnchor="middle"
                fontSize={10}
                fill={C.labelDim}
                fontFamily="monospace"
              >
                +{extraCount} more transcript{extraCount !== 1 ? "s" : ""}
              </text>
            </g>
          )}
        </svg>

        {/* Floating tooltip */}
        {tooltip && (
          <div
            style={{
              position: "absolute",
              left: Math.min(tooltip.mouseX + 12, (containerRef.current?.clientWidth ?? svgWidth) - 260),
              top: Math.max(4, tooltip.mouseY - 100),
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
                minWidth: 240,
                boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
              }}
            >
              <ExonTooltipContent
                region={tooltip.region}
                exonIdx={tooltip.exonIdx}
                txStart={activePt.txStart}
                seqid={activePt.tx.seqid || ""}
                strand={activePt.strand}
                txAcc={activePt.tx.transcript_acc || activePt.tx.transcript_id}
                geneSymbol={geneSymbol}
              />
            </div>
          </div>
        )}
      </Box>

      {/* ── Active transcript summary ── */}
      <TranscriptSummary pt={activePt} svgWidth={svgWidth} />
    </Stack>
  );
}
