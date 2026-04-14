/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useCallback, useMemo, useRef } from "react";
import { Box, Stack, Group, Text, Badge, ActionIcon, Tooltip, Paper } from "@mantine/core";
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

// ── Scientific Color Palette (restrained, publication-friendly) ──────────────
const C = {
  bg: "#ffffff",
  headerBg: "#f8fafc",
  labelBg: "#f8fafc",
  summaryBg: "#f8fafc",
  activeRowBg: "#eaf4ff",
  activeBorder: "#2f6ea3",

  // Tracks
  intron: "#98a2b3",
  exonShell: "#d7dee7",
  exonStroke: "#b0b8c7",
  cds: "#1f4e79",
  cdsHover: "#235789",
  utr: "#b8c4d3",
  utrBorder: "#9aacbe",

  // Accents
  hoverRowBg: "#f0f9ff",
  hoverExon: "#f59f00",

  // Text
  textPrimary: "#1f2937",
  textSecondary: "#6b7280",
  textDim: "#9ca3af",

  // Ruler
  rulerLine: "#c7ced6",
  rulerTick: "#9aa4b2",
  rulerText: "#6b7280",

  // Tooltip
  tooltipBg: "rgba(18,18,24,0.95)",

  // Divider
  border: "#e5e7eb",
};

// ── Layout constants ───────────────────────────────────────────────────────────
const LABEL_W = 200;       // left label column
const SUMMARY_W = 110;    // right summary column
const TRACK_H = 44;        // track row height
const TRACK_PAD = 4;       // gap between rows
const HEADER_H = 60;       // gene locus bar height
const RULER_H = 28;        // ruler row height

// Exon-track dimensions (all share same center Y)
const EXON_H = 28;
const CDS_H = 18;
const UTR_H = 14;
const INTRON_H = 2;
const ARROW_H = 6;
const ARROW_W = 6;

// Derived
const TRACK_FULL_H = TRACK_H + TRACK_PAD;

// Center Y of the track body within a row
function trackMidY(trackIndex: number): number {
  return HEADER_H + RULER_H + trackIndex * TRACK_FULL_H + TRACK_H / 2;
}

function exonTopY(trackIndex: number): number {
  return HEADER_H + RULER_H + trackIndex * TRACK_FULL_H + (TRACK_H - EXON_H) / 2;
}

function cdsTopY(trackIndex: number): number {
  return exonTopY(trackIndex) + (EXON_H - CDS_H) / 2; // CDS centered
}

function utrTopY(trackIndex: number, is5: boolean): number {
  const ey = exonTopY(trackIndex);
  return is5 ? ey : ey + EXON_H - UTR_H;
}

// ── NC_ ↔ chr mapping ──────────────────────────────────────────────────────────
const NC_TO_CHR: [string, string][] = [
  ["NC_006088.5","chr1"],["NC_006089.5","chr2"],["NC_006090.5","chr3"],
  ["NC_006091.5","chr4"],["NC_006092.5","chr5"],["NC_006093.5","chr6"],
  ["NC_006094.5","chr7"],["NC_006095.5","chr8"],["NC_006096.5","chr9"],
  ["NC_006097.5","chr10"],["NC_006098.5","chr11"],["NC_006099.5","chr12"],
  ["NC_006100.5","chr13"],["NC_006101.5","chr14"],["NC_006102.5","chr15"],
  ["NC_006103.5","chr16"],["NC_006104.5","chr17"],["NC_006105.5","chr18"],
  ["NC_006106.5","chr19"],["NC_006107.5","chr20"],["NC_006108.5","chr21"],
  ["NC_006109.5","chr22"],["NC_006110.5","chr23"],["NC_006111.5","chr24"],
  ["NC_006112.4","chr25"],["NC_006113.5","chr26"],["NC_006114.5","chr27"],
  ["NC_006115.5","chr28"],["NC_008465.4","chr29"],["NC_028739.2","chr30"],
  ["NC_028740.2","chr31"],["NC_006119.4","chr32"],["NC_006126.5","chrW"],
  ["NC_006127.5","chrZ"],["NC_040902.1","chrMT"],
];

// ── Data processing (retained verbatim) ──────────────────────────────────────

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

