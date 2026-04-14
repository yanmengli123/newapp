 
import {
  ActionIcon,
  Box,
  Divider,
  Group,
  Pagination,
  Paper,
  Popover,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
  Progress,
  Badge,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useState, useMemo } from "react";
import {
  IconDownload,
  IconInfoCircle,
  IconSearch,
  IconSortAscending,
  IconSortDescending,
} from "@tabler/icons-react";
import { IconGenderMale, IconGenderFemale } from "@tabler/icons-react";
import type { ExpressionSample, GeneExpressionResponse } from "../../lib/geneApi";
import { getDatasetDisplayName } from "./utils";

interface ExpressionTableProps {
  samples: ExpressionSample[];
  summary: GeneExpressionResponse["summary"];
  dataset: string;
}

type SortKey = "sample_name" | "stage" | "sex" | "replicate" | "value" | "z_score" | "log2fc";
type SortDir = "asc" | "desc";
type Log2Baseline = "e0" | "mean" | "stage";

const PAGE_SIZE = 12;

// ── Tips content ─────────────────────────────────────────────────────────────

const TABLE_TIPS_CONTENT = (
  <Stack gap="xs" style={{ minWidth: 360, maxWidth: 440 }}>
    {/* 标题 */}
    <Text size="sm" fw={700}>Expression Table 分析说明</Text>

    <Divider size="xs" />

    {/* 1. 数据来源 */}
    <Stack gap={4}>
      <Text size="xs" fw={600} c="blue">▌1. 数据来源</Text>
      <Text size="xs" c="dimmed">
        数据来自 <Text component="code" size="xs">GET /genes/{"{gene_id}"}/expression?dataset=day_deseq2_36&amp;metric=normcount</Text>
      </Text>
      <Text size="xs" c="dimmed">
        36 个样本 = 6 stages × 2 sexes × 3 replicates（DESeq2 NC 标准化结果）
      </Text>
    </Stack>

    <Divider size="xs" />

    {/* 2. 列含义 */}
    <Stack gap={4}>
      <Text size="xs" fw={600} c="blue">▌2. 列含义</Text>
      <Text size="xs" c="dimmed">
        <Text span fw={600}>Sample</Text> — 样本名称（如 E0_M_R1）
      </Text>
      <Text size="xs" c="dimmed">
        <Text span fw={600}>Stage</Text> — 发育阶段（E0/E7/E11/E14/E18.5/P0/Adult）
      </Text>
      <Text size="xs" c="dimmed">
        <Text span fw={600}>SRR Run</Text> — SRA Run ID（等宽字体）
      </Text>
      <Text size="xs" c="dimmed">
        <Text span fw={600}>Sex</Text> — 性别（♂ Male / ♀ Female 图标）
      </Text>
      <Text size="xs" c="dimmed">
        <Text span fw={600}>Rep</Text> — 生物学重复编号（R1/R2/R3）
      </Text>
      <Text size="xs" c="dimmed">
        <Text span fw={600}>Value</Text> — DESeq2 标准化计数（原始值，3位小数）
      </Text>
      <Text size="xs" c="dimmed">
        <Text span fw={600}>Relative Level</Text> — 相对表达量（该样本值/max值 × 100%）
      </Text>
      <Text size="xs" c="dimmed">
        <Text span fw={600}>Z-Score</Text> — (样本值 - 全局均值) / 全局标准差
      </Text>
      <Text size="xs" c="dimmed">
        <Text span fw={600}>Log2FC</Text> — log₂(样本值 / Baseline)
      </Text>
    </Stack>

    <Divider size="xs" />

    {/* 3. Z-Score 计算 */}
    <Stack gap={4}>
      <Text size="xs" fw={600} c="blue">▌3. Z-Score 计算</Text>
      <Text size="xs" c="dimmed">
        <Text component="code" size="xs">Z = (Value - μ) / σ</Text>
      </Text>
      <Text size="xs" c="dimmed">
        其中 μ = 所有36个样本的均值，σ = 所有36个样本的标准差
      </Text>
      <Text size="xs" c="dimmed">
        例：某样本 Value=150，全局 Mean=80，Std=25 → Z = (150-80)/25 = <Text span fw={600}>2.80</Text>
      </Text>
      <Text size="xs" c="dimmed">
        Z &gt; 0：高于平均水平；Z &lt; 0：低于平均水平；|Z| &gt; 2：显著偏离
      </Text>
    </Stack>

    <Divider size="xs" />

    {/* 4. Log2FC 计算 */}
    <Stack gap={4}>
      <Text size="xs" fw={600} c="blue">▌4. Log2FC 计算</Text>
      <Text size="xs" c="dimmed">
        <Text component="code" size="xs">Log2FC = log₂(Value / Baseline)</Text>
      </Text>
      <Text size="xs" c="dimmed">
        Baseline 有三种模式（右上角切换）：
      </Text>
    </Stack>

    <Stack gap={3} pl="sm">
      <Group gap="xs">
        <Badge size="xs" color="violet" variant="light">E0 baseline</Badge>
        <Text size="xs" c="dimmed">E0 阶段的 mean 值作为基准</Text>
      </Group>
      <Group gap="xs">
        <Badge size="xs" color="violet" variant="light">Overall</Badge>
        <Text size="xs" c="dimmed">所有36个样本的全局均值作为基准</Text>
      </Group>
      <Group gap="xs">
        <Badge size="xs" color="violet" variant="light">Stage median</Badge>
        <Text size="xs" c="dimmed">用户选择一个参考stage，以该stage的mean作为基准</Text>
      </Group>
    </Stack>

    <Text size="xs" c="dimmed" mt={4}>
      例：Value=100，Baseline=50 → Log2FC = log₂(100/50) = <Text span fw={600}>1.00</Text>
    </Text>
    <Text size="xs" c="dimmed">
      Log2FC &gt; 1：上调（2倍）；Log2FC &lt; -1：下调（0.5倍）；-1~1 之间：轻微变化
    </Text>

    <Divider size="xs" />

    {/* 5. 颜色语义 */}
    <Stack gap={4}>
      <Text size="xs" fw={600} c="blue">▌5. 颜色语义</Text>
    </Stack>

    <Stack gap={3} pl="sm">
      <Group gap="xs">
        <Badge size="xs" color="teal" variant="light">Log2FC &gt; 1</Badge>
        <Text size="xs">显著上调（相对baseline翻倍+）</Text>
      </Group>
      <Group gap="xs">
        <Badge size="xs" color="red" variant="light">Log2FC &lt; -1</Badge>
        <Text size="xs">显著下调（相对baseline减半-）</Text>
      </Group>
      <Group gap="xs">
        <Badge size="xs" color="gray" variant="light">|Log2FC| ≤ 1</Badge>
        <Text size="xs">轻微变化（无显著上下调）</Text>
      </Group>
    </Stack>

    <Divider size="xs" />

    {/* 6. 过滤与排序 */}
    <Stack gap={4}>
      <Text size="xs" fw={600} c="blue">▌6. 过滤与排序</Text>
      <Text size="xs" c="dimmed">
        <Text span fw={600}>搜索框</Text> — 按 Sample Name / Stage / SRR Run 模糊搜索
      </Text>
      <Text size="xs" c="dimmed">
        <Text span fw={600}>Stage 过滤</Text> — 下拉选择特定发育阶段
      </Text>
      <Text size="xs" c="dimmed">
        <Text span fw={600}>Sex 过滤</Text> — All / Male / Female 切换
      </Text>
      <Text size="xs" c="dimmed">
        <Text span fw={600}>点击列头</Text> — 升序/降序切换（再次点击同列反转方向）
      </Text>
    </Stack>

    <Divider size="xs" />

    {/* 7. CSV 导出 */}
    <Stack gap={4}>
      <Text size="xs" fw={600} c="blue">▌7. CSV 导出</Text>
      <Text size="xs" c="dimmed">
        点击右上角 <Text component="code" size="xs">CSV</Text> 按钮导出当前过滤后的数据
      </Text>
      <Text size="xs" c="dimmed">
        列包含当前选定的 Baseline 类型（如 Log2FC (E0 baseline)）
      </Text>
      <Text size="xs" c="dimmed">
        下载文件名格式：<Text component="code" size="xs">expression_day_deseq2_36.csv</Text>
      </Text>
    </Stack>
  </Stack>
);

