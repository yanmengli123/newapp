import {
  Box,
  Group,
  Pagination,
  Paper,
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
import { useState, useMemo } from "react";
import { IconDownload, IconSearch, IconSortAscending, IconSortDescending } from "@tabler/icons-react";
import { IconGenderMale, IconGenderFemale } from "@tabler/icons-react";
import type { ExpressionSample } from "../../lib/geneApi";

interface ExpressionTableProps {
  samples: ExpressionSample[];
  summary: { max_value: number | null; min_value: number | null } | undefined;
  dataset: string;
}

type SortKey = "sample_name" | "stage" | "sex" | "replicate" | "value" | "z_score" | "log2fc";
type SortDir = "asc" | "desc";
type SexFilter = "all" | "M" | "F";

const PAGE_SIZE = 12;

type StageOrderMap = { [key: string]: number };
const STAGE_ORDER: StageOrderMap = {
  E0: 1, "E3.5": 2, E7: 3, "E11": 4, "E14": 5, "E18.5": 6, P0: 7, Adult: 8,
};

function exportCSV(samples: ExpressionSample[], dataset: string) {
  const headers = [
    "Sample Name",
    "Stage",
    "Stage Label",
    "Sex",
    "Replicate",
    "SRR Run",
    "Batch",
    "Tissue",
    "Value",
    "Z-Score",
    "Log2FC",
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
    s.log2fc?.toString() ?? "",
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
  const [sexFilter, setSexFilter] = useState<SexFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  // Unique stages
  const stages = useMemo(() => {
    const s = Array.from(new Set(samples.map((sm) => sm.stage))).sort(
      (a, b) => (STAGE_ORDER[a] ?? 99) - (STAGE_ORDER[b] ?? 99)
    );
    return s;
  }, [samples]);

  const stageOptions = [
    { value: "all", label: "All Stages" },
    ...stages.map((s) => ({ value: s, label: s })),
  ];

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
      list = list.filter((s) =>
        sexFilter === "M" ? s.sex === "Male" : s.sex === "Female"
      );
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
        case "log2fc": av = a.log2fc; bv = b.log2fc; break;
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
  }, [samples, search, stageFilter, sexFilter, sortKey, sortDir]);

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

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <IconSortAscending size={10} color="var(--mantine-color-gray-5)" />;
    return sortDir === "asc" ? (
      <IconSortAscending size={10} color="var(--mantine-color-violet-6)" />
    ) : (
      <IconSortDescending size={10} color="var(--mantine-color-violet-6)" />
    );
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
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
              data={stageOptions}
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
              onChange={(v) => { setSexFilter(v as SexFilter); setPage(1); }}
            />
          </Group>
          <Group gap="xs">
            <Text size="xs" c="dimmed">
              {filtered.length} / {samples.length} samples
            </Text>
            <Tooltip label="Export CSV">
              <Badge
                variant="light"
                color="gray"
                size="sm"
                style={{ cursor: "pointer", userSelect: "none" }}
                onClick={() => exportCSV(samples, dataset)}
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
                  <Group gap={4}><SortIcon k="sample_name" />Sample</Group>
                </Table.Th>
                <Table.Th style={{ cursor: "pointer" }} onClick={() => toggleSort("stage")}>
                  <Group gap={4}><SortIcon k="stage" />Stage</Group>
                </Table.Th>
                <Table.Th>SRR Run</Table.Th>
                <Table.Th style={{ cursor: "pointer" }} onClick={() => toggleSort("sex")}>
                  <Group gap={4}><SortIcon k="sex" />Sex</Group>
                </Table.Th>
                <Table.Th style={{ cursor: "pointer" }} onClick={() => toggleSort("replicate")}>
                  <Group gap={4}><SortIcon k="replicate" />Rep</Group>
                </Table.Th>
                <Table.Th style={{ cursor: "pointer", textAlign: "right" }} onClick={() => toggleSort("value")}>
                  <Group gap={4} justify="flex-end"><SortIcon k="value" />Value</Group>
                </Table.Th>
                <Table.Th style={{ minWidth: 120 }}>Relative Level</Table.Th>
                <Table.Th style={{ cursor: "pointer", textAlign: "right" }} onClick={() => toggleSort("z_score")}>
                  <Group gap={4} justify="flex-end"><SortIcon k="z_score" />Z-Score</Group>
                </Table.Th>
                <Table.Th style={{ cursor: "pointer", textAlign: "right" }} onClick={() => toggleSort("log2fc")}>
                  <Group gap={4} justify="flex-end"><SortIcon k="log2fc" />Log2FC</Group>
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
                          {sample.sex === "Male" ? (
                            <IconGenderMale size={13} color="var(--mantine-color-blue-6)" />
                          ) : sample.sex === "Female" ? (
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
                            sample.log2fc == null
                              ? undefined
                              : sample.log2fc > 1
                                ? "teal"
                                : sample.log2fc < -1
                                  ? "red"
                                  : "dimmed"
                          }
                        >
                          {sample.log2fc != null ? sample.log2fc.toFixed(3) : "—"}
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