// ── Coordinate conversion ──────────────────────────────────────────────────────
function bpToX(bp: number, svgW: number, totalLen: number): number {
  return LABEL_W + (bp / totalLen) * (svgW - LABEL_W - SUMMARY_W);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function GeneHeaderBar({
  geneSymbol, seqid, geneStart, geneEnd, strand,
  svgWidth, totalLen, transcriptCount,
}: {
  geneSymbol?: string;
  seqid: string;
  geneStart?: number;
  geneEnd?: number;
  strand: string;
  svgWidth: number;
  totalLen: number;
  transcriptCount: number;
}) {
  const chrId = seqid.startsWith("chr")
    ? seqid
    : (NC_TO_CHR.find(([k]) => k === seqid)?.[1] ?? seqid);
  const posLabel = geneStart && geneEnd
    ? `${chrId}:${geneStart.toLocaleString()}-${geneEnd.toLocaleString()}`
    : "";
  const span = geneStart && geneEnd ? formatBp(geneEnd - geneStart) : "";
  const strandArrow = strand === "+" ? "→" : "←";
  const innerW = svgWidth - LABEL_W - SUMMARY_W;

  return (
    <g>
      {/* Background strip */}
      <rect x={0} y={0} width={svgWidth} height={HEADER_H} fill={C.headerBg} />

      {/* Locus span bar — full width at bottom of header */}
      <rect
        x={LABEL_W + 4} y={HEADER_H - 10}
        width={innerW - 8} height={5}
        rx={2.5} fill={C.intron}
      />

      {/* Left side: gene name + strand */}
      <text x={12} y={HEADER_H - 18} fontSize={13} fill={C.textPrimary} fontFamily="monospace" fontWeight={700}>
        {geneSymbol || "Gene"}
      </text>
      <text x={12} y={HEADER_H - 5} fontSize={9} fill={C.textSecondary} fontFamily="monospace">
        {strandArrow} {strand === "+" ? "forward" : "reverse"} strand
      </text>

      {/* Right side: chr:range · transcripts · span */}
      <text
        x={svgWidth - SUMMARY_W - 8} y={HEADER_H - 18}
        fontSize={10} fill={C.textSecondary} fontFamily="monospace" textAnchor="end"
      >
        {posLabel}
      </text>
      <text x={svgWidth - SUMMARY_W - 8} y={HEADER_H - 5} fontSize={9} fill={C.textDim} fontFamily="monospace" textAnchor="end">
        {transcriptCount} transcript{transcriptCount !== 1 ? "s" : ""} · {span}
      </text>

      {/* Bottom border */}
      <line x1={0} y1={HEADER_H} x2={svgWidth} y2={HEADER_H} stroke={C.border} strokeWidth={1} />
    </g>
  );
}

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

  const ticks: number[] = [];
  for (let p = 0; p <= totalLength + interval; p += interval) ticks.push(p);

  return (
    <g>
      {/* Background */}
      <rect x={0} y={HEADER_H} width={svgWidth} height={RULER_H} fill={C.bg} />
      {/* Axis */}
      <line
        x1={LABEL_W} y1={HEADER_H + RULER_H}
        x2={svgWidth - SUMMARY_W} y2={HEADER_H + RULER_H}
        stroke={C.rulerLine} strokeWidth={1}
      />
      {/* Ticks + labels */}
      {ticks.map((bp) => {
        const x = bpToX(bp, svgWidth, totalLength);
        if (x < LABEL_W - 4 || x > svgWidth - SUMMARY_W + 4) return null;
        return (
          <g key={bp}>
            <line x1={x} y1={HEADER_H + RULER_H - 4} x2={x} y2={HEADER_H + RULER_H} stroke={C.rulerTick} strokeWidth={1} />
            <text
              x={x} y={HEADER_H + RULER_H - 7}
              textAnchor="middle" fontSize={8} fill={C.rulerText} fontFamily="monospace"
            >
              {formatBp(bp)}
            </text>
          </g>
        );
      })}
      {/* Bottom border */}
      <line x1={0} y1={HEADER_H + RULER_H} x2={svgWidth} y2={HEADER_H + RULER_H} stroke={C.border} strokeWidth={0.5} />
    </g>
  );
}