// ── Component ────────────────────────────────────────────────────────────────

const STAGE_ORDER: Record<string, number> = {
  E0: 1, "E3.5": 2, E7: 3, "E11": 4, "E14": 5, "E18.5": 6, P0: 7, Adult: 8,
};

function normalizeSex(s: string | null | undefined): "Male" | "Female" | null {
  if (s === "Male" || s === "M" || s === "m") return "Male";
  if (s === "Female" || s === "F" || s === "f") return "Female";
  return null;
}

function SortIcon({ k, sortKey, sortDir }: { k: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== k) return <IconSortAscending size={10} color="var(--mantine-color-gray-5)" />;
  return sortDir === "asc" ? (
    <IconSortAscending size={10} color="var(--mantine-color-violet-6)" />
  ) : (
    <IconSortDescending size={10} color="var(--mantine-color-violet-6)" />
  );
}

function log2fc(a: number, b: number): number | null {
  if (a <= 0 || b <= 0) return null;
  return Math.log2(a / b);
}

function getStageMeans(
  stageMeans: Record<string, Record<string, unknown> | number | null> | null | undefined
): Record<string, number> {
  if (!stageMeans || typeof stageMeans !== "object") return {};
  const result: Record<string, number> = {};
  const entries = Object.entries(stageMeans as Record<string, unknown>);
  entries.sort(([a], [b]) => (STAGE_ORDER[a] ?? 99) - (STAGE_ORDER[b] ?? 99));
  for (const [stage, val] of entries) {
    if (!stage) continue;
    if (val != null && typeof val === "object") {
      const obj = val as Record<string, unknown>;
      const meanVal =
        typeof obj["mean"] === "number" ? (obj["mean"] as number)
        : (Object.values(obj).find(v => typeof v === "number") as number | undefined) ?? 0;
      result[stage] = meanVal;
    } else if (typeof val === "number") {
      result[stage] = val;
    }
  }
  return result;
}

