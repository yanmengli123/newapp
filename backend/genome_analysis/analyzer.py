"""Genome analyzer: comprehensive genome analysis with styled chart export."""

import gzip
import json
import logging
import time
from collections import Counter
from pathlib import Path
from typing import Iterator

import pandas as pd

from backend.config import GRCG6A_DB_PATH, GRCG6A_GENOME_OUTPUT

logger = logging.getLogger("grcg6a_fastapi_backend.analyzer")

# =============================================================================
# Output directories
# =============================================================================
JOBS_DIR = GRCG6A_GENOME_OUTPUT  # 直接使用，与 task_manager 的 output_dir 保持一致
PUBLIC_CAROUSEL_DIR = GRCG6A_GENOME_OUTPUT / "public" / "genome_carousel"

# Carousel dimensions
CAROUSEL_W = 1600
CAROUSEL_H = 900

# Data directory
DATA_DIR = GRCG6A_DB_PATH.parent


def get_job_dir(job_id: str) -> Path:
    return JOBS_DIR / job_id


def ensure_dirs(job_id: str) -> dict:
    """Create all job output directories."""
    job_dir = get_job_dir(job_id)
    dirs = {
        "job": job_dir,
        "metadata": job_dir / "metadata",
        "result": job_dir / "result",
        "charts": job_dir / "charts",
        "tables": job_dir / "tables",
    }
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)
    # Ensure carousel dir
    PUBLIC_CAROUSEL_DIR.mkdir(parents=True, exist_ok=True)
    return dirs


# =============================================================================
# File readers
# =============================================================================
def read_fasta(file_path: Path) -> Iterator[tuple[str, str]]:
    """Read FASTA file, handling gzip."""
    if str(file_path).endswith(".gz"):
        with gzip.open(file_path, "rt", encoding="utf-8") as f:
            yield from _parse_fasta(f)
    else:
        with open(file_path, "r", encoding="utf-8") as f:
            yield from _parse_fasta(f)


def _parse_fasta(f) -> Iterator[tuple[str, str]]:
    current_header = None
    current_seq = []
    for line in f:
        line = line.strip()
        if not line:
            continue
        if line.startswith(">"):
            if current_header is not None:
                yield current_header, "".join(current_seq)
            current_header = line[1:]
            current_seq = []
        else:
            current_seq.append(line)
    if current_header is not None:
        yield current_header, "".join(current_seq)


