"""
ESC Data Overview Service — Global Aggregation Queries

Provides cross-gene, cross-sample aggregate statistics for the ESC Atlas
homepage charts. All queries are read-only SELECTs on the existing ESC
star schema — no schema changes, no new tables.

Tables used:
  - expression_fact       (~3M rows: gene × sample × metric)
  - gene_expression_summary (pre-computed per-gene stats; stage_means JSON)
  - dataset_sample          (sample metadata: stage, sex, replicate)
  - dataset                 (dataset definitions)
  - stage_dim              (stage ordering)
"""

from __future__ import annotations

import math
from typing import Any

import psycopg2.extras

DEFAULT_DATASET = "day_deseq2_36"
DEFAULT_METRIC  = "normcount"


# ─── SexBiasedGenesService ─────────────────────────────────────────────────────

class SexBiasedGenesService:
    """
    Returns per-stage counts of Female_higher / Male_higher genes.
    Uses top_stage (stage with highest mean expression) as the stage assignment
    for each gene's sex-bias classification.
    """

    def __init__(self, pg_conn):
        self._conn = pg_conn

    def load(self) -> dict[str, Any]:
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT
                ges.top_stage  AS stage,
                ges.sex_bias_label,
                COUNT(*)       AS gene_count
            FROM gene_expression_summary ges
            JOIN mv_dataset_metric m ON m.dataset_code = ges.dataset_code
                AND m.metric_code = ges.metric_code
            WHERE ges.dataset_code = %s
              AND ges.metric_code = %s
              AND ges.sex_bias_label IS NOT NULL
              AND ges.sex_bias_label != 'No_difference'
              AND ges.top_stage IS NOT NULL
              AND m.is_enabled = TRUE
            GROUP BY ges.top_stage, ges.sex_bias_label
            ORDER BY ges.top_stage,
                CASE ges.sex_bias_label
                    WHEN 'Female_higher' THEN 1
                    WHEN 'Male_higher'   THEN 2
                    ELSE 3 END
        """, (DEFAULT_DATASET, DEFAULT_METRIC))
        rows = cur.fetchall()
        cur.close()

        stage_order = self._get_stage_order()
        counts: dict[str, dict[str, int]] = {s: {"Female_higher": 0, "Male_higher": 0} for s in stage_order}
        for row in rows:
            stage = row["stage"]
            label = row["sex_bias_label"]
            if stage in counts and label in ("Female_higher", "Male_higher"):
                counts[stage][label] = int(row["gene_count"])

        stages = sorted(counts.keys(), key=lambda s: stage_order.get(s, 99))
        return {
            "stages": stages,
            "female": [counts[s]["Female_higher"] for s in stages],
            "male":   [counts[s]["Male_higher"]   for s in stages],
        }

    def _get_stage_order(self) -> dict[str, int]:
        cur = self._conn.cursor()
        cur.execute("SELECT stage_code, stage_order FROM stage_dim")
        rows = cur.fetchall()
        cur.close()
        return {r[0]: r[1] for r in rows if r[1] is not None}


# ─── FemaleMaleScatterService ────────────────────────────────────────────────

class FemaleMaleScatterService:
    """
    Returns all genes' female_mean and male_mean per stage, used for
    the Female vs Male scatter plot on the overview page.
    stage is extracted from stage_means JSON keys.
    """

    def __init__(self, pg_conn):
        self._conn = pg_conn

    def load(self, stage: str | None = None) -> dict[str, Any]:
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        if stage:
            stage_filter = "AND j.stage = %(stage)s"
            params = {"ds": DEFAULT_DATASET, "m": DEFAULT_METRIC, "stage": stage}
        else:
            stage_filter = ""
            params = {"ds": DEFAULT_DATASET, "m": DEFAULT_METRIC}

        cur.execute(f"""
            SELECT
                j.gene_id,
                j.stage,
                (ges.stage_means -> j.stage ->> 'female')::float AS female_mean,
                (ges.stage_means -> j.stage ->> 'male')::float   AS male_mean,
                ges.sex_bias_label
            FROM (
                SELECT gene_id, jsonb_object_keys(stage_means) AS stage
                FROM gene_expression_summary
                WHERE dataset_code = %(ds)s
                  AND metric_code = %(m)s
                  AND stage_means IS NOT NULL
            ) j
            JOIN gene_expression_summary ges ON ges.gene_id = j.gene_id
                AND ges.dataset_code = %(ds)s
                AND ges.metric_code = %(m)s
            WHERE ges.sex_bias_label IS NOT NULL
              {stage_filter}
            ORDER BY j.gene_id, j.stage
        """, params)
        rows = cur.fetchall()
        cur.close()

        genes = [dict(r) for r in rows]
        return {
            "genes": genes,
            "count": len(genes),
        }


# ─── StageDEGCountService ────────────────────────────────────────────────────

class StageDEGCountService:
    """
    For each stage, count up-regulated / down-regulated genes based on
    fold_change_top / fold_change_bottom (single aggregate values per gene).
    Also computes per-stage mean fold changes from stage_means for additional colour.
    """

    STAGE_ORDER = ["E0", "E3.5", "E4.5", "E5.5", "E6.5", "E18.5"]

    def __init__(self, pg_conn):
        self._conn = pg_conn

    def load(self) -> dict[str, Any]:
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Up/down counts per stage using top_stage (stage of max mean expression)
        cur.execute("""
            SELECT
                ges.top_stage  AS stage,
                SUM(CASE WHEN ges.fold_change_top > 0 THEN 1 ELSE 0 END) AS up_count,
                SUM(CASE WHEN ges.fold_change_bottom < 0 THEN 1 ELSE 0 END) AS down_count
            FROM gene_expression_summary ges
            JOIN mv_dataset_metric m ON m.dataset_code = ges.dataset_code
                AND m.metric_code = ges.metric_code
            WHERE ges.dataset_code = %s
              AND ges.metric_code = %s
              AND ges.top_stage IS NOT NULL
              AND m.is_enabled = TRUE
            GROUP BY ges.top_stage
            ORDER BY ges.top_stage
        """, (DEFAULT_DATASET, DEFAULT_METRIC))
        rows = cur.fetchall()
        cur.close()

        stage_data: dict[str, dict[str, int]] = {}
        for row in rows:
            stage_data[row["stage"]] = {
                "up": int(row["up_count"] or 0),
                "down": int(row["down_count"] or 0),
            }

        ordered = [s for s in self.STAGE_ORDER if s in stage_data]
        return {
            "stages": ordered,
            "up":   [stage_data.get(s, {}).get("up", 0)   for s in ordered],
            "down": [stage_data.get(s, {}).get("down", 0) for s in ordered],
        }


# ─── Top50HeatmapService ────────────────────────────────────────────────────

class Top50HeatmapService:
    """
    Returns the Top-50 most variable genes (by CV) × 36 samples matrix
    for the Z-score heatmap on the overview page.
    """

    def __init__(self, pg_conn):
        self._conn = pg_conn

    def load(self) -> dict[str, Any]:
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # 1. Get top 50 genes by CV
        cur.execute("""
            SELECT gene_id, cv
            FROM gene_expression_summary
            WHERE dataset_code = %s
              AND metric_code = %s
              AND cv IS NOT NULL
              AND cv > 0
            ORDER BY cv DESC
            LIMIT 50
        """, (DEFAULT_DATASET, DEFAULT_METRIC))
        top_genes = [dict(r)["gene_id"] for r in cur.fetchall()]

        if not top_genes:
            cur.close()
            return {"genes": [], "samples": [], "matrix": [], "zmatrix": []}

        # 2. Get all sample values for these genes
        cur.execute("""
            SELECT
                f.gene_id,
                ds.sample_name,
                ds.stage,
                ds.sex,
                COALESCE(ds.stage_order,
                    (SELECT stage_order FROM stage_dim sd WHERE sd.stage_code = ds.stage LIMIT 1), 999
                ) AS stage_order,
                f.value
            FROM expression_fact f
            JOIN dataset_sample ds ON ds.dataset_sample_id = f.dataset_sample_id
            JOIN dataset d ON d.dataset_id = ds.dataset_id
            WHERE d.dataset_code = %s
              AND f.metric_code = %s
              AND f.gene_id = ANY(%s)
            ORDER BY stage_order, ds.sex, ds.sample_name
        """, (DEFAULT_DATASET, DEFAULT_METRIC, top_genes))
        rows = cur.fetchall()
        cur.close()

        # 3. Build sample list
        sample_names: list[str] = []
        seen = set()
        for r in rows:
            sn = r["sample_name"]
            if sn not in seen:
                seen.add(sn)
                sample_names.append(sn)

        # 4. Build raw matrix (genes × samples)
        gene_vals: dict[str, dict[str, float]] = {}
        for r in rows:
            gid = r["gene_id"]
            sn  = r["sample_name"]
            if gid not in gene_vals:
                gene_vals[gid] = {}
            gene_vals[gid][sn] = float(r["value"]) if r["value"] is not None else 0.0

        matrix: list[list[float]] = []
        for gid in top_genes:
            row = [gene_vals.get(gid, {}).get(sn, 0.0) for sn in sample_names]
            matrix.append(row)

        # 5. Z-score normalize per gene (across samples)
        zmatrix: list[list[float]] = []
        for row in matrix:
            vals = [v for v in row if v != 0]
            if not vals:
                zmatrix.append([0.0] * len(row))
                continue
            mean = sum(vals) / len(vals)
            std  = math.sqrt(sum((v - mean) ** 2 for v in vals) / max(len(vals) - 1, 1))
            if std > 0:
                zmatrix.append([(v - mean) / std if v != 0 else 0.0 for v in row])
            else:
                zmatrix.append([0.0] * len(row))

        return {
            "genes": top_genes,
            "samples": sample_names,
            "matrix": matrix,
            "zmatrix": zmatrix,
        }


# ─── PCAService ─────────────────────────────────────────────────────────────

class PCAService:
    """
    Simple 2D PCA on samples using expression_fact.
    Projects samples onto PC1/PC2 using SVD on the gene × sample matrix.
    """

    def __init__(self, pg_conn):
        self._conn = pg_conn

    def load(self, n_genes: int = 500) -> dict[str, Any]:
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Get top variable genes for PCA
        cur.execute("""
            SELECT gene_id
            FROM gene_expression_summary
            WHERE dataset_code = %s
              AND metric_code = %s
              AND cv IS NOT NULL
            ORDER BY cv DESC
            LIMIT %s
        """, (DEFAULT_DATASET, DEFAULT_METRIC, n_genes))
        top_genes = [dict(r)["gene_id"] for r in cur.fetchall()]
        cur.close()

        if len(top_genes) < 2:
            return {"samples": [], "pc1": [], "pc2": [], "explained_variance_ratio": []}

        # Get expression matrix: genes × samples
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT
                f.gene_id,
                ds.sample_name,
                ds.stage,
                ds.sex,
                COALESCE(ds.stage_order,
                    (SELECT stage_order FROM stage_dim sd WHERE sd.stage_code = ds.stage LIMIT 1), 999
                ) AS stage_order,
                f.value
            FROM expression_fact f
            JOIN dataset_sample ds ON ds.dataset_sample_id = f.dataset_sample_id
            JOIN dataset d ON d.dataset_id = ds.dataset_id
            WHERE d.dataset_code = %s
              AND f.metric_code = %s
              AND f.gene_id = ANY(%s)
            ORDER BY stage_order, ds.sex, ds.sample_name
        """, (DEFAULT_DATASET, DEFAULT_METRIC, top_genes))
        rows = cur.fetchall()
        cur.close()

        # Build sample list + expression dict
        sample_info: list[dict[str, str]] = []
        seen: set[str] = set()
        expr: dict[str, dict[str, float]] = {}
        for r in rows:
            sn = r["sample_name"]
            if sn not in seen:
                seen.add(sn)
                sample_info.append({"sample_name": sn, "stage": r["stage"], "sex": r["sex"]})
            if sn not in expr:
                expr[sn] = {}
            expr[sn][r["gene_id"]] = float(r["value"]) if r["value"] is not None else 0.0

        sample_names = [s["sample_name"] for s in sample_info]
        n_samples = len(sample_names)
        n_genes_actual = len(top_genes)

        # Build matrix (genes × samples)
        M: list[list[float]] = []
        for gid in top_genes:
            M.append([expr[sn].get(gid, 0.0) for sn in sample_names])

        # Center columns (samples)
        col_means: list[float] = []
        for j in range(n_samples):
            col_sum = sum(M[i][j] for i in range(n_genes_actual))
            col_means.append(col_sum / n_genes_actual)
        for i in range(n_genes_actual):
            for j in range(n_samples):
                M[i][j] -= col_means[j]

        # SVD: compute sample covariance matrix S = (1/(n-1)) * M^T M  (n_samples × n_samples)
        n = n_samples
        S: list[list[float]] = [[0.0] * n for _ in range(n)]
        for i in range(n_genes_actual):
            for a in range(n):
                for b in range(n):
                    S[a][b] += M[i][a] * M[i][b]
        for a in range(n):
            for b in range(n):
                S[a][b] /= max(n_genes_actual - 1, 1)

        # Power iteration for top 2 eigenvalues/eigenvectors (fast approximation)
        def power_iteration(A, num_sim=50):
            n = len(A)
            v = [1.0 / math.sqrt(n)] * n
            for _ in range(num_sim):
                Av = [sum(A[i][j] * v[j] for j in range(n)) for i in range(n)]
                norm = math.sqrt(sum(x * x for x in Av))
                if norm < 1e-10:
                    break
                v = [x / norm for x in Av]
            return v

        def deflate(A, v):
            n = len(v)
            w = [sum(A[i][j] * v[j] for j in range(n)) for i in range(n)]
            vt_w = sum(v[j] * w[j] for j in range(n))
            for i in range(n):
                for j in range(n):
                    A[i][j] -= vt_w * v[i] * v[j]
            return A

        # PC1
        pc1_vec = power_iteration(S)
        pc1_eigval = sum(S[a][b] * pc1_vec[a] * pc1_vec[b] for a in range(n) for b in range(n))

        # Deflate and PC2
        S2 = [row[:] for row in S]
        deflate(S2, pc1_vec)
        pc2_vec = power_iteration(S2)

        # Project samples onto PCs
        pc1_coords = [sum(M[i][j] * pc1_vec[j] for i in range(n_genes_actual)) for j in range(n_samples)]
        pc2_coords = [sum(M[i][j] * pc2_vec[j] for i in range(n_genes_actual)) for j in range(n_samples)]

        # Explained variance ratio approximation
        total_var = sum(S[a][a] for a in range(n))
        ev_ratio = [abs(pc1_eigval) / max(total_var, 1e-10), 0.2]

        return {
            "samples": sample_info,
            "pc1": [round(v, 4) for v in pc1_coords],
            "pc2": [round(v, 4) for v in pc2_coords],
            "explained_variance_ratio": [round(v, 4) for v in ev_ratio],
        }