function exportCSV(
  samples: ExpressionSample[],
  dataset: string,
  log2fcMap: Map<number, number | null>,
  baselineLabel: string
) {
  const headers = [
    "Sample Name", "Stage", "Stage Label", "Sex", "Replicate",
    "SRR Run", "Batch", "Tissue", "Value", "Z-Score",
    `Log2FC (${baselineLabel})`,
  ];
  const rows = samples.map((s) => [
    s.sample_name ?? "",
    s.stage ?? "",
    s.stage_label ?? "",
    s.sex ?? "",
    s.replicate?.toString() ?? "",
    s.srr_run_id ?? "",
    s.batch ?? "",
    s.tissue ?? "",
    s.value.toString(),
    s.z_score?.toString() ?? "",
    (log2fcMap.get(s.dataset_sample_id) ?? null)?.toString() ?? "",
  ]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `expression_${dataset}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExpressionTable({ samples, summary, dataset }: ExpressionTableProps) {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string | null>("all");
  const [sexFilter, setSexFilter] = useState<"all" | "M" | "F">("all");
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [log2Baseline, setLog2Baseline] = useState<Log2Baseline>("e0");
  const [stageMedianStage, setStageMedianStage] = useState<string>("E0");
  const [opened, { toggle, close }] = useDisclosure(false);

  // Stage means from summary
  const stageMeansMap = useMemo(
    () => getStageMeans(summary?.stage_means ?? null),
    [summary?.stage_means]
  );

  // Available stages sorted by development order
  const availableStages = useMemo(
    () =>
      Object.keys(stageMeansMap).sort(
        (a, b) => (STAGE_ORDER[a] ?? 99) - (STAGE_ORDER[b] ?? 99)
      ),
    [stageMeansMap]
  );

  // Overall mean from summary
  const overallMean = summary?.mean_value ?? 0;

  // E0 baseline (earliest stage)
  const e0Baseline = useMemo(() => {
    const first = availableStages[0];
    return first ? (stageMeansMap[first] ?? 0) : 0;
  }, [availableStages, stageMeansMap]);

  // Stage median baseline
  const stageMedianBaseline = stageMeansMap[stageMedianStage] ?? 0;

  // Current baseline value and label
  const baseline = log2Baseline === "e0" ? e0Baseline
    : log2Baseline === "mean" ? overallMean
    : stageMedianBaseline;

  const baselineLabel =
    log2Baseline === "e0" ? `E0 (${e0Baseline.toFixed(2)})`
    : log2Baseline === "mean" ? `Overall (${overallMean.toFixed(2)})`
    : `${stageMedianStage} (${stageMedianBaseline.toFixed(2)})`;

  // Compute Log2FC per sample
  const log2fcMap = useMemo(() => {
    const map = new Map<number, number | null>();
    for (const s of samples) {
      map.set(s.dataset_sample_id, log2fc(s.value ?? 0, baseline));
    }
    return map;
  }, [samples, baseline]);

  // Stages for filter dropdown
  const stages = useMemo(
    () =>
      Array.from(new Set(samples.map((sm) => sm.stage))).sort(
        (a, b) => (STAGE_ORDER[a] ?? 99) - (STAGE_ORDER[b] ?? 99)
      ),
    [samples]
  );

  const stageFilterOptions = [
    { value: "all", label: "All Stages" },
    ...stages.map((s) => ({ value: s, label: s })),
  ];

  const stageMedianOptions = availableStages.map((s) => ({ value: s, label: s }));

  const filtered = useMemo(() => {
    let list = [...samples];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          (s.sample_name ?? "").toLowerCase().includes(q) ||
          (s.stage ?? "").toLowerCase().includes(q) ||
          (s.srr_run_id ?? "").toLowerCase().includes(q)
      );
    }
    if (stageFilter && stageFilter !== "all") {
      list = list.filter((s) => s.stage === stageFilter);
    }
    if (sexFilter !== "all") {
      list = list.filter((s) => {
        const canon = normalizeSex(s.sex);
        return sexFilter === "M" ? canon === "Male" : canon === "Female";
      });
    }
    list.sort((a, b) => {
      let av: number | string | null | undefined;
      let bv: number | string | null | undefined;
      switch (sortKey) {
        case "sample_name": av = a.sample_name; bv = b.sample_name; break;
        case "stage": av = STAGE_ORDER[a.stage] ?? a.stage; bv = STAGE_ORDER[b.stage] ?? b.stage; break;
        case "sex": av = a.sex; bv = b.sex; break;
        case "replicate": av = a.replicate; bv = b.replicate; break;
        case "value": av = a.value; bv = b.value; break;
        case "z_score": av = a.z_score; bv = b.z_score; break;
        case "log2fc": av = log2fcMap.get(a.dataset_sample_id) ?? null; bv = log2fcMap.get(b.dataset_sample_id) ?? null; break;
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return list;
  }, [samples, search, stageFilter, sexFilter, sortKey, sortDir, log2fcMap]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageData = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const maxVal = summary?.max_value ?? 1;

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        {/* Title + info button */}
        <Group justify="space-between" align="center">
          <Text size="xs" fw={600} c="dimmed">
            Expression Table — {getDatasetDisplayName(dataset)}
          </Text>
          <Popover
            opened={opened}
            onClose={close}
            position="top"
            withArrow
            shadow="md"
            middlewares={{ flip: true, shift: true, inline: true }}
            transitionProps={{ transition: "pop" }}
          >
            <Popover.Target>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                onClick={toggle}
                title="查看分析说明"
              >
                <IconInfoCircle size={14} />
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown
              style={{
                padding: 12,
                maxHeight: "70vh",
                overflowY: "auto",
                maxWidth: 460,
              }}
            >
              {TABLE_TIPS_CONTENT}
            </Popover.Dropdown>
          </Popover>
        </Group>

        {/* Toolbar */}
        <Group justify="space-between" gap="xs">
          <Group gap="xs">
            <TextInput
              size="xs"
              placeholder="Search sample..."
              leftSection={<IconSearch size={12} />}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              w={180}
            />
            <Select
              size="xs"
              data={stageFilterOptions}
              value={stageFilter}
              onChange={(v) => { setStageFilter(v); setPage(1); }}
              w={120}
            />
            <SegmentedControl
              size="xs"
              data={[
                { value: "all", label: "All" },
                { value: "M", label: "Male" },
                { value: "F", label: "Female" },
              ]}
              value={sexFilter}
              onChange={(v) => { setSexFilter(v as typeof sexFilter); setPage(1); }}
            />
          </Group>
          <Group gap="xs">
            {/* Log2FC baseline selector */}
            <SegmentedControl
              size="xs"
              data={[
                { value: "e0", label: "E0 baseline" },
                { value: "mean", label: "Overall" },
                { value: "stage", label: "Stage median" },
              ]}
              value={log2Baseline}
              onChange={(v) => { setLog2Baseline(v as Log2Baseline); setPage(1); }}
            />
            {log2Baseline === "stage" && (
              <Select
                size="xs"
                data={stageMedianOptions}
                value={stageMedianStage}
                onChange={(v) => { setStageMedianStage(v ?? "E0"); setPage(1); }}
                w={80}
              />
            )}
            <Text size="xs" c="dimmed">
              {filtered.length} / {samples.length}
            </Text>
            <Tooltip label={`Export ${filtered.length} samples`}>
              <Badge
                variant="light"
                color="gray"
                size="sm"
                style={{ cursor: "pointer", userSelect: "none" }}
                onClick={() => exportCSV(filtered, dataset, log2fcMap, baselineLabel)}
              >
                <Group gap={4}>
                  <IconDownload size={10} />
                  CSV
                </Group>
              </Badge>
            </Tooltip>
          </Group>
        </Group>

        {/* Table */}
        <Box style={{ overflowX: "auto" }}>
          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ minWidth: 160, cursor: "pointer" }} onClick={() => toggleSort("sample_name")}>
                  <Group gap={4}><SortIcon k="sample_name" sortKey={sortKey} sortDir={sortDir} />Sample</Group>
                </Table.Th>
                <Table.Th style={{ cursor: "pointer" }} onClick={() => toggleSort("stage")}>
                  <Group gap={4}><SortIcon k="stage" sortKey={sortKey} sortDir={sortDir} />Stage</Group>
                </Table.Th>
                <Table.Th>SRR Run</Table.Th>
                <Table.Th style={{ cursor: "pointer" }} onClick={() => toggleSort("sex")}>
                  <Group gap={4}><SortIcon k="sex" sortKey={sortKey} sortDir={sortDir} />Sex</Group>
                </Table.Th>
                <Table.Th style={{ cursor: "pointer" }} onClick={() => toggleSort("replicate")}>
                  <Group gap={4}><SortIcon k="replicate" sortKey={sortKey} sortDir={sortDir} />Rep</Group>
                </Table.Th>
                <Table.Th style={{ cursor: "pointer", textAlign: "right" }} onClick={() => toggleSort("value")}>
                  <Group gap={4} justify="flex-end"><SortIcon k="value" sortKey={sortKey} sortDir={sortDir} />Value</Group>
                </Table.Th>
                <Table.Th style={{ minWidth: 120 }}>Relative Level</Table.Th>
                <Table.Th style={{ cursor: "pointer", textAlign: "right" }} onClick={() => toggleSort("z_score")}>
                  <Group gap={4} justify="flex-end"><SortIcon k="z_score" sortKey={sortKey} sortDir={sortDir} />Z-Score</Group>
                </Table.Th>
                <Table.Th style={{ cursor: "pointer", textAlign: "right" }} onClick={() => toggleSort("log2fc")}>
                  <Group gap={4} justify="flex-end">
                    <SortIcon k="log2fc" sortKey={sortKey} sortDir={sortDir} />
                    <Tooltip label={`Baseline: ${baselineLabel}`} multiline w={200}>
                      <span>Log2FC ↕</span>
                    </Tooltip>
                  </Group>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {pageData.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={9}>
                    <Text size="xs" c="dimmed" ta="center">No samples match current filters</Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                pageData.map((sample) => {
                  const val = sample.value ?? 0;
                  const pct = maxVal > 0 ? Math.min((val / maxVal) * 100, 100) : 0;
                  const isZero = val === 0;
                  const isHigh = pct > 80;
                  const isMedium = pct > 30;
                  const l2fc = log2fcMap.get(sample.dataset_sample_id) ?? null;

                  return (
                    <Table.Tr key={sample.dataset_sample_id} style={isZero ? { opacity: 0.45 } : undefined}>
                      <Table.Td>
                        <Text size="xs" fw={500}>{sample.sample_name ?? "—"}</Text>
                        <Text size="xs" c="dimmed">{sample.stage_label ?? ""}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge variant="light" color="gray" size="xs">{sample.stage}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed" style={{ fontFamily: "monospace" }}>
                          {sample.srr_run_id ?? "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {normalizeSex(sample.sex) === "Male" ? (
                            <IconGenderMale size={13} color="var(--mantine-color-blue-6)" />
                          ) : normalizeSex(sample.sex) === "Female" ? (
                            <IconGenderFemale size={13} color="var(--mantine-color-pink-6)" />
                          ) : null}
                          <Text size="xs">{sample.sex ?? "—"}</Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{sample.replicate != null ? `R${sample.replicate}` : "—"}</Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }}>
                        <Text
                          size="xs"
                          fw={500}
                          ff="monospace"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {val.toFixed(3)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Tooltip label={`${pct.toFixed(1)}% of max (${maxVal.toFixed(3)})`}>
                          <Progress
                            value={pct}
                            color={isZero ? "gray" : isHigh ? "violet" : isMedium ? "indigo" : "gray"}
                            size="sm"
                            radius="xl"
                            style={{ minWidth: 80 }}
                          />
                        </Tooltip>
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }}>
                        <Text size="xs" ff="monospace" c="dimmed">
                          {sample.z_score != null ? sample.z_score.toFixed(3) : "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }}>
                        <Text
                          size="xs"
                          ff="monospace"
                          c={
                            l2fc == null
                              ? undefined
                              : l2fc > 1
                                ? "teal"
                                : l2fc < -1
                                  ? "red"
                                  : "dimmed"
                          }
                        >
                          {l2fc != null ? l2fc.toFixed(3) : "—"}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  );
                })
              )}
            </Table.Tbody>
          </Table>
        </Box>

        {/* Pagination */}
        {totalPages > 1 && (
          <Group justify="center" mt="xs">
            <Pagination
              total={totalPages}
              value={page}
              onChange={setPage}
              size="xs"
              withEdges
            />
          </Group>
        )}
      </Stack>
    </Paper>
  );
}
