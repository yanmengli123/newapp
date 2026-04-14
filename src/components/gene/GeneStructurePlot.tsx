/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Box, Stack, Group, Text, Badge, ActionIcon, Paper } from "@mantine/core";
import { IconDownload, IconExternalLink, IconZoomIn, IconZoomOut, IconFocus2 } from "@tabler/icons-react";
import type { TranscriptResult } from "../../lib/geneApi";

interface GeneStructurePlotProps {
  transcripts: TranscriptResult[];
  geneSymbol?: string;
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
  tooltipBg: "rgba(18,18,24,0.96)",
  border: "#e5e7eb",
  highlightBorder: "#3b82f6",
};

// ── Layout constants (fixed screen pixels) ────────────────────────────────────
const LABEL_W = 200;
const SUMMARY_W = 110;
const TRACK_H = 44;
const TRACK_PAD = 4;
const HEADER_H = 60;
const RULER_H = 30;
const EXON_H = 28;
const CDS_H = 18;
const UTR_H = 14;
const INTRON_H = 2;
const ARROW_H = 6;
const ARROW_W = 6;
const TRACK_FULL_H = TRACK_H + TRACK_PAD;
const SVG_W = 1130;
const CARD_W = 260;
const CARD_H = 140;

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
  if (bp >= 1_000_000) return `${(bp / 1_000_000).toFixed(1)} Mb`;
  if (bp >= 1_000) return `${(bp / 1_000).toFixed(1)} kb`;
  return `${bp} bp`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ── SVG height ───────────────────────────────────────────────────────────────
function svgHFor(tracks: number): number {
  return HEADER_H + RULER_H + tracks * TRACK_FULL_H;
}

// ── bp → SVG screen pixel X ────────────────────────────────────────────────────
function bpToX(bp: number, startBp: number, spanBp: number): number {
  if (spanBp <= 0) return LABEL_W;
  const innerW = SVG_W - LABEL_W - SUMMARY_W;
  return LABEL_W + ((bp - startBp) / spanBp) * innerW;
}

// ── Ruler ─────────────────────────────────────────────────────────────────────
function RulerSvg({ startBp, spanBp }: { startBp: number; spanBp: number }) {
  const innerW = SVG_W - LABEL_W - SUMMARY_W;

  // Adaptive tick: aim for 5-7 major ticks across the viewport
  let rawInterval = spanBp / 6;
  let interval = 1;
  const candidates = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
  for (const c of candidates) {
    interval = c;
    if (c >= rawInterval) break;
  }

  const ticks: number[] = [];
  const firstTick = Math.floor(startBp / interval) * interval;
  for (let bp = firstTick; bp <= startBp + spanBp + interval; bp += interval) ticks.push(bp);

  return (
    <g>
      <rect x={0} y={HEADER_H} width={SVG_W} height={RULER_H} fill={C.bg} />
      <line x1={LABEL_W} y1={HEADER_H + RULER_H} x2={SVG_W - SUMMARY_W} y2={HEADER_H + RULER_H} stroke={C.rulerLine} strokeWidth={1} />
      {ticks.map((bp) => {
        const x = bpToX(bp, startBp, spanBp);
        if (x < LABEL_W - 2 || x > SVG_W - SUMMARY_W + 2) return null;
        const isMajor = bp % interval === 0;
        return (
          <g key={bp}>
            <line
              x1={x} y1={HEADER_H + (isMajor ? RULER_H - 6 : RULER_H - 3)}
              x2={x} y2={HEADER_H + RULER_H}
              stroke={isMajor ? C.rulerTick : C.rulerLine} strokeWidth={isMajor ? 1 : 0.5}
            />
            {isMajor && (
              <text x={x} y={HEADER_H + RULER_H - 8} textAnchor="middle"
                fontSize={9} fill={C.rulerText} fontFamily="monospace">
                {formatBp(bp)}
              </text>
            )}
          </g>
        );
      })}
      <line x1={0} y1={HEADER_H + RULER_H} x2={SVG_W} y2={HEADER_H + RULER_H} stroke={C.border} strokeWidth={0.5} />
    </g>
  );
}

