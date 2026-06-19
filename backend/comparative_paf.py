"""PAF parsing helpers for natural-breakpoint comparative synteny datasets."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Literal, Optional


AlignmentMode = Literal["natural"]

PRIMARY_CHROMOSOMES = [
    "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
    "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
    "21", "22", "23", "24", "25", "26", "27", "28", "29", "30",
    "31", "32", "W", "Z", "MT",
]

GRCG6A_REFSEQ_TO_CHR = {
    "NC_006088.5": "1",
    "NC_006089.5": "2",
    "NC_006090.5": "3",
    "NC_006091.5": "4",
    "NC_006092.5": "5",
    "NC_006093.5": "6",
    "NC_006094.5": "7",
    "NC_006095.5": "8",
    "NC_006096.5": "9",
    "NC_006097.5": "10",
    "NC_006098.5": "11",
    "NC_006099.5": "12",
    "NC_006100.5": "13",
    "NC_006101.5": "14",
    "NC_006102.5": "15",
    "NC_006103.5": "16",
    "NC_006104.5": "17",
    "NC_006105.5": "18",
    "NC_006106.5": "19",
    "NC_006107.5": "20",
    "NC_006108.5": "21",
    "NC_006109.5": "22",
    "NC_006110.5": "23",
    "NC_006111.5": "24",
    "NC_006112.4": "25",
    "NC_006113.5": "26",
    "NC_006114.5": "27",
    "NC_006115.5": "28",
    "NC_008465.4": "29",
    "NC_028739.2": "30",
    "NC_028740.2": "31",
    "NC_006119.4": "32",
    "NC_006126.5": "W",
    "NC_006127.5": "Z",
    "NC_040902.1": "MT",
}

GRCG7B_REFSEQ_TO_CHR = {
    "NC_052532.1": "1",
    "NC_052533.1": "2",
    "NC_052534.1": "3",
    "NC_052535.1": "4",
    "NC_052536.1": "5",
    "NC_052537.1": "6",
    "NC_052538.1": "7",
    "NC_052539.1": "8",
    "NC_052540.1": "9",
    "NC_052541.1": "10",
    "NC_052542.1": "11",
    "NC_052543.1": "12",
    "NC_052544.1": "13",
    "NC_052545.1": "14",
    "NC_052546.1": "15",
    "NC_052547.1": "16",
    "NC_052548.1": "17",
    "NC_052549.1": "18",
    "NC_052550.1": "19",
    "NC_052551.1": "20",
    "NC_052552.1": "21",
    "NC_052553.1": "22",
    "NC_052554.1": "23",
    "NC_052555.1": "24",
    "NC_052556.1": "25",
    "NC_052557.1": "26",
    "NC_052558.1": "27",
    "NC_052559.1": "28",
    "NC_052560.1": "29",
    "NC_052561.1": "30",
    "NC_052562.1": "31",
    "NC_052563.1": "32",
    "NC_052571.1": "W",
    "NC_052572.1": "Z",
    "NC_024088.1": "MT",
    "NC_053523.1": "MT",
}


@dataclass(frozen=True)
class PafRecord:
    block_id: str
    query_name: str
    query_length: int
    query_start: int
    query_end: int
    strand: str
    target_name: str
    target_length: int
    target_start: int
    target_end: int
    residue_matches: int
    alignment_length: int
    mapping_quality: int
    identity: float
    chr_1: str
    start_1: int
    end_1: int
    chr_2: str
    start_2: int
    end_2: int
    score: int
    is_primary_chromosome_pair: bool
    is_same_chromosome: bool

    def to_dict(self) -> dict:
        return asdict(self)


def normalize_chr(assembly: str, ref_name: str) -> str:
    """Normalize RefSeq accessions and chr-prefixed labels to plain chromosome names."""
    if assembly == "GRCg6a":
        mapped = GRCG6A_REFSEQ_TO_CHR.get(ref_name)
    elif assembly == "GRCg7b":
        mapped = GRCG7B_REFSEQ_TO_CHR.get(ref_name)
    else:
        mapped = None
    if mapped:
        return mapped
    if ref_name.startswith("chr"):
        return ref_name[3:]
    return ref_name


def chromosome_sort_key(chr_name: str) -> tuple[int, int | str]:
    normalized = chr_name[3:] if chr_name.startswith("chr") else chr_name
    if normalized in PRIMARY_CHROMOSOMES:
        return (0, PRIMARY_CHROMOSOMES.index(normalized))
    try:
        return (1, int(normalized))
    except ValueError:
        return (2, normalized)


def parse_paf_line(
    line: str,
    index: int,
    assembly_1: str = "GRCg6a",
    assembly_2: str = "GRCg7b",
) -> Optional[PafRecord]:
    if not line.strip() or line.startswith("#"):
        return None

    fields = line.rstrip("\n").split("\t")
    if len(fields) < 12:
        return None

    try:
        query_name = fields[0]
        query_length = int(fields[1])
        query_start = int(fields[2])
        query_end = int(fields[3])
        strand = fields[4]
        target_name = fields[5]
        target_length = int(fields[6])
        target_start = int(fields[7])
        target_end = int(fields[8])
        residue_matches = int(fields[9])
        alignment_length = int(fields[10])
        mapping_quality = int(fields[11])
    except ValueError:
        return None

    if alignment_length <= 0 or query_end <= query_start or target_end <= target_start:
        return None
    if strand not in {"+", "-"}:
        strand = "+"

    chr_1 = normalize_chr(assembly_1, query_name)
    chr_2 = normalize_chr(assembly_2, target_name)
    identity = round((residue_matches / alignment_length) * 100, 4)
    return PafRecord(
        block_id=f"paf-{index}",
        query_name=query_name,
        query_length=query_length,
        query_start=query_start,
        query_end=query_end,
        strand=strand,
        target_name=target_name,
        target_length=target_length,
        target_start=target_start,
        target_end=target_end,
        residue_matches=residue_matches,
        alignment_length=alignment_length,
        mapping_quality=mapping_quality,
        identity=identity,
        chr_1=chr_1,
        start_1=query_start,
        end_1=query_end,
        chr_2=chr_2,
        start_2=target_start,
        end_2=target_end,
        score=residue_matches,
        is_primary_chromosome_pair=chr_1 in PRIMARY_CHROMOSOMES and chr_2 in PRIMARY_CHROMOSOMES,
        is_same_chromosome=chr_1 == chr_2,
    )


def read_paf_records(
    path: Path,
    *,
    assembly_1: str = "GRCg6a",
    assembly_2: str = "GRCg7b",
    chr_1: Optional[str] = None,
    chr_2: Optional[str] = None,
    min_mapq: int = 0,
    min_identity: float = 0.0,
    min_alignment_length: int = 0,
    limit: Optional[int] = None,
    order: Literal["coordinate", "score"] = "coordinate",
) -> list[PafRecord]:
    records: list[PafRecord] = []
    if not path.exists():
        return records

    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for index, line in enumerate(handle):
            record = parse_paf_line(line, index, assembly_1=assembly_1, assembly_2=assembly_2)
            if record is None:
                continue
            if chr_1 and record.chr_1 != chr_1:
                continue
            if chr_2 and record.chr_2 != chr_2:
                continue
            if record.mapping_quality < min_mapq:
                continue
            if record.identity < min_identity:
                continue
            if record.alignment_length < min_alignment_length:
                continue
            records.append(record)

    if order == "score":
        records.sort(key=lambda r: (r.score, r.alignment_length, r.identity), reverse=True)
    else:
        records.sort(
            key=lambda r: (
                chromosome_sort_key(r.chr_1),
                r.start_1,
                chromosome_sort_key(r.chr_2),
                r.start_2,
            )
        )

    if limit is not None:
        return records[:limit]
    return records


def _merge_interval_length(intervals: Iterable[tuple[int, int]]) -> int:
    sorted_intervals = sorted((start, end) for start, end in intervals if end > start)
    if not sorted_intervals:
        return 0

    merged = 0
    current_start, current_end = sorted_intervals[0]
    for start, end in sorted_intervals[1:]:
        if start <= current_end:
            current_end = max(current_end, end)
        else:
            merged += current_end - current_start
            current_start, current_end = start, end
    merged += current_end - current_start
    return merged


def _coverage_by_chromosome(records: Iterable[PafRecord], side: Literal["query", "target"]) -> tuple[int, dict[str, int]]:
    intervals: dict[str, list[tuple[int, int]]] = {}
    for record in records:
        if side == "query":
            intervals.setdefault(record.chr_1, []).append((record.start_1, record.end_1))
        else:
            intervals.setdefault(record.chr_2, []).append((record.start_2, record.end_2))

    per_chr = {chr_name: _merge_interval_length(values) for chr_name, values in intervals.items()}
    return sum(per_chr.values()), per_chr


def summarize_paf_records(
    records: list[PafRecord],
    *,
    dataset: AlignmentMode,
    source_path: Path,
) -> dict:
    block_count = len(records)
    file_size = source_path.stat().st_size if source_path.exists() else 0
    if not records:
        return {
            "dataset": dataset,
            "source_path": str(source_path),
            "source_exists": source_path.exists(),
            "file_size_bytes": file_size,
            "block_count": 0,
            "dataset_classification": "missing",
            "coordinate_system": "PAF 0-based half-open",
        }

    total_alignment_bases = sum(record.alignment_length for record in records)
    total_matches = sum(record.residue_matches for record in records)
    query_covered_bases, query_coverage_by_chr = _coverage_by_chromosome(records, "query")
    target_covered_bases, target_coverage_by_chr = _coverage_by_chromosome(records, "target")
    query_total_bases = sum({record.query_name: record.query_length for record in records}.values())
    target_total_bases = sum({record.target_name: record.target_length for record in records}.values())
    classification = "natural-breakpoint whole-genome alignment"

    identities = [record.identity for record in records]
    mapqs = [record.mapping_quality for record in records]

    return {
        "dataset": dataset,
        "source_path": str(source_path),
        "source_exists": source_path.exists(),
        "file_size_bytes": file_size,
        "block_count": block_count,
        "dataset_classification": classification,
        "coordinate_system": "PAF 0-based half-open",
        "total_alignment_bases": total_alignment_bases,
        "residue_matches": total_matches,
        "weighted_identity": round((total_matches / total_alignment_bases) * 100, 4),
        "avg_identity": round(sum(identities) / block_count, 4),
        "min_identity": min(identities),
        "max_identity": max(identities),
        "avg_mapq": round(sum(mapqs) / block_count, 4),
        "chromosomes_1": len({record.chr_1 for record in records}),
        "chromosomes_2": len({record.chr_2 for record in records}),
        "same_chromosome_blocks": sum(1 for record in records if record.is_same_chromosome),
        "off_diagonal_blocks": sum(1 for record in records if not record.is_same_chromosome),
        "reverse_strand_blocks": sum(1 for record in records if record.strand == "-"),
        "primary_chromosome_blocks": sum(1 for record in records if record.is_primary_chromosome_pair),
        "query_covered_bases": query_covered_bases,
        "target_covered_bases": target_covered_bases,
        "query_total_bases": query_total_bases,
        "target_total_bases": target_total_bases,
        "query_coverage_fraction": round(query_covered_bases / query_total_bases, 6) if query_total_bases else 0,
        "target_coverage_fraction": round(target_covered_bases / target_total_bases, 6) if target_total_bases else 0,
        "query_coverage_by_chr": query_coverage_by_chr,
        "target_coverage_by_chr": target_coverage_by_chr,
    }


def records_to_dicts(records: Iterable[PafRecord]) -> list[dict]:
    return [record.to_dict() for record in records]
