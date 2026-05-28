"""Build filtered GRCg7b assets for the JBrowse comparative view.

The output keeps only the chromosome set used by the GRCg6a browser:
chr1-chr32, chrW, chrZ, and chrMT. GFF records of type region and
cDNA_match are excluded so the GRCg7b gene track stays focused.
"""

from __future__ import annotations

import gzip
from pathlib import Path


PROJECTDATA = Path(r"D:\jbrowsedata\projectdata")
GRCG7B_DIR = PROJECTDATA / "grcg7b"

SOURCE_FASTA = GRCG7B_DIR / "GCF_016699485.2_bGalGal1.mat.broiler.GRCg7b_genomic.fna.gz"
SOURCE_GFF = GRCG7B_DIR / "GCF_016699485.2_bGalGal1.mat.broiler.GRCg7b_genomic.gff.gz"

OUT_FASTA = PROJECTDATA / "GCF_016699485.2_GRCg7b_main_chr.fna"
OUT_FAI = PROJECTDATA / "GCF_016699485.2_GRCg7b_main_chr.fna.fai"
OUT_GFF = PROJECTDATA / "GCF_016699485.2_GRCg7b_main_chr.gff.gz"
OUT_ALIASES = PROJECTDATA / "grcg7b_main_aliases.txt"

MAIN_CHROMOSOMES = {
    **{f"NC_0525{31 + i:02d}.1": f"chr{i}" for i in range(1, 33)},
    "NC_052571.1": "chrW",
    "NC_052572.1": "chrZ",
    "NC_053523.1": "chrMT",
}

DROP_GFF_TYPES = {"region", "cDNA_match"}


def open_text(path: Path):
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8", errors="replace")
    return path.open("rt", encoding="utf-8", errors="replace")


def write_filtered_fasta() -> None:
    kept = 0
    with open_text(SOURCE_FASTA) as src, OUT_FASTA.open("w", encoding="ascii", newline="\n") as out:
        write_record = False
        for line in src:
            if line.startswith(">"):
                accession = line[1:].split()[0]
                chr_name = MAIN_CHROMOSOMES.get(accession)
                write_record = chr_name is not None
                if write_record:
                    kept += 1
                    out.write(f">{chr_name} {accession} GRCg7b main chromosome\n")
                continue
            if write_record:
                out.write(line.upper())
    print(f"FASTA records kept: {kept}")


def write_fai() -> None:
    offset = 0
    records: list[tuple[str, int, int, int, int]] = []
    current_name: str | None = None
    current_length = 0
    seq_offset = 0
    line_bases = 0
    line_width = 0

    with OUT_FASTA.open("rb") as fasta:
        for raw_line in fasta:
            if raw_line.startswith(b">"):
                if current_name is not None:
                    records.append((current_name, current_length, seq_offset, line_bases, line_width))
                current_name = raw_line[1:].split()[0].decode("ascii")
                current_length = 0
                seq_offset = offset + len(raw_line)
                line_bases = 0
                line_width = 0
            else:
                stripped = raw_line.rstrip(b"\r\n")
                if stripped and line_bases == 0:
                    line_bases = len(stripped)
                    line_width = len(raw_line)
                current_length += len(stripped)
            offset += len(raw_line)

    if current_name is not None:
        records.append((current_name, current_length, seq_offset, line_bases, line_width))

    with OUT_FAI.open("w", encoding="ascii", newline="\n") as fai:
        for record in records:
            fai.write("\t".join(map(str, record)) + "\n")
    print(f"FAI records written: {len(records)}")


def write_filtered_gff() -> None:
    kept = 0
    dropped_type = 0
    dropped_seq = 0
    with open_text(SOURCE_GFF) as src, gzip.open(OUT_GFF, "wt", encoding="utf-8", newline="\n") as out:
        for line in src:
            if line.startswith("##sequence-region "):
                parts = line.rstrip("\n").split()
                if len(parts) >= 4 and parts[1] in MAIN_CHROMOSOMES:
                    out.write(f"##sequence-region {MAIN_CHROMOSOMES[parts[1]]} {parts[2]} {parts[3]}\n")
                continue
            if line.startswith("#"):
                out.write(line)
                continue

            parts = line.rstrip("\n").split("\t")
            if len(parts) < 9:
                continue
            chr_name = MAIN_CHROMOSOMES.get(parts[0])
            if chr_name is None:
                dropped_seq += 1
                continue
            if parts[2] in DROP_GFF_TYPES:
                dropped_type += 1
                continue
            parts[0] = chr_name
            out.write("\t".join(parts) + "\n")
            kept += 1
    print(f"GFF records kept: {kept}; dropped by type: {dropped_type}; dropped by seqid: {dropped_seq}")


def write_aliases() -> None:
    rows = ["# alias\tNCBI accession"]
    for accession, chr_name in sorted(
        MAIN_CHROMOSOMES.items(),
        key=lambda item: (100 if item[1] in {"chrW", "chrZ"} else 101 if item[1] == "chrMT" else int(item[1][3:])),
    ):
        rows.append(f"{chr_name}\t{accession}")
    OUT_ALIASES.write_text("\n".join(rows) + "\n", encoding="ascii")


def main() -> None:
    for source in (SOURCE_FASTA, SOURCE_GFF):
        if not source.exists():
            raise FileNotFoundError(source)
    write_filtered_fasta()
    write_fai()
    write_filtered_gff()
    write_aliases()


if __name__ == "__main__":
    main()