// ── Gene Header Bar ────────────────────────────────────────────────────────────
function GeneHeaderBar({
  geneSymbol, strand, startBp, spanBp, trackCount,
}: {
  geneSymbol?: string; strand: string; startBp: number; spanBp: number; trackCount: number;
}) {
  const arrow = strand === "+" ? "→" : "←";
  return (
    <g>
      <rect x={0} y={0} width={SVG_W} height={HEADER_H} fill={C.headerBg} />
      <rect x={LABEL_W + 4} y={HEADER_H - 10} width={SVG_W - LABEL_W - SUMMARY_W - 8} height={5} rx={2.5} fill={C.intron} />
      <text x={12} y={HEADER_H - 18} fontSize={13} fill={C.textPrimary} fontFamily="monospace" fontWeight={700}>
        {geneSymbol || "Gene"}
      </text>
      <text x={12} y={HEADER_H - 4} fontSize={9} fill={C.textSecondary} fontFamily="monospace">
        {arrow} {strand === "+" ? "forward" : "reverse"} strand
      </text>
      <text x={SVG_W - SUMMARY_W - 8} y={HEADER_H - 18} fontSize={10} fill={C.textSecondary} fontFamily="monospace" textAnchor="end">
        {formatBp(startBp)} – {formatBp(startBp + spanBp)}
      </text>
      <text x={SVG_W - SUMMARY_W - 8} y={HEADER_H - 4} fontSize={9} fill={C.textDim} fontFamily="monospace" textAnchor="end">
        {formatBp(spanBp)} window · {trackCount} transcript{trackCount !== 1 ? "s" : ""}
      </text>
      <line x1={0} y1={HEADER_H} x2={SVG_W} y2={HEADER_H} stroke={C.border} strokeWidth={1} />
    </g>
  );
}

