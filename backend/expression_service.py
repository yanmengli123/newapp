"""
Expression Service — Star Schema Query Layer

Architecture:
  GET /genes/{id}/expression          → ExpressionService.load()     (single dataset)
  GET /genes/{id}/expression?expand=all → ExpressionService.load_all() (all datasets)
  GET /datasets                       → DatasetRegistry.list_datasets()

DatasetRegistry:
  - Validates (dataset, metric) against mv_dataset_metric
  - Returns available datasets + metrics (filters deprecated/empty)

ExpressionService:
  - load()        : single dataset + metric (default: day_deseq2_36/normcount)
  - load_all()     : ALL dataset × metric combos + cross-dataset comparison
  - _load_summary() : from gene_expression_summary (pre-computed)
  - _load_samples()  : from expression_fact + dataset_sample + stage_dim
  - Derived fields  : z_score, log2fc, fold_change (Python)
"""

import math
from typing import Any

import psycopg2.extras

DEFAULT_DATASET = "day_deseq2_36"
DEFAULT_METRIC  = "normcount"


# ─── DatasetRegistry ──────────────────────────────────────────────────────────

class DatasetRegistry:
    """
    Validates (dataset, metric) availability against mv_dataset_metric.

    Active datasets: raw_ballgown_36 (tpm/fpkm), day_deseq2_36 (normcount),
    day_featurecounts_36 (raw_count). esc_srr_23 is deprecated (no metrics).
    """

    def __init__(self, pg_conn):
        self._conn = pg_conn
        self._cache: dict[str, dict] = {}          # keyed by resolved dataset_code
        self._aliases: dict[str, str] = {}          # alias → canonical
        self._loaded = False

    # ── Internal ────────────────────────────────────────────────────────────────

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Load aliases (include deprecated — they still resolve)
        cur.execute("""
            SELECT alias_code, dataset_code AS canonical_code
            FROM dataset_alias
        """)
        for row in cur.fetchall():
            self._aliases[row["alias_code"]] = row["canonical_code"]

        # Load capability registry
        cur.execute("""
            SELECT dataset_code, metric_code, metric_name, unit_desc,
                   gene_count, sample_count, fact_row_count,
                   last_updated, is_enabled
            FROM mv_dataset_metric
            WHERE is_enabled = TRUE
            ORDER BY dataset_code, metric_code
        """)
        for row in cur.fetchall():
            ds = row["dataset_code"]
            if ds not in self._cache:
                self._cache[ds] = {"metrics": {}}
            self._cache[ds]["metrics"][row["metric_code"]] = dict(row)

        cur.close()
        self._loaded = True

    # ── Public API ─────────────────────────────────────────────────────────────

    def resolve(self, dataset: str | None) -> str:
        """
        Resolve a dataset code to its canonical form via dataset_alias.
        Returns DEFAULT_DATASET if dataset is None.
        """
        if dataset is None:
            return DEFAULT_DATASET
        self._ensure_loaded()
        # Follow alias chain
        resolved = self._aliases.get(dataset, dataset)
        if resolved not in self._cache and dataset in self._cache:
            resolved = dataset  # treat as-is if no alias entry
        return resolved

    def is_available(self, dataset: str, metric: str) -> bool:
        """True if (dataset, metric) is a registered + enabled combination."""
        self._ensure_loaded()
        ds = self.resolve(dataset)
        return (
            ds in self._cache
            and metric in self._cache[ds]["metrics"]
        )

    def validate(self, dataset: str | None, metric: str | None) -> tuple[str, str]:
        """
        Resolve + validate.  Returns (resolved_dataset, metric).

        Raises ValueError with user-friendly message if unavailable.
        """
        ds = self.resolve(dataset)
        met = metric or DEFAULT_METRIC
        if not self.is_available(ds, met):
            available = list(self._cache.get(ds, {}).get("metrics", {}).keys())
            raise ValueError(
                f"metric '{met}' not available for dataset '{ds}'. "
                f"Available: {available}"
            )
        return ds, met

    def list_datasets(self) -> list[dict[str, Any]]:
        """
        Return all registered datasets with their metrics inline.
        Includes data lineage info from the latest import batch.
        Used by GET /datasets.
        """
        self._ensure_loaded()
        result = []
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Get latest import batch info
        cur.execute("""
            SELECT batch_id, data_dir, file_hashes, source_gene_count,
                   mapped_gene_count, unmapped_gene_count, ambiguous_gene_count,
                   total_staging_rows, total_fact_rows, started_at, completed_at
            FROM import_batch
            WHERE status = 'completed'
            ORDER BY batch_id DESC
            LIMIT 1
        """)
        latest_batch = cur.fetchone()

        # Get per-file QC summary from latest batch
        qc_summary = {}
        if latest_batch:
            cur.execute("""
                SELECT file_name,
                       COUNT(*) as total_checks,
                       SUM(CASE WHEN passed THEN 1 ELSE 0 END) as passed_checks,
                       BOOL_AND(passed) as all_passed
                FROM import_qc_result
                WHERE batch_id = %s
                GROUP BY file_name
            """, (latest_batch["batch_id"],))
            for row in cur.fetchall():
                qc_summary[row["file_name"]] = dict(row)

        # Get per-metric mapping stats from gene_source_mapping
        # metric_code is comma-separated (e.g., "tpm,fpkm"), need to unnest
        metric_mapping_stats = {}
        if latest_batch:
            cur.execute("""
                SELECT m.metric, gsm.mapping_status, COUNT(*) as cnt
                FROM gene_source_mapping gsm,
                     unnest(string_to_array(gsm.metric_code, ',')) AS m(metric)
                WHERE gsm.batch_id = %s
                  AND gsm.metric_code IS NOT NULL
                GROUP BY m.metric, gsm.mapping_status
            """, (latest_batch["batch_id"],))
            for row in cur.fetchall():
                mc = row["metric"]
                if mc not in metric_mapping_stats:
                    metric_mapping_stats[mc] = {"mapped": 0, "unmapped": 0, "ambiguous": 0}
                status = row["mapping_status"]
                cnt = row["cnt"]
                if status.startswith("mapped"):
                    metric_mapping_stats[mc]["mapped"] += cnt
                elif status == "unmapped":
                    metric_mapping_stats[mc]["unmapped"] += cnt
                elif status == "ambiguous_symbol":
                    metric_mapping_stats[mc]["ambiguous"] += cnt

        # Get per-dataset gene counts from gene_expression_summary
        cur.execute("""
            SELECT dataset_code, metric_code,
                   COUNT(DISTINCT gene_id) as curated_genes
            FROM gene_expression_summary
            GROUP BY dataset_code, metric_code
        """)
        metric_genes = {}
        for row in cur.fetchall():
            key = (row["dataset_code"], row["metric_code"])
            metric_genes[key] = row["curated_genes"]

        cur.execute("""
            SELECT dataset_id, dataset_code, dataset_name,
                   sample_scope, normalization_family,
                   description, source_file,
                   source_gene_count, curated_gene_count
            FROM dataset
            ORDER BY dataset_id
        """)
        for ds_row in cur.fetchall():
            ds_code = ds_row["dataset_code"]
            metrics = [
                dict(m)
                for m in self._cache.get(ds_code, {}).get("metrics", {}).values()
            ]
            # Skip datasets with no available metrics (deprecated/empty)
            if not metrics:
                continue

            # Enrich metrics with per-metric curated gene counts and mapping stats
            for m in metrics:
                key = (ds_code, m["metric_code"])
                m["curated_gene_count"] = metric_genes.get(key)
                # Add per-metric mapping stats
                mc = m["metric_code"]
                stats = metric_mapping_stats.get(mc)
                if stats:
                    m["mapping_stats"] = stats

            # Build lineage info
            lineage = None
            if latest_batch:
                file_hashes = latest_batch.get("file_hashes", {})
                source_files = (ds_row.get("source_file") or "").split(";")
                file_lineage = []
                for sf in source_files:
                    sf = sf.strip()
                    if not sf:
                        continue
                    entry = {
                        "file_name": sf,
                        "file_hash": file_hashes.get(sf),
                    }
                    qc = qc_summary.get(sf)
                    if qc:
                        entry["qc"] = qc
                    file_lineage.append(entry)

                # Get per-metric stats for this dataset's primary metric
                primary_metric = metrics[0]["metric_code"] if metrics else None
                primary_stats = metric_mapping_stats.get(primary_metric, {}) if primary_metric else {}

                lineage = {
                    "batch_id": latest_batch["batch_id"],
                    "import_time": latest_batch["completed_at"].isoformat() if latest_batch["completed_at"] else None,
                    "source_gene_count": ds_row.get("source_gene_count"),
                    "curated_gene_count": ds_row.get("curated_gene_count"),
                    "unmapped_gene_count": primary_stats.get("unmapped", 0),
                    "ambiguous_gene_count": primary_stats.get("ambiguous", 0),
                    "files": file_lineage,
                }

            result.append({
                **{k: v for k, v in dict(ds_row).items() if k not in ("source_gene_count", "curated_gene_count")},
                "metrics": sorted(metrics, key=lambda m: m["metric_code"]),
                "lineage": lineage,
            })
        cur.close()
        return result