function TranscriptTrackRow({
  pt, trackIndex, totalLen, svgWidth, isActive, isHovered,
  onSelect, onExonClick,
}: {
  pt: ProcessedTranscript;
  trackIndex: number;
  totalLen: number;
  svgWidth: number;
  isActive: boolean;
  isHovered: boolean;
  onSelect: () => void;
  onExonClick: (exonIdx: number, absX: number, absY: number) => void;
}) {
  const y = HEADER_H + RULER_H + trackIndex * TRACK_FULL_H;
  const exonY = exonTopY(trackIndex);
  const cdsY = cdsTopY(trackIndex);
  const my = trackMidY(trackIndex);

  const txAcc = pt.tx.transcript_acc || pt.tx.transcript_id;
  const proteinCount = pt.tx.protein_count ?? 0;
  const rnaLen = pt.tx.rna_length ?? 0;
  const exonCount = pt.relativeExons.length;
  const cdsCount = pt.relativeExons.reduce((s, e) => s + e.cdsRegions.length, 0);
  const is5prime = pt.strand === "+";

  const rowBg = isActive ? C.activeRowBg : isHovered ? C.hoverRowBg : C.bg;
  const labelBg = isActive ? C.activeRowBg : C.labelBg;

  return (
    <g onClick={onSelect} style={{ cursor: "pointer" }}>
      {/* Active row — left blue border */}
      {isActive && (
        <rect x={0} y={y} width={3} height={TRACK_H} fill={C.activeBorder} />
      )}

      {/* Row background */}
      <rect x={0} y={y} width={svgWidth} height={TRACK_H} fill={rowBg} />

      {/* Row divider */}
      <line x1={0} y1={y + TRACK_H} x2={svgWidth} y2={y + TRACK_H} stroke={C.border} strokeWidth={0.5} />

      {/* ── Left label column ── */}
      <rect x={0} y={y} width={LABEL_W} height={TRACK_H} fill={labelBg} />
      <text x={8} y={y + 16} fontSize={10} fill={C.textPrimary} fontFamily="monospace" fontWeight={600}>
        {txAcc.length > 26 ? txAcc.slice(0, 24) + "…" : txAcc}
      </text>
      <text x={8} y={y + 30} fontSize={8} fill={C.textDim} fontFamily="monospace">
        {pt.tx.feature_type || "mRNA"}
        {proteinCount > 0 ? ` · ${proteinCount} prot` : ""}
        {rnaLen > 0 ? ` · ${formatBp(rnaLen)}` : ""}
      </text>

      {/* ── Right summary column ── */}
      <rect x={svgWidth - SUMMARY_W} y={y} width={SUMMARY_W} height={TRACK_H} fill={C.summaryBg} />
      <text x={svgWidth - SUMMARY_W + 8} y={y + 17} fontSize={9} fill={C.textPrimary} fontFamily="monospace">
        E{exonCount}
      </text>
      <text x={svgWidth - SUMMARY_W + 8} y={y + 30} fontSize={8} fill={C.textSecondary} fontFamily="monospace">
        CDS {cdsCount}
      </text>

      {/* ── Intron line ── */}
      <line
        x1={bpToX(0, svgWidth, totalLen)} y1={my}
        x2={bpToX(pt.totalLength, svgWidth, totalLen)} y2={my}
        stroke={C.intron} strokeWidth={INTRON_H}
      />

      {/* ── Direction arrows on intron ── */}
      {pt.relativeExons.length > 1 && Array.from({ length: Math.min(pt.relativeExons.length - 1, 16) }).map((_, i) => {
        const frac = (i + 0.5) / Math.min(pt.relativeExons.length - 1, 16);
        const bx = pt.totalLength * frac;
        const ax = bpToX(bx, svgWidth, totalLen);
        const ay = my - ARROW_H / 2;
        const dir = is5prime ? 1 : -1;
        return (
          <polygon
            key={i}
            points={is5prime
              ? `${ax - ARROW_W / 2},${ay} ${ax + ARROW_W / 2},${ay} ${ax + dir * ARROW_W / 2},${ay + ARROW_H}`
              : `${ax - ARROW_W / 2},${ay + ARROW_H} ${ax + ARROW_W / 2},${ay + ARROW_H} ${ax + dir * ARROW_W / 2},${ay}`}
            fill={C.intron}
            opacity={0.55}
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
            {/* Exon shell */}
            <rect
              x={exStart} y={exonY} width={exW} height={EXON_H}
              rx={3} ry={3}
              fill={C.exonShell}
              stroke={C.exonStroke}
              strokeWidth={0.8}
              style={{ cursor: "pointer" }}
              onClick={(ev) => {
                ev.stopPropagation();
                const rect = (ev.target as SVGRectElement).ownerSVGElement?.getBoundingClientRect();
                if (!rect) return;
                onExonClick(ei, ev.clientX - rect.left, ev.clientY - rect.top);
              }}
            />

            {/* CDS block — centered inside exon */}
            {exon.cdsRegions.map((cds, ci) => {
              const cdsX = bpToX(cds.start, svgWidth, totalLen);
              const cdsEndX = bpToX(cds.end, svgWidth, totalLen);
              const cdsW = Math.max(cdsEndX - cdsX, 2);
              return (
                <rect
                  key={ci}
                  x={cdsX} y={cdsY} width={cdsW} height={CDS_H}
                  rx={2} ry={2}
                  fill={C.cds}
                  style={{ cursor: "pointer" }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    const rect = (ev.target as SVGRectElement).ownerSVGElement?.getBoundingClientRect();
                    if (!rect) return;
                    onExonClick(ei, ev.clientX - rect.left, ev.clientY - rect.top);
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
                  x={utrX} y={utrTopY(trackIndex, utr.type === "5UTR")}
                  width={utrW} height={UTR_H}
                  rx={1} ry={1}
                  fill={C.utr}
                  stroke={C.utrBorder}
                  strokeWidth={0.6}
                  style={{ cursor: "pointer" }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    const rect = (ev.target as SVGRectElement).ownerSVGElement?.getBoundingClientRect();
                    if (!rect) return;
                    onExonClick(ei, ev.clientX - rect.left, ev.clientY - rect.top);
                  }}
                />
              );
            })}

            {/* Exon number label */}
            {exW > 20 && (
              <text
                x={exStart + exW / 2} y={exonY + EXON_H / 2 + 3}
                textAnchor="middle" fontSize={8} fill={C.textSecondary}
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

function ExonTooltipCard({
  region, exonIdx, txStart, strand,
  containerEl,
}: {
  region: ExonRegion;
  exonIdx: number;
  txStart: number;
  strand: string;
  containerEl: HTMLDivElement | null;
}) {
  const absStart = txStart + region.start;
  const absEnd = txStart + region.end;
  const absLen = absEnd - absStart;
  const cdsLen = region.cdsRegions.reduce((s, c) => s + (c.end - c.start), 0);
  const utr5Len = region.utrRegions.filter((u) => u.type === "5UTR").reduce((s, u) => s + (u.end - u.start), 0);
  const utr3Len = region.utrRegions.filter((u) => u.type === "3UTR").reduce((s, u) => s + (u.end - u.start), 0);
  const isNonCoding = cdsLen === 0;

  // Position at bottom of the plot area
  const containerW = containerEl?.clientWidth ?? 1000;
  const top = HEADER_H + RULER_H + 4;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: 0,
        top,
        width: containerW,
        zIndex: 20,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.tooltipBg,
          borderRadius: 10,
          padding: "10px 16px",
          minWidth: 220,
          boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
          pointerEvents: "auto",
        }}
      >
        <Group justify="space-between" align="center" mb={6}>
          <Group gap={4}>
            <Badge size="xs" color="blue" variant="filled">Exon {exonIdx + 1}</Badge>
            {isNonCoding && <Badge size="xs" color="gray" variant="light">Non-coding</Badge>}
          </Group>
          <Text size="xs" c="#9ca3af" ff="monospace">{absLen.toLocaleString()} bp</Text>
        </Group>
        <Text size="xs" c="white" ff="monospace" mb={4}>
          {absStart.toLocaleString()} — {absEnd.toLocaleString()}
        </Text>
        <Group gap={12} wrap="wrap">
          {cdsLen > 0 ? (
            <>
              <Text size="xs" c="#90cdf4">CDS: {cdsLen.toLocaleString()} bp {cdsLen > 0 ? `(${(cdsLen / absLen * 100).toFixed(0)}%)` : ""}</Text>
              {utr5Len > 0 && <Text size="xs" c="#cbd5e0">5&apos; UTR {utr5Len}</Text>}
              {utr3Len > 0 && <Text size="xs" c="#a0aec0">3&apos; UTR {utr3Len}</Text>}
            </>
          ) : (
            utr5Len > 0 && <Text size="xs" c="#cbd5e0">5&apos; UTR: {utr5Len.toLocaleString()} bp</Text>,
            utr3Len > 0 && <Text size="xs" c="#a0aec0">3&apos; UTR: {utr3Len.toLocaleString()} bp</Text>
          )}
        </Group>
      </div>
    </div>
  );
}

function TranscriptSummaryCard({
  pt,
}: {
  pt: ProcessedTranscript;
}) {
  const txAcc = pt.tx.transcript_acc || pt.tx.transcript_id;
  const cdsCount = pt.relativeExons.reduce((s, e) => s + e.cdsRegions.length, 0);
  const proteinCount = pt.tx.protein_count ?? 0;
  const rnaLen = pt.tx.rna_length ?? 0;
  const chrId = pt.tx.seqid?.startsWith("chr")
    ? pt.tx.seqid
    : (NC_TO_CHR.find(([k]) => k === pt.tx.seqid)?.[1] ?? pt.tx.seqid ?? "");

  return (
    <Box
      style={{
        background: C.summaryBg,
        borderTop: `1px solid ${C.border}`,
        padding: "10px 16px",
        display: "flex",
        gap: 28,
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
        <Text size="xs" ff="monospace">
          {chrId}:{pt.tx.start?.toLocaleString() ?? "?"}–{pt.tx.end?.toLocaleString() ?? "?"}
        </Text>
      </Group>
      <Group gap={4}>
        <Badge size="xs" color={pt.strand === "+" ? "teal" : "orange"} variant="light">
          {pt.strand === "+" ? "+ (forward)" : "− (reverse)"}
        </Badge>
      </Group>
      <Group gap={4}>
        <Text size="xs" c="dimmed">Exons</Text>
        <Badge size="xs" color="blue" variant="filled">{pt.relativeExons.length}</Badge>
      </Group>
      <Group gap={4}>
        <Text size="xs" c="dimmed">CDS</Text>
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
          <Text size="xs" c="dimmed">RNA</Text>
          <Text size="xs" ff="monospace">{formatBp(rnaLen)}</Text>
        </Group>
      )}
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
        <Text size="xs" c="dimmed">CDS</Text>
      </Group>
      <Group gap={5}>
        <svg width={22} height={14}>
          <rect x={1} y={2} width={20} height={10} rx={2} fill={C.exonShell} stroke={C.exonStroke} strokeWidth={0.8} />
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
          <polygon points="2,8 8,8 5,2" fill={C.intron} opacity={0.6} />
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
  const containerRef = useRef<HTMLDivElement>(null);

  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [hoveredTxId, setHoveredTxId] = useState<string | null>(null);
  const [clickedExon, setClickedExon] = useState<{
    exonIdx: number;
    region: ExonRegion;
    x: number;
    y: number;
  } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const processed = useMemo(() => transcripts.map(processTranscript), [transcripts]);
  const defaultPt = useMemo(() => pickDefault(processed), [processed]);

  const activePt = useMemo(
    () =>
      processed.find((p) => p.tx.transcript_id === (selectedTxId ?? defaultPt.tx.transcript_id))
      ?? defaultPt,
    [processed, selectedTxId, defaultPt]
  );

  const totalLen = Math.max(activePt.totalLength, 1);

  // Sort: protein-coding first, then RNA, then longer
  const sorted = useMemo(() => {
    return [...processed].sort((a, b) => {
      const aWins = (b.tx.protein_count ?? 0) - (a.tx.protein_count ?? 0);
      if (aWins !== 0) return aWins;
      const aRNA = b.tx.rna_sequence ? 1 : 0;
      const bRNA = a.tx.rna_sequence ? 1 : 0;
      if (aRNA !== bRNA) return aRNA - bRNA;
      return b.totalLength - a.totalLength;
    });
  }, [processed]);

  const FOLD_THRESHOLD = 8;
  const extraCount = sorted.length - FOLD_THRESHOLD;
  const displayTracks = (expanded || extraCount <= 0) ? sorted : sorted.slice(0, FOLD_THRESHOLD);

  const svgWidth = LABEL_W + SUMMARY_W + 820;
  const svgHeight = HEADER_H + RULER_H + displayTracks.length * TRACK_FULL_H;

  // ── Export PNG ──
  const exportPng = useCallback(() => {
    const svgEl = document.querySelector(".gene-structure-svg") as SVGSVGElement | null;
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

  const jbrowseHref = (() => {
    const { seqid } = activePt.tx;
    if (!seqid) return "#";
    const start = geneStart ?? activePt.tx.start;
    const end = geneEnd ?? activePt.tx.end;
    const chrId = seqid.startsWith("chr") ? seqid
      : (NC_TO_CHR.find(([k]) => k === seqid)?.[1] ?? seqid);
    const loc = `${chrId}:${Math.max(1, start)}..${end}`;
    const gs = geneSymbol ? `&geneSymbol=${encodeURIComponent(geneSymbol)}` : "";
    return `/jbrowse/gene?loc=${encodeURIComponent(loc)}${gs}`;
  })();

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
              size="sm" variant="subtle" color="blue" component="a"
              href={jbrowseHref}
              style={{ display: "inline-flex", cursor: "pointer" }}
            >
              <IconExternalLink size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* ── Legend ── */}
      <Legend />

      {/* ── Plot ── */}
      <Box
        ref={containerRef}
        style={{
          border: "1px solid #e0e0e0",
          borderRadius: 8,
          overflow: "visible",
          background: C.bg,
          position: "relative",
        }}
      >
        <svg
          className="gene-structure-svg"
          width="100%"
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ display: "block", position: "relative", zIndex: 1 }}
          onClick={(e) => {
            const target = e.target as SVGElement;
            // Close tooltip when clicking SVG background (not a rect/cds/utr which have their own handlers)
            if (target.tagName === "svg") {
              setClickedExon(null);
            }
          }}
        >
          {/* Gene header bar */}
          <GeneHeaderBar
            geneSymbol={geneSymbol}
            seqid={activePt.tx.seqid || ""}
            geneStart={geneStart}
            geneEnd={geneEnd}
            strand={activePt.strand}
            svgWidth={svgWidth}
            totalLen={totalLen}
            transcriptCount={processed.length}
          />

          {/* Shared ruler */}
          <RulerSvg totalLength={totalLen} svgWidth={svgWidth} />

          {/* Transcript tracks */}
          {displayTracks.map((pt, trackIndex) => (
            <g
              key={pt.tx.transcript_id}
              onMouseEnter={() => setHoveredTxId(pt.tx.transcript_id)}
              onMouseLeave={() => setHoveredTxId(null)}
            >
              <TranscriptTrackRow
                pt={pt}
                trackIndex={trackIndex}
                totalLen={totalLen}
                svgWidth={svgWidth}
                isActive={pt.tx.transcript_id === activePt.tx.transcript_id}
                isHovered={pt.tx.transcript_id === hoveredTxId}
                onSelect={() => {
                  setSelectedTxId(pt.tx.transcript_id);
                  setClickedExon(null);
                }}
                onExonClick={(ei, mx, my) => {
                  if (clickedExon?.exonIdx === ei) {
                    setClickedExon(null);
                  } else {
                    setClickedExon({ exonIdx: ei, region: pt.relativeExons[ei], x: mx, y: my });
                  }
                }}
              />
            </g>
          ))}

          {/* Fold / unfold row */}
          {extraCount > 0 && (
            <g
              style={{ cursor: "pointer" }}
              onClick={() => setExpanded((v) => !v)}
            >
              <rect
                x={0}
                y={HEADER_H + RULER_H + displayTracks.length * TRACK_FULL_H}
                width={svgWidth}
                height={TRACK_H}
                fill={C.labelBg}
              />
              <text
                x={svgWidth / 2}
                y={HEADER_H + RULER_H + displayTracks.length * TRACK_FULL_H + TRACK_H / 2 + 4}
                textAnchor="middle"
                fontSize={10}
                fill={C.textSecondary}
                fontFamily="monospace"
              >
                {expanded
                  ? "Show fewer transcripts"
                  : `+ ${extraCount} more transcript${extraCount !== 1 ? "s" : ""}`}
              </text>
            </g>
          )}
        </svg>

        {/* Click-triggered exon tooltip — positioned outside SVG */}
        {clickedExon && (
          <ExonTooltipCard
            region={clickedExon.region}
            exonIdx={clickedExon.exonIdx}
            txStart={activePt.txStart}
            strand={activePt.strand}
            containerEl={containerRef.current}
          />
        )}
      </Box>

      {/* ── Selected transcript summary ── */}
      <TranscriptSummaryCard pt={activePt} />
    </Stack>
  );
}