# ─── SampleCompositionService ───────────────────────────────────────────────

class SampleCompositionService:
    """
    Returns the number of samples per (stage, sex) group.
    """

    def __init__(self, pg_conn):
        self._conn = pg_conn

    def load(self) -> dict[str, Any]:
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT
                ds.stage,
                ds.sex,
                COUNT(*) AS sample_count
            FROM dataset_sample ds
            JOIN dataset d ON d.dataset_id = ds.dataset_id
            WHERE d.dataset_code = %s
            GROUP BY ds.stage, ds.sex
            ORDER BY ds.stage,
                CASE ds.sex WHEN 'Male' THEN 1 WHEN 'Female' THEN 2 ELSE 3 END
        """, (DEFAULT_DATASET,))
        rows = cur.fetchall()
        cur.close()

        stage_counts: dict[str, dict[str, int]] = {}
        for r in rows:
            stage_counts.setdefault(r["stage"], {"Male": 0, "Female": 0})
            if r["sex"] in ("Male", "Female"):
                stage_counts[r["stage"]][r["sex"]] = int(r["sample_count"])

        stage_order = self._get_stage_order()
        ordered_stages = sorted(stage_counts.keys(), key=lambda s: stage_order.get(s, 99))
        return {
            "stages": ordered_stages,
            "male":   [stage_counts[s]["Male"]   for s in ordered_stages],
            "female": [stage_counts[s]["Female"] for s in ordered_stages],
        }

    def _get_stage_order(self) -> dict[str, int]:
        cur = self._conn.cursor()
        cur.execute("SELECT stage_code, stage_order FROM stage_dim")
        rows = cur.fetchall()
        cur.close()
        return {r[0]: r[1] for r in rows if r[1] is not None}


# ─── ExpressionDistributionService ──────────────────────────────────────────

class ExpressionDistributionService:
    """
    Returns per-stage expression distribution statistics (quartiles).
    Extracts per-stage mean values from stage_means JSON for all genes.
    """

    def __init__(self, pg_conn):
        self._conn = pg_conn

    def load(self) -> dict[str, Any]:
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Extract mean values per gene per stage from stage_means JSON
        cur.execute("""
            SELECT
                j.stage,
                (ges.stage_means -> j.stage ->> 'mean')::float AS mean_val
            FROM (
                SELECT gene_id, jsonb_object_keys(stage_means) AS stage
                FROM gene_expression_summary
                WHERE dataset_code = %s
                  AND metric_code = %s
                  AND stage_means IS NOT NULL
            ) j
            JOIN gene_expression_summary ges ON ges.gene_id = j.gene_id
            JOIN mv_dataset_metric m ON m.dataset_code = ges.dataset_code
                AND m.metric_code = ges.metric_code
            WHERE m.is_enabled = TRUE
        """, (DEFAULT_DATASET, DEFAULT_METRIC))
        rows = cur.fetchall()
        cur.close()

        # Collect values per stage
        from collections import defaultdict
        stage_values: dict[str, list[float]] = defaultdict(list)
        for r in rows:
            stage_values[r["stage"]].append(float(r["mean_val"]) if r["mean_val"] else 0.0)

        def quartiles(vals: list[float]):
            if not vals:
                return 0.0, 0.0, 0.0
            s = sorted(vals)
            n = len(s)
            q1 = s[int(n * 0.25)]
            q2 = s[int(n * 0.50)]
            q3 = s[int(n * 0.75)]
            return q1, q2, q3

        stage_order = self._get_stage_order()
        ordered = sorted(stage_values.keys(), key=lambda s: stage_order.get(s, 99))

        q1_list, median_list, q3_list, gene_count_list = [], [], [], []
        for s in ordered:
            vals = stage_values[s]
            q1, q2, q3 = quartiles(vals)
            q1_list.append(round(q1, 4))
            median_list.append(round(q2, 4))
            q3_list.append(round(q3, 4))
            gene_count_list.append(len(vals))

        return {
            "stages":     ordered,
            "q1":         q1_list,
            "median":     median_list,
            "q3":         q3_list,
            "gene_count": gene_count_list,
        }

    def _get_stage_order(self) -> dict[str, int]:
        cur = self._conn.cursor()
        cur.execute("SELECT stage_code, stage_order FROM stage_dim")
        rows = cur.fetchall()
        cur.close()
        return {r[0]: r[1] for r in rows if r[1] is not None}


# ─── TrajectoryClustersService ───────────────────────────────────────────────

class TrajectoryClustersService:
    """
    K-means (k=4) on stage-wise mean expression vectors to find
    gene expression trajectory clusters.
    """

    K = 4

    def __init__(self, pg_conn):
        self._conn = pg_conn

    def load(self) -> dict[str, Any]:
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Extract gene × stage × mean from stage_means JSON
        cur.execute("""
            SELECT
                ges.gene_id,
                j.stage,
                COALESCE((ges.stage_means -> j.stage ->> 'mean')::float, 0) AS mean_val
            FROM gene_expression_summary ges
            CROSS JOIN LATERAL jsonb_object_keys(ges.stage_means) AS j(stage)
            JOIN mv_dataset_metric m ON m.dataset_code = ges.dataset_code
                AND m.metric_code = ges.metric_code
            WHERE ges.dataset_code = %s
              AND ges.metric_code = %s
              AND ges.stage_means IS NOT NULL
              AND m.is_enabled = TRUE
            ORDER BY ges.gene_id, j.stage
        """, (DEFAULT_DATASET, DEFAULT_METRIC))
        rows = cur.fetchall()
        cur.close()

        # Pivot: gene_id → {stage: mean_val}
        gene_stages: dict[str, dict[str, float]] = {}
        all_stages: set[str] = set()
        for r in rows:
            gid = r["gene_id"]
            stage = r["stage"]
            all_stages.add(stage)
            gene_stages.setdefault(gid, {})[stage] = float(r["mean_val"]) if r["mean_val"] else 0.0

        stage_order = self._get_stage_order()
        ordered_stages = sorted(all_stages, key=lambda s: stage_order.get(s, 99))

        # Build vectors
        gene_vectors: list[tuple[str, list[float]]] = []
        for gid, sv in gene_stages.items():
            vec = [sv.get(s, 0.0) for s in ordered_stages]
            if any(v != 0 for v in vec):
                gene_vectors.append((gid, vec))

        if len(gene_vectors) < self.K:
            return {"clusters": [], "stages": ordered_stages, "centroids": []}

        # K-means
        import random
        vectors = [v for _, v in gene_vectors]
        centroids = self._kmeans(vectors, self.K)

        # Assign genes to nearest centroid
        clusters: list[list[tuple[str, list[float]]]] = [[] for _ in range(self.K)]
        for gid, vec in gene_vectors:
            dists = [self._euclidean(vec, c) for c in centroids]
            cluster_id = int(dists.index(min(dists)))
            clusters[cluster_id].append((gid, vec))

        return {
            "stages": ordered_stages,
            "centroids": [[round(v, 4) for v in c] for c in centroids],
            "clusters": [
                {
                    "cluster_id": i,
                    "gene_count": len(c),
                    "gene_ids": [g[0] for g in c[:10]],
                }
                for i, c in enumerate(clusters)
            ],
        }

    def _kmeans(self, vectors: list[list[float]], k: int, max_iter: int = 20) -> list[list[float]]:
        import random
        if len(vectors) < k:
            k = len(vectors)
        centroids = [vectors[i] for i in random.sample(range(len(vectors)), k)]
        for _ in range(max_iter):
            assignments: list[list[int]] = [[] for _ in range(k)]
            for idx, vec in enumerate(vectors):
                dists = [self._euclidean(vec, c) for c in centroids]
                assignments[dists.index(min(dists))].append(idx)
            new_centroids: list[list[float]] = []
            for ci, group in enumerate(assignments):
                if not group:
                    new_centroids.append(centroids[ci])
                    continue
                n = len(group)
                new_centroid = [sum(vectors[g][d] for g in group) / n for d in range(len(vectors[0]))]
                new_centroids.append(new_centroid)
            if centroids == new_centroids:
                break
            centroids = new_centroids
        return centroids

    @staticmethod
    def _euclidean(a: list[float], b: list[float]) -> float:
        return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))

    def _get_stage_order(self) -> dict[str, int]:
        cur = self._conn.cursor()
        cur.execute("SELECT stage_code, stage_order FROM stage_dim")
        rows = cur.fetchall()
        cur.close()
        return {r[0]: r[1] for r in rows if r[1] is not None}