# ─── ExpressionService ─────────────────────────────────────────────────────────

class ExpressionService:
    """
    Loads expression data for a single gene from the star schema.

    Summary fields come from gene_expression_summary (pre-computed in ETL).
    Per-sample fields are fetched from expression_fact + dataset_sample.
    Derived fields (z_score, log2fc, fold_change) are computed in Python.
    """

    def __init__(self, pg_conn):
        self._conn = pg_conn
        self._registry = DatasetRegistry(pg_conn)

    # ── Public ─────────────────────────────────────────────────────────────────

    def load(self, gene_id: str, dataset: str | None = None,
             metric: str | None = None) -> dict[str, Any]:
        """
        Load expression data for one gene.

        Parameters
        ----------
        gene_id  : canonical gene ID, e.g. 'gene-A4GALT'
        dataset  : dataset code (e.g. 'day_deseq2_36', 'raw_ballgown_36');
                   None defaults to 'day_deseq2_36'
        metric   : metric code (e.g. 'normcount', 'tpm', 'fpkm');
                   None defaults to 'normcount'

        Returns
        -------
        dict with keys: status, dataset, metric, samples, summary

        Raises
        ------
        ValueError : if (dataset, metric) is not available for this gene
        """
        resolved_ds, resolved_metric = self._registry.validate(dataset, metric)

        # Fetch summary from pre-computed table
        summary = self._load_summary(gene_id, resolved_ds, resolved_metric)
        if summary is None:
            return {"status": "no_data", "gene_id": gene_id,
                    "dataset": resolved_ds, "metric": resolved_metric,
                    "samples": [], "summary": None}

        # Fetch per-sample rows
        samples = self._load_samples(gene_id, resolved_ds, resolved_metric)

        # Enrich with derived fields
        self._enrich_samples(samples, summary)

        return {
            "status": "available",
            "dataset": resolved_ds,
            "metric": resolved_metric,
            "samples": samples,
            "summary": self._build_summary_response(summary),
        }

    # ── load_all: ALL datasets × metrics + cross-comparison ──────────────────

    def load_all(self, gene_id: str) -> dict[str, Any]:
        """
        Load expression data across ALL available dataset × metric combinations.

        Response structure:
        {
          "gene_id": "gene-A4GALT",
          "cross_comparison": {
            "dataset_count": 2,
            "available_datasets": ["day_deseq2_36", "raw_ballgown_36"],
            "trend_note": "...",
            "opposite_trends": True/False
          },
          "datasets": [
            {
              "dataset_code": "day_deseq2_36",
              "dataset_name": "DESeq2 NC — 36 发育阶段样本",
              "normalization_family": "deseq2",
              "sample_count": 36,
              "metrics": [
                {
                  "metric_code": "normcount",
                  "metric_name": "DESeq2 Normalized Count",
                  "unit_desc": "count",
                  "is_comparable": False,
                  "summary": {...},
                  "samples": [...]
                }
              ]
            },
            {
              "dataset_code": "esc_srr_23",
              ...,
              "metrics": [
                {"metric_code": "tpm",    ...},
                {"metric_code": "fpkm",   ...},
                {"metric_code": "normcount", ...}
              ]
            }
          ]
        }
        """
        self._registry._ensure_loaded()

        # Build per-dataset summary lookup
        all_summaries = self._load_all_summaries(gene_id)

        # Build per-dataset/metric samples lookup
        all_samples = self._load_all_samples(gene_id)

        # Build dataset registry info
        available = []
        dataset_blocks = []

        for ds_code, ds_info in self._registry._cache.items():
            metrics = ds_info.get("metrics", {})
            if not metrics:
                continue

            # Fetch dataset name from DB
            cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(
                "SELECT dataset_name, normalization_family FROM dataset WHERE dataset_code = %s",
                (ds_code,))
            ds_row = cur.fetchone()
            cur.close()

            metric_blocks = []
            has_data = False
            for mc, m_info in sorted(metrics.items()):
                key = (ds_code, mc)
                summary = all_summaries.get(key)
                samples = all_samples.get(key, [])

                if summary is not None:
                    self._enrich_samples(samples, summary)
                    has_data = True

                metric_blocks.append({
                    "metric_code":     mc,
                    "metric_name":     m_info.get("metric_name", mc),
                    "unit_desc":        m_info.get("unit_desc", ""),
                    "is_comparable":    m_info.get("is_comparable", False),
                    "gene_count":       m_info.get("gene_count"),
                    "summary":          self._build_summary_response(summary) if summary else None,
                    "samples":          samples,
                })

            if has_data or metric_blocks:
                available.append(ds_code)
                dataset_blocks.append({
                    "dataset_code":          ds_code,
                    "dataset_name":          ds_row["dataset_name"] if ds_row else ds_code,
                    "normalization_family":   ds_row["normalization_family"] if ds_row else "",
                    # Metrics of a dataset normalize the same samples, so use the
                    # max metric sample_count rather than averaging across metrics
                    "sample_count":          max((m.get("summary", {}).get("sample_count") or 0
                                               for m in metric_blocks), default=0),
                    "metrics":               metric_blocks,
                })

        # Cross-dataset comparison note
        cross_note = self._build_cross_note(all_summaries, available)

        return {
            "gene_id": gene_id,
            "cross_comparison": {
                "dataset_count":      len(available),
                "available_datasets": available,
                "trend_note":          cross_note,
                "opposite_trends":     self._detect_opposite_trends(all_summaries),
            },
            "datasets": dataset_blocks,
        }

    # ── Private helpers for load_all ─────────────────────────────────────────

    def _load_all_summaries(self, gene_id: str) -> dict[tuple[str, str], dict]:
        """Load all summary rows for a gene across all datasets/metrics."""
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT dataset_code, metric_code,
                   sample_count,
                   mean_value, max_value, min_value, std_value, cv,
                   expressed_samples, zero_samples,
                   top_sample, top_stage,
                   sex_bias_label, sex_bias_ratio,
                   fold_change_top, fold_change_bottom,
                   stage_means, stage_sample_count
            FROM gene_expression_summary
            WHERE gene_id = %s
        """, (gene_id,))
        rows = cur.fetchall()
        cur.close()
        return {(r["dataset_code"], r["metric_code"]): dict(r) for r in rows}

    def _load_all_samples(self, gene_id: str) -> dict[tuple[str, str], list[dict]]:
        """
        Load ALL sample rows for a gene across ALL dataset/metric combinations.
        Uses a single SQL query for efficiency.
        Returns dict keyed by (dataset_code, metric_code).
        """
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT
                d.dataset_code,
                f.metric_code,
                ds.dataset_sample_id,
                ds.sample_name,
                ds.srr_run_id,
                ds.stage,
                sd.stage_label,
                COALESCE(ds.stage_order, sd.stage_order) AS stage_order,
                ds.sex,
                SUBSTR(ds.sex, 1, 1)        AS sex_code,
                ds.replicate,
                ds.batch,
                ds.tissue,
                f.value
            FROM expression_fact f
            JOIN dataset_sample ds ON ds.dataset_sample_id = f.dataset_sample_id
            JOIN dataset d ON d.dataset_id = ds.dataset_id
            LEFT JOIN stage_dim sd ON sd.stage_code = ds.stage
            WHERE f.gene_id = %s
              AND d.dataset_code IN (
                  SELECT DISTINCT dataset_code FROM mv_dataset_metric WHERE is_enabled = TRUE
              )
            ORDER BY d.dataset_code, f.metric_code,
                     COALESCE(ds.stage_order, sd.stage_order, 999),
                     ds.sex NULLS LAST,
                     ds.replicate NULLS LAST,
                     ds.sample_name
        """, (gene_id,))
        rows = cur.fetchall()
        cur.close()

        # Group by (dataset_code, metric_code)
        grouped: dict[tuple[str, str], list[dict]] = {}
        for r in rows:
            key = (r["dataset_code"], r["metric_code"])
            if key not in grouped:
                grouped[key] = []
            grouped[key].append({
                "dataset_sample_id": r["dataset_sample_id"],
                "sample_name":       r["sample_name"],
                "srr_run_id":        r["srr_run_id"],
                "stage":             r["stage"],
                "stage_label":       r["stage_label"],
                "stage_order":       r["stage_order"],
                "sex":               r["sex"],
                "sex_code":          r["sex_code"],
                "replicate":         r["replicate"],
                "batch":             r["batch"],
                "tissue":            r["tissue"],
                "value":             r["value"],
            })
        return grouped

    # ── Cross-dataset analysis ─────────────────────────────────────────────────

    @staticmethod
    def _detect_opposite_trends(summaries: dict[tuple[str, str], dict]) -> bool | None:
        """
        Detect if top_stage differs across datasets.
        Returns True if opposing trends detected, None if only one dataset has data.
        """
        top_stages = {}
        for (ds, mc), row in summaries.items():
            if row.get("top_stage") and mc in ("tpm", "normcount", "fpkm"):
                if ds not in top_stages:
                    top_stages[ds] = row["top_stage"]
        unique_stages = set(top_stages.values())
        if len(unique_stages) <= 1:
            return None
        return len(unique_stages) > 1

    @staticmethod
    def _build_cross_note(summaries: dict[tuple[str, str], dict],
                           available: list[str]) -> str:
        """Generate a human-readable cross-dataset comparison note."""
        if not available:
            return "No expression data available."

        notes = []
        for ds in available:
            # Pick the primary metric for this dataset
            mc = "normcount" if ds == "day_deseq2_36" else "tpm"
            key = (ds, mc)
            row = summaries.get(key)
            if row and row.get("top_stage"):
                note_map = {
                    "E0":    f"{ds}: highest at E0 (Day 0 fertilized egg)",
                    "E3.5": f"{ds}: highest at E3.5 (Day 3.5)",
                    "E4.5": f"{ds}: highest at E4.5 (Day 4.5)",
                    "E5.5": f"{ds}: highest at E5.5 (Day 5.5)",
                    "E6.5": f"{ds}: highest at E6.5 (Day 6.5)",
                    "E18.5": f"{ds}: highest at E18.5 (Day 18.5, pre-hatch)",
                }
                notes.append(note_map.get(row["top_stage"],
                                          f"{ds}: top_stage={row['top_stage']}"))

        if not notes:
            return ""
        return " | ".join(notes)

    # ── Existing private methods (unchanged) ───────────────────────────────────

    def _load_summary(self, gene_id: str, dataset: str, metric: str
                      ) -> dict[str, Any] | None:
        """Fetch one row from gene_expression_summary."""
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT sample_count,
                   mean_value, max_value, min_value, std_value,
                   cv,
                   expressed_samples, zero_samples,
                   top_sample, top_stage,
                   sex_bias_label, sex_bias_ratio,
                   fold_change_top, fold_change_bottom,
                   stage_means, stage_sample_count
            FROM gene_expression_summary
            WHERE gene_id = %s AND dataset_code = %s AND metric_code = %s
        """, (gene_id, dataset, metric))
        row = cur.fetchone()
        cur.close()
        return dict(row) if row else None

    def _load_samples(self, gene_id: str, dataset: str, metric: str
                      ) -> list[dict[str, Any]]:
        """
        Fetch per-sample fact rows with full metadata from dataset_sample.

        stage_label comes from expression_sample (canonical stage dimension table),
        so it is available for ALL datasets.

        ORDER BY uses COALESCE(ds.stage_order, sd.stage_order, 999) to handle
        datasets where stage_order might not be pre-filled in dataset_sample.
        """
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT
                ds.dataset_sample_id,
                ds.sample_name,
                ds.srr_run_id,
                ds.stage,
                sd.stage_label,
                COALESCE(ds.stage_order, sd.stage_order) AS stage_order,
                ds.sex,
                ds.replicate,
                ds.batch,
                ds.tissue,
                f.value
            FROM expression_fact f
            JOIN dataset_sample ds ON ds.dataset_sample_id = f.dataset_sample_id
            LEFT JOIN stage_dim sd ON sd.stage_code = ds.stage
            WHERE f.gene_id = %s
              AND ds.dataset_id = (
                  SELECT dataset_id FROM dataset WHERE dataset_code = %s
              )
              AND f.metric_code = %s
            ORDER BY COALESCE(ds.stage_order, sd.stage_order, 999),
                     ds.sex NULLS LAST,
                     ds.replicate NULLS LAST,
                     ds.sample_name
        """, (gene_id, dataset, metric))
        rows = cur.fetchall()
        cur.close()
        return [dict(r) for r in rows]

    def _enrich_samples(self, samples: list[dict[str, Any]],
                        summary: dict[str, Any]) -> None:
        """
        Add z_score, log2fc, fold_change to each sample dict in-place.
        Uses baseline_mean from summary (Python-side computation).
        """
        if not samples:
            return

        mean_val = summary.get("mean_value") or 0
        std_val  = summary.get("std_value")  or 0
        baseline = self._baseline_mean(summary)

        for s in samples:
            v = s["value"] or 0
            # z_score: (sample - mean) / std
            if std_val > 0:
                s["z_score"] = round((v - mean_val) / std_val, 4)
            else:
                s["z_score"] = 0.0

            # fold_change: sample vs baseline (log2fc)
            s["fold_change"] = self._log2fc(v, baseline)

            # log2fc: sample vs baseline (alias for fold_change)
            s["log2fc"] = s["fold_change"]

    def _baseline_mean(self, summary: dict[str, Any]) -> float:
        """
        Derive baseline mean from stage_means JSONB.
        Baseline = mean value of the earliest stage (by stage name sort).
        """
        stage_means = summary.get("stage_means")
        if not stage_means:
            return summary.get("mean_value") or 0

        # Sort stages alphanumerically; the first is the earliest developmental stage
        sorted_stages = sorted(stage_means.keys())
        if not sorted_stages:
            return summary.get("mean_value") or 0

        earliest = sorted_stages[0]
        vals = stage_means[earliest]
        if isinstance(vals, dict):
            return float(vals.get("mean", 0) or 0)
        return float(vals or 0)

    @staticmethod
    def _log2fc(a: float, b: float) -> float | None:
        """log2(a / b), None if a <= 0 or b <= 0."""
        if a <= 0 or b <= 0:
            return None
        return round(math.log(a / b, 2), 4)

    def _build_summary_response(self, summary: dict[str, Any]) -> dict[str, Any]:
        """Shape the summary block for the API response."""
        return {
            # Basic stats
            "sample_count":    summary.get("sample_count"),
            "mean_value":      round(float(summary["mean_value"]), 4) if summary.get("mean_value") else None,
            "max_value":       round(float(summary["max_value"]), 4)  if summary.get("max_value")  else None,
            "min_value":       round(float(summary["min_value"]), 4)  if summary.get("min_value")  else None,
            "std_value":       round(float(summary["std_value"]), 4)  if summary.get("std_value")  else None,
            "cv":              round(float(summary["cv"]), 4)          if summary.get("cv")          else None,
            # Expressed / zero
            "expressed_samples": summary.get("expressed_samples"),
            "zero_samples":      summary.get("zero_samples"),
            # Top
            "top_sample":      summary.get("top_sample"),
            "top_stage":       summary.get("top_stage"),
            # Sex bias
            "sex_bias_label":  summary.get("sex_bias_label"),
            "sex_bias_ratio":  round(float(summary["sex_bias_ratio"]), 4) if summary.get("sex_bias_ratio") else None,
            # Fold change
            "fold_change_top":    summary.get("fold_change_top"),
            "fold_change_bottom": summary.get("fold_change_bottom"),
            # Stage breakdown (enriched JSONB)
            "stage_means":          self._format_stage_means(summary.get("stage_means")),
            "stage_sample_count":   self._format_stage_count(summary.get("stage_sample_count")),
        }

    def _format_stage_means(self, raw) -> dict[str, Any] | None:
        """Normalize stage_means JSONB for API response."""
        if not raw:
            return None
        result = {}
        for stage, vals in raw.items():
            if isinstance(vals, dict):
                result[stage] = {
                    k: round(float(v), 4) if v is not None else None
                    for k, v in vals.items()
                }
            else:
                result[stage] = round(float(vals), 4) if vals else None
        return result

    def _format_stage_count(self, raw) -> dict[str, int] | None:
        """Normalize stage_sample_count JSONB for API response."""
        if not raw:
            return None
        if hasattr(raw, "keys"):
            return {k: int(v) for k, v in raw.items()}
        return None
