/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useCallback, useMemo } from "react";
import { Box, Stack, Group, Text, Badge, ActionIcon, Paper } from "@mantine/core";
import { IconDownload, IconExternalLink, IconZoomIn, IconZoomOut } from "@tabler/icons-react";
import type { TranscriptResult } from "../../lib/geneApi";

interface GeneStructurePlotProps {
  transcripts: TranscriptResult[];
  geneSymbol?: string;
  geneStart?: number;
  geneEnd?: number;
}

interface CdsRegion {
  start: number; end: number; phase: number; cds_id: string; protein_id: string | null;
}

interface UtrRegion {
  start: number; end: number; type: "5UTR" | "3UTR";
}

interface ExonRegion {
  start: number; end: number; exon_id: string; cdsRegions: CdsRegion[]; utrRegions: UtrRegion[];
}

interface ProcessedTranscript {
  tx: TranscriptResult; relativeExons: ExonRegion[]; totalLength: number; txStart: number; strand: "+" | "-";
}

// ── Color palette ─────────────────────────────────────────────────────────────
const C = {
  bg: "#ffffff",
  headerBg: "#f8fafc",
  labelBg: "#f8fafc",
  summaryBg: "#f8fafc",
  activeRowBg: "#eaf4ff",
  activeBorder: "#2f6ea3",
  intron: "#98a2b3",
  exonShell: "#d7dee7",
  exonStroke: "#b0b8c7",
  cds: "#1f4e79",
  cdsHover: "#235789",
  utr: "#b8c4d3",
  utrBorder: "#9aacbe",
  hoverRowBg: "#f0f9ff",
  textPrimary: "#1f2937",
  textSecondary: "#6b7280",
  textDim: "#9ca3af",
  rulerLine: "#c7ced6",
  rulerTick: "#9aa4b2",
  rulerText: "#6b7280",
  tooltipBg: "rgba(18,18,24,0.95)",
  border: "#e5e7eb",
};

// ── Layout constants ───────────────────────────────────────────────────────────
const LABEL_W = 200;
const SUMMARY_W = 110;
const TRACK_H = 44;
const TRACK_PAD = 4;
const HEADER_H = 60;
const RULER_H = 28;
const EXON_H = 28;
const CDS_H = 18;
const UTR_H = 14;
const INTRON_H = 2;
const ARROW_H = 6;
const ARROW_W = 6;
const TRACK_FULL_H = TRACK_H + TRACK_PAD;

// Fixed SVG pixel dimensions at zoom=1
const BASE_TRACK_W = 820;  // inner track width at zoom=1
const SVG_W = LABEL_W + BASE_TRACK_W + SUMMARY_W; // 1130

// ── NC_ ↔ chr ────────────────────────────────────────────────────────────────
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