def read_gff(file_path: Path) -> Iterator[dict]:
    """Read GFF file, handling gzip."""
    if str(file_path).endswith(".gz"):
        opener = gzip.open
        mode = "rt"
    else:
        opener = open
        mode = "r"

    with opener(file_path, mode, encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            parts = line.strip().split("\t")
            if len(parts) < 9:
                continue

            attrs = {}
            for item in parts[8].split(";"):
                if "=" in item:
                    key, value = item.split("=", 1)
                    attrs[key.strip()] = value.strip()

            yield {
                "seqid": parts[0],
                "feature_type": parts[2],
                "start": int(parts[3]),
                "end": int(parts[4]),
                "strand": parts[6],
                "attributes": attrs,
            }


# =============================================================================
# Utility functions
# =============================================================================
def gc_content(seq: str) -> float:
    """Calculate GC percentage."""
    if not seq:
        return 0.0
    seq_upper = seq.upper()
    gc = seq_upper.count("G") + seq_upper.count("C")
    return (gc / len(seq_upper)) * 100


def codon_usage(seq: str) -> dict:
    """Calculate codon usage."""
    codons = [seq[i:i+3].upper() for i in range(0, len(seq) - len(seq) % 3, 3)]
    return dict(Counter(c for c in codons if len(c) == 3))


def rscu(codon_counts: dict) -> dict:
    """Calculate Relative Synonymous Codon Usage."""
    aa_groups = {
        "F": ["TTT", "TTC"], "L": ["TTA", "TTG", "CTT", "CTC", "CTA", "CTG"],
        "I": ["ATT", "ATC", "ATA"], "M": ["ATG"], "V": ["GTT", "GTC", "GTA", "GTG"],
        "S": ["TCT", "TCC", "TCA", "TCG", "AGT", "AGC"],
        "P": ["CCT", "CCC", "CCA", "CCG"], "T": ["ACT", "ACC", "ACA", "ACG"],
        "A": ["GCT", "GCC", "GCA", "GCG"], "Y": ["TAT", "TAC"],
        "H": ["CAT", "CAC"], "Q": ["CAA", "CAG"], "N": ["AAT", "AAC"],
        "K": ["AAA", "AAG"], "D": ["GAT", "GAC"], "E": ["GAA", "GAG"],
        "C": ["TGT", "TGC"], "W": ["TGG"], "R": ["CGT", "CGC", "CGA", "CGG", "AGA", "AGG"],
    }
    rscu_values = {}
    for aa, codons in aa_groups.items():
        total = sum(codon_counts.get(c, 0) for c in codons)
        degeneracy = len(codons)
        for c in codons:
            obs = codon_counts.get(c, 0)
            exp = total / degeneracy if degeneracy > 0 else 0
            rscu_values[c] = obs / exp if exp > 0 else 1.0
    return rscu_values


def save_table(df: pd.DataFrame, name: str, tables_dir: Path) -> dict:
    """Save table to CSV, JSON, XLSX."""
    tables_dir.mkdir(parents=True, exist_ok=True)
    result = {}
    try:
        csv_path = tables_dir / f"{name}.csv"
        df.to_csv(csv_path, index=False)
        result["csv"] = str(csv_path)
    except Exception as e:
        logger.warning(f"Failed to save CSV {name}: {e}")

    try:
        json_path = tables_dir / f"{name}.json"
        df.to_json(json_path, orient="records", indent=2, force_ascii=False)
        result["json"] = str(json_path)
    except Exception as e:
        logger.warning(f"Failed to save JSON {name}: {e}")

    try:
        xlsx_path = tables_dir / f"{name}.xlsx"
        df.to_excel(xlsx_path, index=False, engine="openpyxl")
        result["xlsx"] = str(xlsx_path)
    except Exception as e:
        logger.warning(f"Failed to save XLSX {name}: {e}")

    return result


# =============================================================================
# Chart export helpers
# =============================================================================
def export_fig(fig, key: str, charts_dir: Path, title: str = None) -> dict:
    """Export figure to all formats."""
    charts_dir.mkdir(parents=True, exist_ok=True)
    prefix = charts_dir / key
    result = {}

    try:
        if title:
            fig.update_layout(title=dict(text=title, x=0.5, y=0.98, font=dict(size=18, color="#34495E")))
        fig.update_layout(width=CAROUSEL_W, height=CAROUSEL_H)
    except Exception:
        pass

    # JSON
    try:
        fig.write_json(str(prefix) + ".json")
        result["json"] = str(prefix) + ".json"
    except Exception as e:
        logger.warning(f"JSON export failed for {key}: {e}")

    # HTML
    try:
        fig.write_html(str(prefix) + ".html", include_plotlyjs="cdn", full_html=True)
        result["html"] = str(prefix) + ".html"
    except Exception as e:
        logger.warning(f"HTML export failed for {key}: {e}")

    # PNG
    try:
        fig.write_image(str(prefix) + ".png", format="png", width=CAROUSEL_W, height=CAROUSEL_H, scale=2)
        result["png"] = str(prefix) + ".png"
    except Exception as e:
        logger.warning(f"PNG export failed for {key}: {e}")

    # SVG
    try:
        fig.write_image(str(prefix) + ".svg", format="svg", width=CAROUSEL_W, height=CAROUSEL_H, scale=2)
        result["svg"] = str(prefix) + ".svg"
    except Exception as e:
        logger.warning(f"SVG export failed for {key}: {e}")

    return result


# =============================================================================
# Layout helpers
# =============================================================================
LAYOUT_BASE = dict(
    paper_bgcolor="#FFFFFF",
    plot_bgcolor="#FFFFFF",
    font=dict(family="Arial, Helvetica, sans-serif", size=12, color="#34495E"),
    margin=dict(l=90, r=70, t=90, b=90, pad=15),
    showlegend=True,
    legend=dict(font=dict(size=12, color="#34495E"), bgcolor="rgba(255,255,255,0.8)", bordercolor="#ECF0F1", borderwidth=1),
    xaxis=dict(showgrid=True, gridcolor="#ECF0F1", gridwidth=1, zeroline=False, showline=True, linewidth=1, linecolor="#BDC3C7", tickfont=dict(size=12)),
    yaxis=dict(showgrid=True, gridcolor="#ECF0F1", gridwidth=1, zeroline=False, showline=True, linewidth=1, linecolor="#BDC3C7", tickfont=dict(size=12), rangemode="tozero"),
)

BLUE_PALETTE = ["#2E86AB", "#17A2B8", "#5DADE2", "#76D7C4", "#48C9B0", "#3498DB", "#1ABC9C", "#2980B9", "#E67E22"]


def std_layout(title, xaxis_title=None, yaxis_title=None, barmode=None, log_x=False, log_y=False, yaxis2_title=None):
    """Get standard layout dict."""
    layout = dict(LAYOUT_BASE)
    layout["title"] = dict(text=title, font=dict(size=18, color="#34495E"), x=0.5, y=0.98, xanchor="center", yanchor="top")
    layout["xaxis"] = dict(LAYOUT_BASE["xaxis"], title=dict(text=xaxis_title or "", font=dict(size=14, color="#34495E")))
    layout["yaxis"] = dict(LAYOUT_BASE["yaxis"], title=dict(text=yaxis_title or "", font=dict(size=14, color="#34495E")))
    if barmode:
        layout["barmode"] = barmode
    if log_x:
        layout["xaxis"]["type"] = "log"
    if log_y:
        layout["yaxis"]["type"] = "log"
    if yaxis2_title:
        layout["yaxis2"] = dict(title=dict(text=yaxis2_title, font=dict(size=14, color="#34495E")), showgrid=False, overlaying="y", side="right")
    return layout


# =============================================================================
# Main entry point
# =============================================================================
def run_genome_analysis(job_id: str) -> None:
    """Run complete genome analysis pipeline."""
    from genome_analysis.task_manager import genome_task_manager
    from genome_analysis.file_discovery import genome_file_discovery
    from genome_analysis.carousel_service import generate_carousel_from_job

    start_time = time.time()
    genome_task_manager.update_job(job_id, "running", "Analysis started")

    try:
        dirs = ensure_dirs(job_id)
        file_scan = genome_file_discovery.scan(DATA_DIR)

        # Save file scan results
        with open(dirs["metadata"] / "files.json", "w", encoding="utf-8") as f:
            json.dump(file_scan, f, indent=2, ensure_ascii=False)

        results = {}
        all_charts = {}

        # ============ GENOME ANALYSIS ============
        if "genomic" in file_scan["files"]:
            genome_task_manager.update_job(job_id, "running", "Analyzing genome...")
            genome_path = Path(file_scan["files"]["genomic"]["path"])
            results["genome"] = analyze_genome(genome_path, dirs["tables"])
            charts = generate_genome_charts(genome_path, dirs["charts"])
            all_charts.update({c["key"]: c for c in charts})

        # ============ GFF ANALYSIS ============
        if "gff" in file_scan["files"]:
            genome_task_manager.update_job(job_id, "running", "Analyzing GFF...")
            gff_path = Path(file_scan["files"]["gff"]["path"])
            results["gff"] = analyze_gff(gff_path, dirs["tables"])
            charts = generate_gff_charts(gff_path, dirs["charts"])
            all_charts.update({c["key"]: c for c in charts})

        # ============ CDS ANALYSIS ============
        if "cds" in file_scan["files"]:
            genome_task_manager.update_job(job_id, "running", "Analyzing CDS...")
            cds_path = Path(file_scan["files"]["cds"]["path"])
            results["cds"] = analyze_cds(cds_path, dirs["tables"])
            charts = generate_cds_charts(cds_path, dirs["charts"])
            all_charts.update({c["key"]: c for c in charts})

        # ============ PROTEIN ANALYSIS ============
        if "protein" in file_scan["files"]:
            genome_task_manager.update_job(job_id, "running", "Analyzing proteins...")
            protein_path = Path(file_scan["files"]["protein"]["path"])
            results["protein"] = analyze_protein(protein_path, dirs["tables"])
            charts = generate_protein_charts(protein_path, dirs["charts"])
            all_charts.update({c["key"]: c for c in charts})

        # ============ RNA ANALYSIS ============
        if "rna" in file_scan["files"]:
            genome_task_manager.update_job(job_id, "running", "Analyzing RNA...")
            rna_path = Path(file_scan["files"]["rna"]["path"])
            results["rna"] = analyze_rna(rna_path, dirs["tables"])

        # ============ CONSISTENCY CHECK ============
        genome_task_manager.update_job(job_id, "running", "Running consistency checks...")
        results["consistency"] = run_consistency_check(file_scan)

        # Save analysis results
        with open(dirs["result"] / "analysis_results.json", "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, ensure_ascii=False)

        # Save chart manifest
        chart_manifest = {
            "job_id": job_id,
            "total_charts": len(all_charts),
            "charts": list(all_charts.values()),
        }
        with open(dirs["charts"] / "manifest.json", "w", encoding="utf-8") as f:
            json.dump(chart_manifest, f, indent=2, ensure_ascii=False)

        # ============ GENERATE CAROUSEL ============
        genome_task_manager.update_job(job_id, "running", "Generating carousel images...")
        carousel_result = generate_carousel_from_job(job_id, dirs["charts"])

        runtime = time.time() - start_time
        msg = f"Analysis completed in {runtime:.1f}s. Charts: {len(all_charts)}. Carousel: {carousel_result['featured_count']}/5"
        genome_task_manager.update_job(job_id, "success", msg)

    except Exception as e:
        logger.exception(f"Analysis failed for job {job_id}")
        genome_task_manager.update_job(job_id, "failed", error=str(e))
        raise


# =============================================================================
# Analysis modules
# =============================================================================
def analyze_genome(file_path: Path, tables_dir: Path) -> dict:
    """Analyze genome FASTA file."""
    sequences = []
    for header, seq in read_fasta(file_path):
        name = header.split()[0]
        sequences.append({"name": name, "length": len(seq), "gc_percent": gc_content(seq)})

    if not sequences:
        return {}

    sequences.sort(key=lambda x: x["length"], reverse=True)
    lengths = [s["length"] for s in sequences]

    # N50 calculation
    sorted_lengths = sorted(lengths, reverse=True)
    cumsum = 0
    n50, l50 = 0, 0
    target = sum(sorted_lengths) * 0.5
    for i, l in enumerate(sorted_lengths):
        cumsum += l
        if cumsum >= target and n50 == 0:
            n50, l50 = l, i + 1
            break

    # N percentage
    total_n = sum(seq.upper().count("N") + seq.upper().count("n") for _, seq in read_fasta(file_path))
    total_bp = sum(lengths)

    # Save table
    df = pd.DataFrame(sequences)
    save_table(df, "assembly_contig_stats", tables_dir)

    return {
        "sequence_count": len(sequences),
        "total_length": sum(lengths),
        "max_length": max(lengths),
        "min_length": min(lengths),
        "mean_length": sum(lengths) / len(lengths),
        "n50": n50,
        "l50": l50,
        "overall_gc": sum(s["gc_percent"] * s["length"] for s in sequences) / total_bp if total_bp > 0 else 0,
        "n_percent": (total_n / total_bp * 100) if total_bp > 0 else 0,
    }


def analyze_gff(file_path: Path, tables_dir: Path) -> dict:
    """Analyze GFF annotation file."""
    feature_counts = Counter()
    genes = {}
    transcripts = {}
    exons = []

    for record in read_gff(file_path):
        feature_counts[record["feature_type"]] += 1
        if record["feature_type"] == "gene":
            gid = record["attributes"].get("ID", record["attributes"].get("GeneID", "unknown"))
            genes[gid] = {
                "gene_id": gid,
                "seqid": record["seqid"],
                "start": record["start"],
                "end": record["end"],
                "length": record["end"] - record["start"] + 1,
                "strand": record["strand"],
                "biotype": record["attributes"].get("gene_biotype", "protein_coding"),
            }
        elif record["feature_type"] in ("mRNA", "transcript"):
            tid = record["attributes"].get("ID", "unknown")
            parent = record["attributes"].get("Parent", "")
            transcripts[tid] = {"transcript_id": tid, "gene_id": parent, "start": record["start"], "end": record["end"]}
        elif record["feature_type"] == "exon":
            parent = record["attributes"].get("Parent", "")
            exons.append({"transcript_id": parent, "start": record["start"], "end": record["end"], "length": record["end"] - record["start"] + 1})

    biotypes = Counter(g["biotype"] for g in genes.values())
    strands = Counter(g["strand"] for g in genes.values())
    genes_per_chr = Counter(g["seqid"] for g in genes.values())
    gene_lengths = [g["length"] for g in genes.values()]

    # Save tables
    if genes:
        save_table(pd.DataFrame(list(genes.values())), "gene_stats", tables_dir)
    if genes_per_chr:
        chr_df = pd.DataFrame([{"chromosome": k, "gene_count": v} for k, v in sorted(genes_per_chr.items())])
        save_table(chr_df, "gene_count_by_chromosome", tables_dir)

    return {
        "total_genes": len(genes),
        "total_transcripts": len(transcripts),
        "total_exons": len(exons),
        "feature_types": dict(feature_counts),
        "biotype_distribution": dict(biotypes.most_common(10)),
        "strand_ratio": {"+": strands.get("+", 0), "-": strands.get("-", 0)},
        "genes_per_chromosome": dict(sorted(genes_per_chr.items())),
        "gene_length_mean": sum(gene_lengths) / len(gene_lengths) if gene_lengths else 0,
        "gene_length_median": sorted(gene_lengths)[len(gene_lengths)//2] if gene_lengths else 0,
    }


def analyze_cds(file_path: Path, tables_dir: Path) -> dict:
    """Analyze CDS FASTA file."""
    cds_list = []
    all_codon_counts = Counter()
    gc1_vals, gc2_vals, gc3_vals = [], [], []
    start_codons = Counter()
    stop_codons = Counter()

    for header, seq in read_fasta(file_path):
        name = header.split()[0]
        seq = seq.upper().replace("U", "T")
        cds_list.append({"name": name, "length": len(seq), "gc_percent": gc_content(seq)})

        # GC123
        gc1, gc2, gc3 = 0, 0, 0
        count = 0
        codons = []
        for i in range(0, len(seq) - 2, 3):
            codon = seq[i:i+3]
            if len(codon) == 3:
                codons.append(codon)
                if codon[0] in "GC": gc1 += 1
                if codon[1] in "GC": gc2 += 1
                if codon[2] in "GC": gc3 += 1
                count += 1

        if count > 0:
            gc1_vals.append(gc1 / count * 100)
            gc2_vals.append(gc2 / count * 100)
            gc3_vals.append(gc3 / count * 100)

        all_codon_counts.update(codon_usage(seq))

        # Start/stop codons
        if codons:
            start_codons[codons[0]] += 1
            stop_codons[codons[-1]] += 1

    # Codon usage
    codon_df = pd.DataFrame([{"codon": c, "count": cnt} for c, cnt in sorted(all_codon_counts.items())])
    save_table(codon_df, "codon_usage", tables_dir)

    # RSCU
    rscu_values = rscu(dict(all_codon_counts))
    rscu_df = pd.DataFrame([{"codon": c, "rscu": round(v, 4)} for c, v in sorted(rscu_values.items())])
    save_table(rscu_df, "rscu", tables_dir)

    # CDS table
    if cds_list:
        save_table(pd.DataFrame(cds_list), "cds_stats", tables_dir)

    n = len(gc1_vals) if gc1_vals else 1
    return {
        "cds_count": len(cds_list),
        "gc1_mean": sum(gc1_vals) / n,
        "gc2_mean": sum(gc2_vals) / n,
        "gc3_mean": sum(gc3_vals) / n,
        "start_codons": dict(start_codons.most_common(6)),
        "stop_codons": dict(stop_codons.most_common(6)),
    }


def analyze_protein(file_path: Path, tables_dir: Path) -> dict:
    """Analyze protein FASTA file."""
    proteins = []
    aa_counts = Counter()

    for header, seq in read_fasta(file_path):
        name = header.split()[0]
        seq = seq.upper()
        proteins.append({"name": name, "length": len(seq)})
        aa_counts.update(seq)

    total_aa = sum(aa_counts.values())
    aa_freq = {aa: round(aa_counts.get(aa, 0) / total_aa * 100, 4) if total_aa > 0 else 0 for aa in "ACDEFGHIKLMNPQRSTVWY"}

    # Save tables
    aa_df = pd.DataFrame([
        {"amino_acid": aa, "count": aa_counts.get(aa, 0), "percent": aa_freq.get(aa, 0)}
        for aa in "ACDEFGHIKLMNPQRSTVWY"
    ])
    save_table(aa_df, "amino_acid_composition", tables_dir)

    if proteins:
        save_table(pd.DataFrame(proteins), "protein_stats", tables_dir)

    lengths = sorted([p["length"] for p in proteins])
    return {
        "protein_count": len(proteins),
        "mean_length": sum(lengths) / len(lengths) if lengths else 0,
        "median_length": lengths[len(lengths)//2] if lengths else 0,
        "min_length": min(lengths) if lengths else 0,
        "max_length": max(lengths) if lengths else 0,
    }


def analyze_rna(file_path: Path, tables_dir: Path) -> dict:
    """Analyze RNA FASTA file."""
    rnas = []
    for header, seq in read_fasta(file_path):
        name = header.split()[0]
        rnas.append({"name": name, "length": len(seq), "gc_percent": gc_content(seq)})

    if rnas:
        save_table(pd.DataFrame(rnas), "rna_stats", tables_dir)

    lengths = [r["length"] for r in rnas]
    return {
        "rna_count": len(rnas),
        "mean_length": sum(lengths) / len(lengths) if lengths else 0,
        "mean_gc_percent": sum(r["gc_percent"] for r in rnas) / len(rnas) if rnas else 0,
    }


def run_consistency_check(file_scan: dict) -> dict:
    """Run cross-file consistency checks."""
    files = file_scan.get("files", {})
    checks = []

    cds_ok = "cds" in files
    protein_ok = "protein" in files
    gff_ok = "gff" in files
    genomic_ok = "genomic" in files

    checks.append({"name": "All Required Files Present", "passed": all([genomic_ok, gff_ok, cds_ok, protein_ok]),
                   "details": {"genomic": genomic_ok, "gff": gff_ok, "cds": cds_ok, "protein": protein_ok}})

    if cds_ok and protein_ok:
        ratio = files["cds"]["size_bytes"] / files["protein"]["size_bytes"] if files["protein"]["size_bytes"] > 0 else 0
        checks.append({"name": "CDS/Protein Size Ratio", "passed": 0.5 < ratio < 5.0, "details": {"ratio": round(ratio, 2)}})

    return {"total_checks": len(checks), "passed": sum(1 for c in checks if c["passed"]),
            "failed": sum(1 for c in checks if not c["passed"]), "checks": checks}


# =============================================================================
# Chart generation modules
# =============================================================================
def generate_genome_charts(file_path: Path, charts_dir: Path) -> list:
    """Generate genome charts."""
    from plotly import graph_objects as go

    charts_dir.mkdir(parents=True, exist_ok=True)
    results = []

    # Load data
    sequences = []
    gc_windows = []
    for header, seq in read_fasta(file_path):
        name = header.split()[0]
        seq_upper = seq.upper()
        sequences.append({"name": name, "length": len(seq_upper), "gc": gc_content(seq)})

        # GC windows
        window = 100000
        for i in range(0, max(len(seq_upper) - window, 1), window):
            chunk = seq_upper[i:i+window]
            gc_windows.append({"position": i // window + 1, "gc": gc_content(chunk)})

    sequences.sort(key=lambda x: x["length"], reverse=True)
    lengths = [s["length"] for s in sequences]

    # 1. assembly_contig_length_bar (FEATURED)
    if sequences:
        fig = go.Figure(go.Bar(
            x=[s["name"][:25] for s in sequences[:20]],
            y=[s["length"] for s in sequences[:20]],
            marker_color=BLUE_PALETTE[0],
            text=[f"{s['length']:,}" for s in sequences[:20]],
            textposition="outside",
            textfont=dict(size=11),
        ))
        fig.update_layout(**std_layout("染色体/序列长度分布 (Top 20)", "序列", "长度 (bp)"))
        r = export_fig(fig, "assembly_contig_length_bar", charts_dir, "染色体/序列长度分布 (Top 20)")
        results.append({"key": "assembly_contig_length_bar", "title": "染色体/序列长度分布", "files": r})

    # 2. assembly_length_histogram
    if lengths:
        fig = go.Figure(go.Histogram(x=lengths, nbinsx=40, marker_color=BLUE_PALETTE[1], opacity=0.8))
        fig.update_layout(**std_layout("序列长度直方图", "长度 (bp)", "频数"), bargap=0.05)
        r = export_fig(fig, "assembly_length_histogram", charts_dir)
        results.append({"key": "assembly_length_histogram", "title": "序列长度直方图", "files": r})

    # 3. genome_gc_window_line
    if gc_windows:
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=[w["position"] for w in gc_windows],
            y=[w["gc"] for w in gc_windows],
            mode="lines",
            line=dict(color=BLUE_PALETTE[0], width=2),
            fill="tozeroy",
            fillcolor="rgba(46,134,171,0.15)",
        ))
        fig.update_layout(**std_layout("基因组 GC 含量窗口分析", "窗口编号 (100kb)", "GC含量 (%)"))
        r = export_fig(fig, "genome_gc_window_line", charts_dir)
        results.append({"key": "genome_gc_window_line", "title": "基因组 GC 含量窗口分析", "files": r})

    return results


def generate_gff_charts(file_path: Path, charts_dir: Path) -> list:
    """Generate GFF charts."""
    from plotly import graph_objects as go

    charts_dir.mkdir(parents=True, exist_ok=True)
    results = []

    feature_counts = Counter()
    biotype_counts = Counter()
    genes = {}

    for record in read_gff(file_path):
        feature_counts[record["feature_type"]] += 1
        if record["feature_type"] == "gene":
            gid = record["attributes"].get("ID", record["attributes"].get("GeneID", "unknown"))
            biotype = record["attributes"].get("gene_biotype", "protein_coding")
            biotype_counts[biotype] += 1
            genes[gid] = {"length": record["end"] - record["start"] + 1}

    # 4. gff_feature_type_bar (FEATURED)
    if feature_counts:
        top_feats = dict(feature_counts.most_common(15))
        fig = go.Figure(go.Bar(
            x=list(top_feats.keys()),
            y=list(top_feats.values()),
            marker_color=[BLUE_PALETTE[i % len(BLUE_PALETTE)] for i in range(len(top_feats))],
            text=list(top_feats.values()),
            textposition="outside",
            textfont=dict(size=11),
        ))
        fig.update_layout(**std_layout("GFF 特征类型统计", "特征类型", "数量"))
        r = export_fig(fig, "gff_feature_type_bar", charts_dir, "GFF 特征类型统计")
        results.append({"key": "gff_feature_type_bar", "title": "GFF 特征类型统计", "files": r})

    # 5. gff_biotype_bar
    if biotype_counts:
        top_biotypes = dict(biotype_counts.most_common(12))
        fig = go.Figure(go.Bar(
            x=list(top_biotypes.keys()),
            y=list(top_biotypes.values()),
            marker_color=BLUE_PALETTE[2],
            text=list(top_biotypes.values()),
            textposition="outside",
            textfont=dict(size=11),
        ))
        fig.update_layout(**std_layout("基因 biotype 分布", "Biotype", "基因数量"))
        r = export_fig(fig, "gff_biotype_bar", charts_dir)
        results.append({"key": "gff_biotype_bar", "title": "基因 biotype 分布", "files": r})

    # 6. gene_length_distribution (FEATURED)
    if genes:
        gene_lens = sorted([g["length"] for g in genes.values()])
        fig = go.Figure(go.Histogram(x=gene_lens, nbinsx=50, marker_color=BLUE_PALETTE[3], opacity=0.8))
        fig.update_layout(**std_layout("基因长度分布", "基因长度 (bp)", "频数"), bargap=0.05)
        r = export_fig(fig, "gene_length_distribution", charts_dir, "基因长度分布")
        results.append({"key": "gene_length_distribution", "title": "基因长度分布", "files": r})

    return results


def generate_cds_charts(file_path: Path, charts_dir: Path) -> list:
    """Generate CDS charts."""
    from plotly import graph_objects as go

    charts_dir.mkdir(parents=True, exist_ok=True)
    results = []

    gc1_vals, gc2_vals, gc3_vals = [], [], []
    start_codons = Counter()
    all_codon_counts = Counter()
    cds_lengths = []

    for header, seq in read_fasta(file_path):
        seq = seq.upper().replace("U", "T")
        cds_lengths.append(len(seq))

        codons = []
        gc1, gc2, gc3 = 0, 0, 0
        count = 0
        for i in range(0, len(seq) - 2, 3):
            codon = seq[i:i+3]
            if len(codon) == 3:
                codons.append(codon)
                if codon[0] in "GC": gc1 += 1
                if codon[1] in "GC": gc2 += 1
                if codon[2] in "GC": gc3 += 1
                count += 1

        if count > 0:
            gc1_vals.append(gc1 / count * 100)
            gc2_vals.append(gc2 / count * 100)
            gc3_vals.append(gc3 / count * 100)

        all_codon_counts.update(codon_usage(seq))
        if codons:
            start_codons[codons[0]] += 1

    # 7. cds_start_codon_bar (FEATURED)
    if start_codons:
        top_start = dict(start_codons.most_common(8))
        fig = go.Figure(go.Bar(
            x=list(top_start.keys()),
            y=list(top_start.values()),
            marker_color=[BLUE_PALETTE[i % len(BLUE_PALETTE)] for i in range(len(top_start))],
            text=list(top_start.values()),
            textposition="outside",
            textfont=dict(size=12),
        ))
        fig.update_layout(**std_layout("CDS 起始密码子使用频率", "起始密码子", "数量"))
        r = export_fig(fig, "cds_start_codon_bar", charts_dir, "CDS 起始密码子使用频率")
        results.append({"key": "cds_start_codon_bar", "title": "CDS 起始密码子使用频率", "files": r})

    # 8. cds_gc123_bar
    if gc1_vals:
        n = len(gc1_vals)
        fig = go.Figure([
            go.Bar(name="GC1", x=["GC1"], y=[sum(gc1_vals)/n], marker_color=BLUE_PALETTE[0]),
            go.Bar(name="GC2", x=["GC2"], y=[sum(gc2_vals)/n], marker_color=BLUE_PALETTE[1]),
            go.Bar(name="GC3", x=["GC3"], y=[sum(gc3_vals)/n], marker_color=BLUE_PALETTE[2]),
        ])
        fig.update_layout(**std_layout("CDS GC1/GC2/GC3 含量", "", "GC含量 (%)"), barmode="group")
        r = export_fig(fig, "cds_gc123_bar", charts_dir)
        results.append({"key": "cds_gc123_bar", "title": "CDS GC123 含量", "files": r})

    # 9. cds_length_distribution
    if cds_lengths:
        fig = go.Figure(go.Histogram(x=cds_lengths, nbinsx=40, marker_color=BLUE_PALETTE[4], opacity=0.8))
        fig.update_layout(**std_layout("CDS 长度分布", "CDS长度 (bp)", "频数"), bargap=0.05)
        r = export_fig(fig, "cds_length_distribution", charts_dir)
        results.append({"key": "cds_length_distribution", "title": "CDS 长度分布", "files": r})

    return results


def generate_protein_charts(file_path: Path, charts_dir: Path) -> list:
    """Generate protein charts."""
    from plotly import graph_objects as go

    charts_dir.mkdir(parents=True, exist_ok=True)
    results = []

    lengths = []
    aa_counts = Counter()
    for header, seq in read_fasta(file_path):
        lengths.append(len(seq.upper()))
        aa_counts.update(seq.upper())

    # 10. protein_length_distribution (FEATURED)
    if lengths:
        fig = go.Figure(go.Histogram(x=lengths, nbinsx=50, marker_color=BLUE_PALETTE[5], opacity=0.8))
        fig.update_layout(**std_layout("蛋白质长度分布", "氨基酸数量 (aa)", "频数"), bargap=0.05)
        r = export_fig(fig, "protein_length_distribution", charts_dir, "蛋白质长度分布")
        results.append({"key": "protein_length_distribution", "title": "蛋白质长度分布", "files": r})

    # 11. amino_acid_composition_bar
    if aa_counts:
        total = sum(aa_counts.values())
        aa_order = list("ACDEFGHIKLMNPQRSTVWY")
        aa_values = [round(aa_counts.get(aa, 0) / total * 100, 2) for aa in aa_order]
        fig = go.Figure(go.Bar(
            x=aa_order, y=aa_values,
            marker_color=[BLUE_PALETTE[i % len(BLUE_PALETTE)] for i in range(len(aa_order))],
            text=[f"{v:.1f}%" for v in aa_values],
            textposition="outside",
            textfont=dict(size=10),
        ))
        fig.update_layout(**std_layout("氨基酸组成成分", "氨基酸", "百分比 (%)"))
        r = export_fig(fig, "amino_acid_composition_bar", charts_dir)
        results.append({"key": "amino_acid_composition_bar", "title": "氨基酸组成成分", "files": r})

    return results
