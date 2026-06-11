import type { SyntenyFeature } from "../jbrowseSyntenyViewState";

const PAF_URL = "/comparative/paf/file?mode=natural&min_quality=30&min_identity=85&min_alignment_length=50000";

export interface LoadedPafSynteny {
  features: SyntenyFeature[];
  status: string;
  source: string;
  warning: string;
  isFallback: boolean;
}

const CHR_TO_GRCG6A_REFSEQ: Record<string, string> = {
  chr1: "NC_006088.5",
  chr2: "NC_006089.5",
  chr3: "NC_006090.5",
  chr4: "NC_006091.5",
  chr5: "NC_006092.5",
  chr6: "NC_006093.5",
  chr7: "NC_006094.5",
  chr8: "NC_006095.5",
  chr9: "NC_006096.5",
  chr10: "NC_006097.5",
  chr11: "NC_006098.5",
  chr12: "NC_006099.5",
  chr13: "NC_006100.5",
  chr14: "NC_006101.5",
  chr15: "NC_006102.5",
  chr16: "NC_006103.5",
  chr17: "NC_006104.5",
  chr18: "NC_006105.5",
  chr19: "NC_006106.5",
  chr20: "NC_006107.5",
  chr21: "NC_006108.5",
  chr22: "NC_006109.5",
  chr23: "NC_006110.5",
  chr24: "NC_006111.5",
  chr25: "NC_006112.4",
  chr26: "NC_006113.5",
  chr27: "NC_006114.5",
  chr28: "NC_006115.5",
  chr29: "NC_008465.4",
  chr30: "NC_028739.2",
  chr31: "NC_028740.2",
  chr32: "NC_006119.4",
  chrW: "NC_006126.5",
  chrZ: "NC_006127.5",
  chrMT: "NC_040902.1",
};

const GRCG6A_REFSEQ_TO_CHR = Object.fromEntries(
  Object.entries(CHR_TO_GRCG6A_REFSEQ).map(([chrName, accession]) => [accession, chrName]),
) as Record<string, string>;

const GRCG7B_REFSEQ_TO_CHR: Record<string, string> = {
  "NC_052532.1": "chr1",
  "NC_052533.1": "chr2",
  "NC_052534.1": "chr3",
  "NC_052535.1": "chr4",
  "NC_052536.1": "chr5",
  "NC_052537.1": "chr6",
  "NC_052538.1": "chr7",
  "NC_052539.1": "chr8",
  "NC_052540.1": "chr9",
  "NC_052541.1": "chr10",
  "NC_052542.1": "chr11",
  "NC_052543.1": "chr12",
  "NC_052544.1": "chr13",
  "NC_052545.1": "chr14",
  "NC_052546.1": "chr15",
  "NC_052547.1": "chr16",
  "NC_052548.1": "chr17",
  "NC_052549.1": "chr18",
  "NC_052550.1": "chr19",
  "NC_052551.1": "chr20",
  "NC_052552.1": "chr21",
  "NC_052553.1": "chr22",
  "NC_052554.1": "chr23",
  "NC_052555.1": "chr24",
  "NC_052556.1": "chr25",
  "NC_052557.1": "chr26",
  "NC_052558.1": "chr27",
  "NC_052559.1": "chr28",
  "NC_052560.1": "chr29",
  "NC_052561.1": "chr30",
  "NC_052562.1": "chr31",
  "NC_052563.1": "chr32",
  "NC_052571.1": "chrW",
  "NC_052572.1": "chrZ",
  "NC_024088.1": "chrMT",
  "NC_053523.1": "chrMT",
};

export async function loadPafSyntenyFeatures(): Promise<LoadedPafSynteny> {
  const response = await fetch(PAF_URL);
  if (!response.ok) {
    throw new Error(`Failed to load natural-breakpoint PAF synteny file: ${response.status}`);
  }
  const status = response.headers.get("X-Synteny-Layer-Status") || "primary";
  const source = response.headers.get("X-Synteny-Source-Path") || PAF_URL;
  const warning = response.headers.get("X-Synteny-Warning") || "";
  return {
    features: parsePaf(await response.text()),
    status,
    source,
    warning,
    isFallback: false,
  };
}

export function parsePaf(text: string): SyntenyFeature[] {
  return text
    .split(/\r?\n/)
    .map((line, index) => parsePafLine(line, index))
    .filter((feature): feature is SyntenyFeature => Boolean(feature));
}

export function findMateLocation(features: SyntenyFeature[], loc: string) {
  const parsed = parseLoc(loc);
  if (!parsed) return undefined;
  const refName = GRCG6A_REFSEQ_TO_CHR[parsed.refName] ?? parsed.refName;
  const hit = features.find((feature) => (
    feature.refName === refName &&
    feature.start < parsed.end &&
    feature.end > parsed.start
  ));
  if (!hit) return undefined;
  const mateStart = Math.max(1, hit.mate.start + 1);
  const mateEnd = Math.max(mateStart + 1, hit.mate.end);
  return `${hit.mate.refName}:${mateStart}..${mateEnd}`;
}

function parsePafLine(line: string, index: number): SyntenyFeature | undefined {
  if (!line.trim()) return undefined;
  const fields = line.split("\t");
  if (fields.length < 12) return undefined;
  const [
    queryName,
    ,
    queryStartRaw,
    queryEndRaw,
    strandRaw,
    targetName,
    ,
    targetStartRaw,
    targetEndRaw,
    matchesRaw,
    alignmentLengthRaw,
    mapqRaw,
  ] = fields;
  const queryStart = Number(queryStartRaw);
  const queryEnd = Number(queryEndRaw);
  const targetStart = Number(targetStartRaw);
  const targetEnd = Number(targetEndRaw);
  const alignmentLength = Number(alignmentLengthRaw);
  const score = Number(matchesRaw || mapqRaw || 0);
  if ([queryStart, queryEnd, targetStart, targetEnd, alignmentLength].some(Number.isNaN)) {
    return undefined;
  }

  const strand = strandRaw === "-" ? -1 : 1;
  const uniqueId = `grcg6a-grcg7b-paf-${index}`;
  const queryRefName = GRCG6A_REFSEQ_TO_CHR[queryName];
  const targetRefName = GRCG7B_REFSEQ_TO_CHR[targetName];
  if (!queryRefName || !targetRefName) {
    return undefined;
  }
  return {
    uniqueId,
    refName: queryRefName,
    start: queryStart,
    end: queryEnd,
    type: "match",
    name: `${queryRefName}:${queryStart + 1}-${queryEnd}`,
    strand,
    assemblyName: "GRCg6a",
    CIGAR: `${Math.max(1, alignmentLength)}M`,
    score,
    mate: {
      uniqueId: `${uniqueId}-mate`,
      refName: targetRefName,
      start: targetStart,
      end: targetEnd,
      type: "match",
      strand,
      assemblyName: "GRCg7b",
    },
  };
}

function parseLoc(loc: string) {
  const match = loc.match(/^(.+?):(\d+)\.\.(\d+)$/);
  if (!match) return undefined;
  const [, refName, startRaw, endRaw] = match;
  const start = Number(startRaw);
  const end = Number(endRaw);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  return { refName, start: Math.max(0, start - 1), end };
}