// ── Data processing ───────────────────────────────────────────────────────────
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
      cds_id: c.cds_id ?? "", protein_id: c.protein_id ?? null,
    }));
    const utrRegions: UtrRegion[] = [];
    if (cdsRegions.length === 0) {
      utrRegions.push({ start: er.start, end: er.end, type: "5UTR" as const });
    } else {
      const f = cdsRegions[0], l = cdsRegions[cdsRegions.length - 1];
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
// zoom: higher = viewBox is narrower = more horizontal stretch
// vbW = SVG_W / zoom  →  innerW = vbW - LABEL_W - SUMMARY_W
function bpToX(bp: number, totalLen: number, zoom: number): number {
  const vbW = SVG_W / zoom;
  const innerW = vbW - LABEL_W - SUMMARY_W;
  return LABEL_W + (bp / totalLen) * innerW;
}

function svgHFor(tracks: number): number {
  return HEADER_H + RULER_H + tracks * TRACK_FULL_H;
}

// ── Gene Header Bar ────────────────────────────────────────────────────────────
function GeneHeaderBar({
  geneSymbol, seqid, geneStart, geneEnd, strand, zoom, trackCount,
}: {
  geneSymbol?: string; seqid: string; geneStart?: number; geneEnd?: number;
  strand: string; zoom: number; trackCount: number;
}) {
  const vbW = SVG_W / zoom;
  const chrId = seqid.startsWith("chr") ? seqid : (NC_TO_CHR.find(([k]) => k === seqid)?.[1] ?? seqid);
  const posLabel = geneStart && geneEnd ? `${chrId}:${geneStart.toLocaleString()}-${geneEnd.toLocaleString()}` : "";
  const span = geneStart && geneEnd ? formatBp(geneEnd - geneStart) : "";
  const arrow = strand === "+" ? "→" : "←";
  const fs = Math.max(8, 8 * zoom);

  return (
    <g>
      <rect x={0} y={0} width={vbW} height={HEADER_H} fill={C.headerBg} />
      {/* Locus span bar */}
      <rect x={LABEL_W + 4} y={HEADER_H - 10} width={vbW - LABEL_W - SUMMARY_W - 8} height={5} rx={2.5} fill={C.intron} />
      {/* Gene name */}
      <text x={12} y={HEADER_H - 18} fontSize={Math.max(9, 13 * zoom)} fill={C.textPrimary} fontFamily="monospace" fontWeight={700}>
        {geneSymbol || "Gene"}
      </text>
      <text x={12} y={HEADER_H - 4} fontSize={Math.max(7, 9 * zoom)} fill={C.textSecondary} fontFamily="monospace">
        {arrow} {strand === "+" ? "forward" : "reverse"} strand
      </text>
      {/* Right metadata */}
      <text x={vbW - SUMMARY_W - 8} y={HEADER_H - 18} fontSize={Math.max(7, 10 * zoom)} fill={C.textSecondary} fontFamily="monospace" textAnchor="end">
        {posLabel}
      </text>
      <text x={vbW - SUMMARY_W - 8} y={HEADER_H - 4} fontSize={Math.max(7, 9 * zoom)} fill={C.textDim} fontFamily="monospace" textAnchor="end">
        {trackCount} transcript{trackCount !== 1 ? "s" : ""} · {span}
      </text>
      {/* Bottom border */}
      <line x1={0} y1={HEADER_H} x2={vbW} y2={HEADER_H} stroke={C.border} strokeWidth={1} />
    </g>
  );
}

// ── Ruler ─────────────────────────────────────────────────────────────────────
function RulerSvg({ totalLength, zoom }: { totalLength: number; zoom: number }) {
  const vbW = SVG_W / zoom;
  const innerW = vbW - LABEL_W - SUMMARY_W;
  const pxPerBp = innerW / totalLength;
  const fs = Math.max(7, 8 * zoom);

  // Adaptive interval: aim for ~8-15 ticks across the inner track width
  let rawInterval = innerW / (10 * pxPerBp);
  let interval = 20;
  const candidates = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
  for (const c of candidates) {
    interval = c;
    if (c >= rawInterval) break;
  }

  const ticks: number[] = [];
  for (let p = 0; p <= totalLength + interval; p += interval) ticks.push(p);

  return (
    <g>
      <rect x={0} y={HEADER_H} width={vbW} height={RULER_H} fill={C.bg} />
      <line x1={LABEL_W} y1={HEADER_H + RULER_H} x2={vbW - SUMMARY_W} y2={HEADER_H + RULER_H} stroke={C.rulerLine} strokeWidth={1} />
      {ticks.map((bp) => {
        const x = bpToX(bp, totalLength, zoom);
        if (x < LABEL_W - 2 || x > vbW - SUMMARY_W + 2) return null;
        return (
          <g key={bp}>
            <line x1={x} y1={HEADER_H + RULER_H - 4} x2={x} y2={HEADER_H + RULER_H} stroke={C.rulerTick} strokeWidth={1} />
            <text x={x} y={HEADER_H + RULER_H - 7} textAnchor="middle" fontSize={fs} fill={C.rulerText} fontFamily="monospace">
              {formatBp(bp)}
            </text>
          </g>
        );
      })}
      <line x1={0} y1={HEADER_H + RULER_H} x2={vbW} y2={HEADER_H + RULER_H} stroke={C.border} strokeWidth={0.5} />
    </g>
  );
}

// ── Transcript Track Row ──────────────────────────────────────────────────────
function TranscriptTrackRow({
  pt, trackIndex, totalLength, zoom, isActive, isHovered, onSelect, onExonClick,
}: {
  pt: ProcessedTranscript; trackIndex: number; totalLength: number; zoom: number;
  isActive: boolean; isHovered: boolean;
  onSelect: () => void; onExonClick: (exonIdx: number) => void;
}) {
  const vbW = SVG_W / zoom;
  const y = HEADER_H + RULER_H + trackIndex * TRACK_FULL_H;
  const exonY = y + (TRACK_H - EXON_H) / 2;
  const cdsY = exonY + (EXON_H - CDS_H) / 2;
  const my = y + TRACK_H / 2;

  const txAcc = pt.tx.transcript_acc || pt.tx.transcript_id;
  const proteinCount = pt.tx.protein_count ?? 0;
  const rnaLen = pt.tx.rna_length ?? 0;
  const exonCount = pt.relativeExons.length;
  const cdsCount = pt.relativeExons.reduce((s, e) => s + e.cdsRegions.length, 0);
  const is5prime = pt.strand === "+";

  const rowBg = isActive ? C.activeRowBg : isHovered ? C.hoverRowBg : C.bg;
  const labelBg = isActive ? C.activeRowBg : C.labelBg;
  const labelFs = Math.max(7, 10 * zoom);
  const metaFs = Math.max(6, 8 * zoom);

  return (
    <g onClick={onSelect} style={{ cursor: "pointer" }}>
      {isActive && <rect x={0} y={y} width={3} height={TRACK_H} fill={C.activeBorder} />}
      <rect x={0} y={y} width={vbW} height={TRACK_H} fill={rowBg} />
      <line x1={0} y1={y + TRACK_H} x2={vbW} y2={y + TRACK_H} stroke={C.border} strokeWidth={0.5} />

      {/* Left label */}
      <rect x={0} y={y} width={LABEL_W} height={TRACK_H} fill={labelBg} />
      <text x={8} y={y + 16} fontSize={labelFs} fill={C.textPrimary} fontFamily="monospace" fontWeight={600}>
        {txAcc.length > 26 ? txAcc.slice(0, 24) + "…" : txAcc}
      </text>
      <text x={8} y={y + 30} fontSize={metaFs} fill={C.textDim} fontFamily="monospace">
        {pt.tx.feature_type || "mRNA"}{proteinCount > 0 ? ` · ${proteinCount} prot` : ""}{rnaLen > 0 ? ` · ${formatBp(rnaLen)}` : ""}
      </text>

      {/* Right summary */}
      <rect x={vbW - SUMMARY_W} y={y} width={SUMMARY_W} height={TRACK_H} fill={C.summaryBg} />
      <text x={vbW - SUMMARY_W + 8} y={y + 17} fontSize={metaFs + 1} fill={C.textPrimary} fontFamily="monospace">
        E{exonCount}
      </text>
      <text x={vbW - SUMMARY_W + 8} y={y + 30} fontSize={metaFs} fill={C.textSecondary} fontFamily="monospace">
        CDS {cdsCount}
      </text>

      {/* Intron line */}
      <line x1={bpToX(0, totalLength, zoom)} y1={my} x2={bpToX(pt.totalLength, totalLength, zoom)} y2={my} stroke={C.intron} strokeWidth={INTRON_H} />

      {/* Direction arrows */}
      {pt.relativeExons.length > 1 && Array.from({ length: Math.min(pt.relativeExons.length - 1, 16) }).map((_, i) => {
        const frac = (i + 0.5) / Math.min(pt.relativeExons.length - 1, 16);
        const bx = pt.totalLength * frac;
        const ax = bpToX(bx, totalLength, zoom);
        const ay = my - ARROW_H / 2;
        const dir = is5prime ? 1 : -1;
        return (
          <polygon
            key={i}
            points={is5prime
              ? `${ax - ARROW_W / 2},${ay} ${ax + ARROW_W / 2},${ay} ${ax + dir * ARROW_W / 2},${ay + ARROW_H}`
              : `${ax - ARROW_W / 2},${ay + ARROW_H} ${ax + ARROW_W / 2},${ay + ARROW_H} ${ax + dir * ARROW_W / 2},${ay}`}
            fill={C.intron} opacity={0.55}
          />
        );
      })}

      {/* Exon blocks */}
      {pt.relativeExons.map((exon, ei) => {
        const exStart = bpToX(exon.start, totalLength, zoom);
        const exEnd = bpToX(exon.end, totalLength, zoom);
        const exW = Math.max(exEnd - exStart, 2);
        const exonFs = Math.max(6, 8 * zoom);

        return (
          <g key={ei}>
            <rect
              x={exStart} y={exonY} width={exW} height={EXON_H}
              rx={3} ry={3} fill={C.exonShell} stroke={C.exonStroke} strokeWidth={0.8}
              style={{ cursor: "pointer" }}
              onClick={(e) => { e.stopPropagation(); onExonClick(ei); }}
            />
            {/* CDS blocks */}
            {exon.cdsRegions.map((cds, ci) => {
              const cX = bpToX(cds.start, totalLength, zoom);
              const cEndX = bpToX(cds.end, totalLength, zoom);
              return (
                <rect key={ci} x={cX} y={cdsY} width={Math.max(cEndX - cX, 2)} height={CDS_H}
                  rx={2} ry={2} fill={C.cds} style={{ cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); onExonClick(ei); }}
                />
              );
            })}
            {/* UTR blocks */}
            {exon.utrRegions.map((utr, ui) => {
              const uX = bpToX(utr.start, totalLength, zoom);
              const uEndX = bpToX(utr.end, totalLength, zoom);
              const uY = utr.type === "5UTR" ? exonY : exonY + EXON_H - UTR_H;
              return (
                <rect key={ui} x={uX} y={uY} width={Math.max(uEndX - uX, 2)} height={UTR_H}
                  rx={1} ry={1} fill={C.utr} stroke={C.utrBorder} strokeWidth={0.6}
                  style={{ cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); onExonClick(ei); }}
                />
              );
            })}
            {/* Exon label */}
            {exW > 20 && (
              <text x={exStart + exW / 2} y={exonY + EXON_H / 2 + 3} textAnchor="middle"
                fontSize={exonFs} fill={C.textSecondary} fontFamily="monospace" fontWeight={500}
                style={{ pointerEvents: "none" }}>
                E{ei + 1}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

// ── Exon Tooltip ──────────────────────────────────────────────────────────────
function ExonTooltipCard({ exonIdx, region, txStart, onClose }: {
  exonIdx: number; region: ExonRegion; txStart: number; onClose: () => void;
}) {
  const absStart = txStart + region.start;
  const absEnd = txStart + region.end;
  const absLen = absEnd - absStart;
  const cdsLen = region.cdsRegions.reduce((s, c) => s + (c.end - c.start), 0);
  const utr5 = region.utrRegions.filter((u) => u.type === "5UTR").reduce((s, u) => s + (u.end - u.start), 0);
  const utr3 = region.utrRegions.filter((u) => u.type === "3UTR").reduce((s, u) => s + (u.end - u.start), 0);
  const isNonCoding = cdsLen === 0;

  return (
    <div style={{
      background: C.tooltipBg, borderRadius: 10, padding: "10px 16px",
      minWidth: 260, boxShadow: "0 6px 24px rgba(0,0,0,0.5)", position: "relative",
    }}>
      <button onClick={onClose} style={{
        position: "absolute", top: 6, right: 8, background: "transparent",
        border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 14,
        lineHeight: 1, padding: "2px 4px",
      }}>✕</button>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ background: "#3b82f6", color: "#fff", fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 4, fontFamily: "monospace" }}>
          Exon {exonIdx + 1}
        </span>
        {isNonCoding && (
          <span style={{ background: "#6b7280", color: "#fff", fontSize: 10, padding: "1px 6px", borderRadius: 3, fontFamily: "monospace" }}>
            Non-coding
          </span>
        )}
        <span style={{ marginLeft: "auto", color: "#9ca3af", fontSize: 11, fontFamily: "monospace" }}>
          {absLen.toLocaleString()} bp
        </span>
      </div>

      <div style={{ color: "#fff", fontSize: 12, fontFamily: "monospace", marginBottom: 8 }}>
        {absStart.toLocaleString()} — {absEnd.toLocaleString()}
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {cdsLen > 0 ? (
          <>
            <span style={{ color: "#90cdf4", fontSize: 11, fontFamily: "monospace" }}>
              CDS: {cdsLen.toLocaleString()} bp ({(cdsLen / absLen * 100).toFixed(0)}%)
            </span>
            {utr5 > 0 && <span style={{ color: "#cbd5e0", fontSize: 11, fontFamily: "monospace" }}>5&apos; UTR: {utr5.toLocaleString()}</span>}
            {utr3 > 0 && <span style={{ color: "#a0aec0", fontSize: 11, fontFamily: "monospace" }}>3&apos; UTR: {utr3.toLocaleString()}</span>}
          </>
        ) : (
          <>
            {utr5 > 0 && <span style={{ color: "#cbd5e0", fontSize: 11, fontFamily: "monospace" }}>5&apos; UTR: {utr5.toLocaleString()} bp</span>}
            {utr3 > 0 && <span style={{ color: "#a0aec0", fontSize: 11, fontFamily: "monospace" }}>3&apos; UTR: {utr3.toLocaleString()} bp</span>}
          </>
        )}
      </div>
    </div>
  );
}

// ── Transcript Summary ────────────────────────────────────────────────────────
function TranscriptSummaryCard({ pt }: { pt: ProcessedTranscript }) {
  const txAcc = pt.tx.transcript_acc || pt.tx.transcript_id;
  const cdsCount = pt.relativeExons.reduce((s, e) => s + e.cdsRegions.length, 0);
  const proteinCount = pt.tx.protein_count ?? 0;
  const rnaLen = pt.tx.rna_length ?? 0;
  const chrId = pt.tx.seqid?.startsWith("chr") ? pt.tx.seqid : (NC_TO_CHR.find(([k]) => k === pt.tx.seqid)?.[1] ?? pt.tx.seqid ?? "");

  return (
    <Box style={{ background: C.summaryBg, borderTop: `1px solid ${C.border}`, padding: "10px 16px", display: "flex", gap: 24, flexWrap: "wrap" as const, alignItems: "center" }}>
      <Group gap={4}><Text size="xs" c="dimmed">Transcript</Text><Text size="xs" fw={600} ff="monospace">{txAcc}</Text></Group>
      <Group gap={4}><Text size="xs" c="dimmed">Location</Text><Text size="xs" ff="monospace">{chrId}:{pt.tx.start?.toLocaleString() ?? "?"}–{pt.tx.end?.toLocaleString() ?? "?"}</Text></Group>
      <Badge size="xs" color={pt.strand === "+" ? "teal" : "orange"} variant="light">
        {pt.strand === "+" ? "+ (forward)" : "− (reverse)"}
      </Badge>
      <Group gap={4}><Text size="xs" c="dimmed">Exons</Text><Badge size="xs" color="blue" variant="filled">{pt.relativeExons.length}</Badge></Group>
      <Group gap={4}><Text size="xs" c="dimmed">CDS</Text><Badge size="xs" style={{ background: C.cds, color: "#fff" }}>{cdsCount}</Badge></Group>
      {proteinCount > 0 && <Group gap={4}><Text size="xs" c="dimmed">Proteins</Text><Badge size="xs" color="green" variant="light">{proteinCount}</Badge></Group>}
      {rnaLen > 0 && <Group gap={4}><Text size="xs" c="dimmed">RNA</Text><Text size="xs" ff="monospace">{formatBp(rnaLen)}</Text></Group>}
    </Box>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────
function Legend() {
  return (
    <Group gap="lg" wrap="wrap">
      <Group gap={5}><svg width={22} height={14}><rect x={1} y={1} width={20} height={12} rx={3} fill={C.cds} /></svg><Text size="xs" c="dimmed">CDS</Text></Group>
      <Group gap={5}><svg width={22} height={14}><rect x={1} y={2} width={20} height={10} rx={2} fill={C.exonShell} stroke={C.exonStroke} strokeWidth={0.8} /></svg><Text size="xs" c="dimmed">Exon</Text></Group>
      <Group gap={5}><svg width={22} height={14}><rect x={1} y={3} width={20} height={8} rx={1} fill={C.utr} stroke={C.utrBorder} strokeWidth={0.6} /></svg><Text size="xs" c="dimmed">5&apos;/3&apos; UTR</Text></Group>
      <Group gap={5}><svg width={22} height={14}><line x1={0} y1={7} x2={22} y2={7} stroke={C.intron} strokeWidth={2} /></svg><Text size="xs" c="dimmed">Intron</Text></Group>
      <Group gap={5}><svg width={10} height={10}><polygon points="2,8 8,8 5,2" fill={C.intron} opacity={0.6} /></svg><Text size="xs" c="dimmed">Direction</Text></Group>
    </Group>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function GeneStructurePlot({ transcripts, geneSymbol, geneStart, geneEnd }: GeneStructurePlotProps) {
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [hoveredTxId, setHoveredTxId] = useState<string | null>(null);
  const [clickedExon, setClickedExon] = useState<{ exonIdx: number; region: ExonRegion } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);

  const processed = useMemo(() => transcripts.map(processTranscript), [transcripts]);
  const defaultPt = useMemo(() => pickDefault(processed), [processed]);

  const activePt = useMemo(
    () => processed.find((p) => p.tx.transcript_id === (selectedTxId ?? defaultPt.tx.transcript_id)) ?? defaultPt,
    [processed, selectedTxId, defaultPt]
  );

  const totalLen = Math.max(activePt.totalLength, 1);

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

  // Zoom: higher zoom → narrower viewBox → same SVG display width = horizontal stretch
  const vbW = SVG_W / zoom;
  const svgH = svgHFor(displayTracks.length);

  const ZOOM_MIN = 0.3;
  const ZOOM_MAX = 5;
  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, parseFloat((z * 1.3).toFixed(2))));
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, parseFloat((z / 1.3).toFixed(2))));
  const zoomReset = () => setZoom(1);

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
    return <Paper withBorder p="md"><Text size="sm" c="dimmed">No transcript data</Text></Paper>;
  }

  const jbrowseHref = (() => {
    const { seqid } = activePt.tx;
    if (!seqid) return "#";
    const start = geneStart ?? activePt.tx.start;
    const end = geneEnd ?? activePt.tx.end;
    const chrId = seqid.startsWith("chr") ? seqid : (NC_TO_CHR.find(([k]) => k === seqid)?.[1] ?? seqid);
    const loc = `${chrId}:${Math.max(1, start)}..${end}`;
    const gs = geneSymbol ? `&geneSymbol=${encodeURIComponent(geneSymbol)}` : "";
    return `/jbrowse/gene?loc=${encodeURIComponent(loc)}${gs}`;
  })();

  return (
    <Stack gap="xs">
      {/* Header */}
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <Text size="xs" fw={600} c="dimmed">Gene Structure — {geneSymbol ?? "Unknown"}</Text>
          <Badge size="xs" variant="light" color="gray">{processed.length} transcript{processed.length !== 1 ? "s" : ""}</Badge>
          {activePt.tx.seqid && (
            <Badge size="xs" variant="light" color="gray">
              {activePt.tx.seqid.startsWith("chr") ? activePt.tx.seqid : (NC_TO_CHR.find(([k]) => k === activePt.tx.seqid)?.[1] ?? activePt.tx.seqid)}
            </Badge>
          )}
        </Group>

        {/* Zoom controls — no Tooltip wrapper to avoid click blocking */}
        <Group gap={4}>
          <ActionIcon size="sm" variant="subtle" onClick={zoomOut} title="Zoom out"><IconZoomOut size={14} /></ActionIcon>
          <Text size="xs" ff="monospace" c="dimmed" w={36} ta="center">{Math.round(zoom * 100)}%</Text>
          <ActionIcon size="sm" variant="subtle" onClick={zoomIn} title="Zoom in"><IconZoomIn size={14} /></ActionIcon>
          <ActionIcon size="sm" variant="subtle" onClick={zoomReset} title="Reset zoom"><IconZoomOut size={12} style={{ transform: "rotate(180deg)" }} /></ActionIcon>
          <ActionIcon size="sm" variant="subtle" onClick={exportPng} title="Export PNG"><IconDownload size={14} /></ActionIcon>
          <ActionIcon size="sm" variant="subtle" color="blue" component="a" href={jbrowseHref} title="Open in JBrowse" style={{ display: "inline-flex", cursor: "pointer" }}><IconExternalLink size={14} /></ActionIcon>
        </Group>
      </Group>

      <Legend />

      {/* Plot */}
      <Box style={{ background: C.bg, position: "relative", overflowX: "auto" as const, overflowY: "hidden" as const }}>
        {/*
          SVG approach: width=SVG_W (fixed), viewBox shrinks with zoom.
          zoom=1 → viewBox="0 0 1130 H", width=1130px  (normal)
          zoom=2 → viewBox="0 0 565 H",  width=1130px  (2× horizontal stretch)
          zoom=0.5→ viewBox="0 0 2260 H", width=1130px  (compressed)
        */}
        <svg
          className="gene-structure-svg"
          width={SVG_W}
          height={svgH}
          viewBox={`0 0 ${vbW} ${svgH}`}
          style={{ display: "block" }}
        >
          {/* Background click → close tooltip */}
          <rect x={0} y={0} width={vbW} height={svgH} fill="transparent"
            onClick={() => setClickedExon(null)} />

          <GeneHeaderBar geneSymbol={geneSymbol} seqid={activePt.tx.seqid || ""}
            geneStart={geneStart} geneEnd={geneEnd} strand={activePt.strand}
            zoom={zoom} trackCount={processed.length} />

          <RulerSvg totalLength={totalLen} zoom={zoom} />

          {displayTracks.map((pt, trackIndex) => (
            <g key={pt.tx.transcript_id}
              onMouseEnter={() => setHoveredTxId(pt.tx.transcript_id)}
              onMouseLeave={() => setHoveredTxId(null)}>
              <TranscriptTrackRow
                pt={pt} trackIndex={trackIndex} totalLength={totalLen} zoom={zoom}
                isActive={pt.tx.transcript_id === activePt.tx.transcript_id}
                isHovered={pt.tx.transcript_id === hoveredTxId}
                onSelect={() => { setSelectedTxId(pt.tx.transcript_id); setClickedExon(null); }}
                onExonClick={(ei) => setClickedExon((p) => p?.exonIdx === ei ? null : { exonIdx: ei, region: pt.relativeExons[ei] })}
              />
            </g>
          ))}

          {/* Fold row */}
          {extraCount > 0 && (
            <g style={{ cursor: "pointer" }} onClick={() => setExpanded((v) => !v)}>
              <rect x={0} y={svgH - TRACK_H} width={vbW} height={TRACK_H} fill={C.labelBg} />
              <text x={vbW / 2} y={svgH - TRACK_H / 2 + 4} textAnchor="middle"
                fontSize={Math.max(7, 10 * zoom)} fill={C.textSecondary} fontFamily="monospace">
                {expanded ? "Show fewer transcripts" : `+ ${extraCount} more transcript${extraCount !== 1 ? "s" : ""}`}
              </text>
            </g>
          )}

          {/* Tooltip via foreignObject */}
          {clickedExon && (
            <foreignObject x={0} y={svgH + 8} width={vbW} height={130}>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <ExonTooltipCard
                  exonIdx={clickedExon.exonIdx} region={clickedExon.region}
                  txStart={activePt.txStart} onClose={() => setClickedExon(null)}
                />
              </div>
            </foreignObject>
          )}
        </svg>
      </Box>

      <TranscriptSummaryCard pt={activePt} />
    </Stack>
  );
}