// ── Transcript Track Row ────────────────────────────────────────────────────────
function TranscriptTrackRow({
  pt, trackIndex, startBp, spanBp, isActive, isHovered, isDragging,
  onSelect, onExonClick,
}: {
  pt: ProcessedTranscript; trackIndex: number; startBp: number; spanBp: number;
  isActive: boolean; isHovered: boolean; isDragging: boolean;
  onSelect: () => void; onExonClick: (exonIdx: number, anchorRect: DOMRect) => void;
}) {
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

  const handleExonClick = (e: React.MouseEvent, exonIdx: number) => {
    e.stopPropagation();
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    onExonClick(exonIdx, rect);
  };

  return (
    <g onClick={onSelect} style={{ cursor: isDragging ? "grabbing" : "default" }}>
      {isActive && <rect x={0} y={y} width={3} height={TRACK_H} fill={C.activeBorder} />}
      <rect x={0} y={y} width={SVG_W} height={TRACK_H} fill={rowBg} />
      <line x1={0} y1={y + TRACK_H} x2={SVG_W} y2={y + TRACK_H} stroke={C.border} strokeWidth={0.5} />

      {/* Left label */}
      <rect x={0} y={y} width={LABEL_W} height={TRACK_H} fill={labelBg} />
      <text x={8} y={y + 16} fontSize={10} fill={C.textPrimary} fontFamily="monospace" fontWeight={600}>
        {txAcc.length > 26 ? txAcc.slice(0, 24) + "…" : txAcc}
      </text>
      <text x={8} y={y + 30} fontSize={8} fill={C.textDim} fontFamily="monospace">
        {pt.tx.feature_type || "mRNA"}{proteinCount > 0 ? ` · ${proteinCount} prot` : ""}{rnaLen > 0 ? ` · ${formatBp(rnaLen)}` : ""}
      </text>

      {/* Right summary */}
      <rect x={SVG_W - SUMMARY_W} y={y} width={SUMMARY_W} height={TRACK_H} fill={C.summaryBg} />
      <text x={SVG_W - SUMMARY_W + 8} y={y + 17} fontSize={9} fill={C.textPrimary} fontFamily="monospace">E{exonCount}</text>
      <text x={SVG_W - SUMMARY_W + 8} y={y + 30} fontSize={8} fill={C.textSecondary} fontFamily="monospace">CDS {cdsCount}</text>

      {/* Intron line */}
      <line
        x1={bpToX(0, startBp, spanBp)} y1={my}
        x2={bpToX(pt.totalLength, startBp, spanBp)} y2={my}
        stroke={C.intron} strokeWidth={INTRON_H}
      />

      {/* Direction arrows */}
      {pt.relativeExons.length > 1 && Array.from({ length: Math.min(pt.relativeExons.length - 1, 16) }).map((_, i) => {
        const frac = (i + 0.5) / Math.min(pt.relativeExons.length - 1, 16);
        const bx = pt.totalLength * frac;
        const ax = bpToX(bx, startBp, spanBp);
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
        const exStart = bpToX(exon.start, startBp, spanBp);
        const exEnd = bpToX(exon.end, startBp, spanBp);
        const exW = Math.max(exEnd - exStart, 2);
        const isHighlighted = isHovered || isActive;

        return (
          <g key={ei}>
            <rect
              x={exStart} y={exonY} width={exW} height={EXON_H}
              rx={3} ry={3}
              fill={C.exonShell} stroke={isHighlighted ? C.highlightBorder : C.exonStroke}
              strokeWidth={isHighlighted ? 1.5 : 0.8}
              style={{ cursor: isDragging ? "grabbing" : "pointer", transition: "stroke 0.12s, stroke-width 0.12s" }}
              onClick={(e) => handleExonClick(e, ei)}
            />
            {exon.cdsRegions.map((cds, ci) => {
              const cX = bpToX(cds.start, startBp, spanBp);
              const cEndX = bpToX(cds.end, startBp, spanBp);
              return (
                <rect key={ci} x={cX} y={cdsY} width={Math.max(cEndX - cX, 2)} height={CDS_H}
                  rx={2} ry={2} fill={C.cds}
                  style={{ cursor: isDragging ? "grabbing" : "pointer", transition: "opacity 0.12s" }}
                  onClick={(e) => handleExonClick(e, ei)}
                />
              );
            })}
            {exon.utrRegions.map((utr, ui) => {
              const uX = bpToX(utr.start, startBp, spanBp);
              const uEndX = bpToX(utr.end, startBp, spanBp);
              const uY = utr.type === "5UTR" ? exonY : exonY + EXON_H - UTR_H;
              return (
                <rect key={ui} x={uX} y={uY} width={Math.max(uEndX - uX, 2)} height={UTR_H}
                  rx={1} ry={1} fill={C.utr} stroke={C.utrBorder} strokeWidth={0.6}
                  style={{ cursor: isDragging ? "grabbing" : "pointer" }}
                  onClick={(e) => handleExonClick(e, ei)}
                />
              );
            })}
            {exW > 20 && (
              <text x={exStart + exW / 2} y={exonY + EXON_H / 2 + 3} textAnchor="middle"
                fontSize={8} fill={C.textSecondary} fontFamily="monospace" fontWeight={500}
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

// ── Exon Info Card (fixed-size, collision-aware, screen-space) ───────────────
function ExonTooltipCard({
  exonIdx, region, txStart, containerRect, onClose,
}: {
  exonIdx: number; region: ExonRegion; txStart: number;
  containerRect: DOMRect; onClose: () => void;
}) {
  const absStart = txStart + region.start;
  const absEnd = txStart + region.end;
  const absLen = absEnd - absStart;
  const cdsLen = region.cdsRegions.reduce((s, c) => s + (c.end - c.start), 0);
  const utr5 = region.utrRegions.filter((u) => u.type === "5UTR").reduce((s, u) => s + (u.end - u.start), 0);
  const utr3 = region.utrRegions.filter((u) => u.type === "3UTR").reduce((s, u) => s + (u.end - u.start), 0);
  const isNonCoding = cdsLen === 0;

  const anchorCenterX = containerRect.left + containerRect.width / 2;
  const anchorCenterY = containerRect.top + containerRect.height / 2;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const CARD_OFFSET = 14;
  let left: number, top: number;
  const cardLeft = anchorCenterX - CARD_W / 2;
  const cardRight = cardLeft + CARD_W;

  if (vw - cardRight >= CARD_OFFSET) {
    left = Math.min(cardLeft, vw - CARD_W - 12);
    top = anchorCenterY + CARD_OFFSET;
    if (top + CARD_H > vh - 12) top = anchorCenterY - CARD_H - CARD_OFFSET;
  } else if (cardLeft >= CARD_OFFSET) {
    left = Math.max(12, cardLeft - (cardRight - vw) - 12);
    top = anchorCenterY + CARD_OFFSET;
    if (top + CARD_H > vh - 12) top = anchorCenterY - CARD_H - CARD_OFFSET;
  } else {
    left = Math.max(12, Math.min(cardLeft, vw - CARD_W - 12));
    top = anchorCenterY + CARD_OFFSET;
    if (top + CARD_H > vh - 12) top = anchorCenterY - CARD_H - CARD_OFFSET;
  }

  left = Math.max(8, Math.min(left, vw - CARD_W - 8));
  top = Math.max(8, Math.min(top, vh - CARD_H - 8));

  return (
    <div style={{
      position: "fixed",
      left, top,
      width: CARD_W,
      background: C.tooltipBg, borderRadius: 10, padding: "10px 16px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      zIndex: 9999,
      animation: "tooltipIn 0.12s ease-out",
    }}>
      <style>{`@keyframes tooltipIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
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

// ── Transcript Summary ─────────────────────────────────────────────────────────
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

// ── Legend ─────────────────────────────────────────────────────────────────────
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

// ── Main component ─────────────────────────────────────────────────────────────
export default function GeneStructurePlot({ transcripts, geneSymbol }: GeneStructurePlotProps) {
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [hoveredTxId, setHoveredTxId] = useState<string | null>(null);
  const [activeExon, setActiveExon] = useState<{
    exonIdx: number; region: ExonRegion; anchorRect: DOMRect;
  } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // ── Viewport state ─────────────────────────────────────────────────────────
  const [viewport, setViewport] = useState<{ startBp: number; endBp: number }>({
    startBp: 0,
    endBp: totalLen,
  });

  // Reset viewport when active transcript changes
  useEffect(() => {
    setViewport({ startBp: 0, endBp: totalLen });
  }, [activePt.tx.transcript_id, totalLen]);

  const startBp = viewport.startBp;
  const spanBp = viewport.endBp - viewport.startBp;
  const innerW = SVG_W - LABEL_W - SUMMARY_W;

  const svgH = svgHFor(displayTracks.length);

  // Dynamic minimum span: at least 1% of total, or 50bp, whichever is larger
  const minSpan = Math.max(50, Math.ceil(totalLen * 0.01));

  // ── Zoom at mouse position ─────────────────────────────────────────────────
  const zoomAt = useCallback((clientX: number, factor: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    if (mouseX < LABEL_W || mouseX > SVG_W - SUMMARY_W) return;

    const mouseBp = startBp + ((mouseX - LABEL_W) / innerW) * spanBp;
    const newSpan = clamp(spanBp / factor, minSpan, totalLen);
    const newStart = clamp(mouseBp - ((mouseX - LABEL_W) / innerW) * newSpan, 0, totalLen - newSpan);

    setViewport({ startBp: Math.max(0, newStart), endBp: Math.min(totalLen, newStart + newSpan) });
    setActiveExon(null);
  }, [startBp, spanBp, innerW, minSpan, totalLen]);

  // Button zoom: anchor at screen center
  const zoomInAtCenter = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, 1.5);
  }, [zoomAt]);

  const zoomOutAtCenter = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, 1 / 1.5);
  }, [zoomAt]);

  const fitToGene = useCallback(() => {
    setViewport({ startBp: 0, endBp: totalLen });
  }, [totalLen]);

  // ── Drag-to-pan ────────────────────────────────────────────────────────────
  const dragRef = useRef<{
    active: boolean;
    startClientX: number;
    startVp: { startBp: number; endBp: number };
  }>({ active: false, startClientX: 0, startVp: { startBp: 0, endBp: totalLen } });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as Element;
    const isTrackElement = target.closest("rect") || target.closest("text") || target.closest("line") || target.closest("polygon");
    if (isTrackElement) return;

    dragRef.current = { active: true, startClientX: e.clientX, startVp: { startBp, endBp: startBp + spanBp } };
    setActiveExon(null);
  }, [startBp, spanBp]);

  // Global listeners for drag — needed because mouse may leave SVG during drag
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d.active) return;
      const deltaX = e.clientX - d.startClientX;
      const bpDelta = (deltaX / innerW) * spanBp;
      const newStart = clamp(d.startVp.startBp - bpDelta, 0, totalLen - spanBp);
      setViewport({ startBp: newStart, endBp: newStart + spanBp });
    };
    const onUp = () => {
      dragRef.current.active = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [innerW, spanBp, totalLen]);

  // ── Wheel zoom ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25;
      zoomAt(e.clientX, factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Close tooltip on viewport change
  const prevViewport = useRef(viewport);
  useEffect(() => {
    const same =
      Math.abs(prevViewport.current.startBp - viewport.startBp) < 0.5 &&
      Math.abs(prevViewport.current.endBp - viewport.endBp) < 0.5;
    if (!same) setActiveExon(null);
    prevViewport.current = viewport;
  }, [viewport]);

  // ── PNG export ─────────────────────────────────────────────────────────────
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
    const start = activePt.tx.start;
    const end = activePt.tx.end;
    const chrId = seqid.startsWith("chr") ? seqid : (NC_TO_CHR.find(([k]) => k === seqid)?.[1] ?? seqid);
    const loc = `${chrId}:${Math.max(1, start)}..${end}`;
    const gs = geneSymbol ? `&geneSymbol=${encodeURIComponent(geneSymbol)}` : "";
    return `/jbrowse/gene?loc=${encodeURIComponent(loc)}${gs}`;
  })();

  const isDragging = dragRef.current.active;

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

        {/* Toolbar */}
        <Group gap={4}>
          <ActionIcon size="sm" variant="subtle" onClick={zoomOutAtCenter} title="Zoom out (show more)"><IconZoomOut size={14} /></ActionIcon>
          <Text size="xs" ff="monospace" c="dimmed" w={50} ta="center">{formatBp(spanBp)}</Text>
          <ActionIcon size="sm" variant="subtle" onClick={zoomInAtCenter} title="Zoom in (show less)"><IconZoomIn size={14} /></ActionIcon>
          <ActionIcon size="sm" variant="subtle" onClick={fitToGene} title="Fit to transcript"><IconFocus2 size={13} /></ActionIcon>
          <ActionIcon size="sm" variant="subtle" onClick={exportPng} title="Export PNG"><IconDownload size={14} /></ActionIcon>
          <ActionIcon size="sm" variant="subtle" color="blue" component="a" href={jbrowseHref} title="Open in JBrowse" style={{ display: "inline-flex", cursor: "pointer" }}><IconExternalLink size={14} /></ActionIcon>
        </Group>
      </Group>

      <Legend />

      {/* Track area — drag-to-pan, wheel-to-zoom */}
      <Box
        ref={containerRef}
        style={{
          background: C.bg,
          position: "relative",
          overflowX: "auto",
          overflowY: "hidden",
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
        }}
        onMouseDown={handleMouseDown}
      >
        <svg
          className="gene-structure-svg"
          width={SVG_W}
          height={svgH}
          style={{ display: "block" }}
        >
          {/* Background — close tooltip on click */}
          <rect x={0} y={0} width={SVG_W} height={svgH} fill="transparent"
            onClick={() => setActiveExon(null)} />

          <GeneHeaderBar
            geneSymbol={geneSymbol} seqid={activePt.tx.seqid || ""}
            strand={activePt.strand}
            startBp={startBp} spanBp={spanBp} trackCount={processed.length}
          />

          <RulerSvg startBp={startBp} spanBp={spanBp} />

          {displayTracks.map((pt, trackIndex) => (
            <g key={pt.tx.transcript_id}
              onMouseEnter={() => setHoveredTxId(pt.tx.transcript_id)}
              onMouseLeave={() => setHoveredTxId(null)}>
              <TranscriptTrackRow
                pt={pt} trackIndex={trackIndex}
                startBp={startBp} spanBp={spanBp}
                isActive={pt.tx.transcript_id === activePt.tx.transcript_id}
                isHovered={pt.tx.transcript_id === hoveredTxId}
                isDragging={isDragging}
                onSelect={() => { setSelectedTxId(pt.tx.transcript_id); setActiveExon(null); }}
                onExonClick={(ei, rect) => setActiveExon((p) =>
                  p?.exonIdx === ei ? null : { exonIdx: ei, region: pt.relativeExons[ei], anchorRect: rect }
                )}
              />
            </g>
          ))}

          {/* Fold row */}
          {extraCount > 0 && (
            <g style={{ cursor: "pointer" }} onClick={() => setExpanded((v) => !v)}>
              <rect x={0} y={svgH - TRACK_H} width={SVG_W} height={TRACK_H} fill={C.labelBg} />
              <text x={SVG_W / 2} y={svgH - TRACK_H / 2 + 4} textAnchor="middle"
                fontSize={10} fill={C.textSecondary} fontFamily="monospace">
                {expanded ? "Show fewer transcripts" : `+ ${extraCount} more transcript${extraCount !== 1 ? "s" : ""}`}
              </text>
            </g>
          )}
        </svg>

        {/* Tooltip in screen space */}
        {activeExon && (
          <ExonTooltipCard
            exonIdx={activeExon.exonIdx}
            region={activeExon.region}
            txStart={activePt.txStart}
            containerRect={activeExon.anchorRect}
            onClose={() => setActiveExon(null)}
          />
        )}
      </Box>

      <TranscriptSummaryCard pt={activePt} />
    </Stack>
  );
}
