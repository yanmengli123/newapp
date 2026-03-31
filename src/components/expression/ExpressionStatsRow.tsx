import { Box, Group, Paper, SimpleGrid, Text, ThemeIcon } from "@mantine/core";
import {
  IconGenderMale,
  IconGenderFemale,
  IconTrendingUp,
  IconTrendingDown,
  IconMinus,
  IconActivity,
  IconFlask,
  IconChartLine,
} from "@tabler/icons-react";
import type { GeneExpressionResponse } from "../../lib/geneApi";

interface ExpressionStatsRowProps {
  summary: GeneExpressionResponse["summary"];
  sampleCount: number;
}

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  icon?: React.ReactNode;
}

function StatCard({ label, value, sub, color = "gray", icon }: StatCardProps) {
  return (
    <Paper withBorder p="xs" radius="md" bg="gray.0">
      <Group gap="xs" wrap="nowrap">
        {icon && (
          <ThemeIcon variant="light" color={color} size="sm" radius="md">
            {icon}
          </ThemeIcon>
        )}
        <Box>
          <Text size="xs" c="dimmed" tt="uppercase">
            {label}
          </Text>
          <Text fw={700} size="sm" c={color !== "gray" ? `${color}.7` : undefined}>
            {value}
          </Text>
          {sub && (
            <Text size="xs" c="dimmed" truncate>
              {sub}
            </Text>
          )}
        </Box>
      </Group>
    </Paper>
  );
}

function SexBiasBadge({ label, ratio }: { label: string | null | undefined; ratio: number | null | undefined }) {
  if (!label) return <StatCard label="Sex Bias" value="—" color="gray" />;

  const config = {
    Female_higher: { icon: <IconGenderFemale size={12} />, color: "pink", text: "F > M" },
    Male_higher: { icon: <IconGenderMale size={12} />, color: "blue", text: "M > F" },
    No_difference: { icon: <IconMinus size={12} />, color: "gray", text: "F = M" },
  }[label] ?? { icon: null, color: "gray" as const, text: label };

  const ratioStr = ratio != null ? `${ratio.toFixed(2)}x` : undefined;
  return (
    <StatCard
      label="Sex Bias"
      value={config.text}
      sub={ratioStr}
      color={config.color}
      icon={config.icon}
    />
  );
}

export default function ExpressionStatsRow({ summary, sampleCount }: ExpressionStatsRowProps) {
  if (!summary) return null;

  const meanStr = summary.mean_value != null ? summary.mean_value.toFixed(3) : "—";
  const stdStr = summary.std_value != null ? `± ${summary.std_value.toFixed(3)}` : "—";
  const cvStr = summary.cv != null ? summary.cv.toFixed(4) : null;
  const maxStr = summary.max_value != null ? summary.max_value.toFixed(3) : "—";
  const minStr = summary.min_value != null ? summary.min_value.toFixed(3) : "—";
  const topStage = summary.top_stage || "—";
  const topSample = summary.top_sample || "—";
  const exprCount = summary.expressed_samples ?? 0;
  const zeroCount = summary.zero_samples ?? 0;

  const trendIcon =
    (summary.fold_change_top ?? 0) > 2 ? (
      <IconTrendingUp size={12} />
    ) : (summary.fold_change_top ?? 0) < 0.5 ? (
      <IconTrendingDown size={12} />
    ) : (
      <IconActivity size={12} />
    );

  return (
    <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 7 }} spacing="xs">
      <StatCard
        label="Max"
        value={maxStr}
        sub={topSample}
        color="violet"
        icon={<IconChartLine size={12} />}
      />
      <StatCard
        label="Min"
        value={minStr}
        color="gray"
        icon={<IconChartLine size={12} />}
      />
      <StatCard
        label="Mean ± Std"
        value={`${meanStr}`}
        sub={stdStr}
        color="cyan"
        icon={<IconActivity size={12} />}
      />
      {cvStr && (
        <StatCard
          label="CV"
          value={cvStr}
          color="orange"
          icon={trendIcon}
        />
      )}
      <StatCard
        label="Expressed"
        value={`${exprCount}/${sampleCount}`}
        sub={`${zeroCount} zero`}
        color="teal"
        icon={<IconFlask size={12} />}
      />
      <StatCard label="Top Stage" value={topStage} color="grape" />
      <SexBiasBadge label={summary.sex_bias_label} ratio={summary.sex_bias_ratio} />
    </SimpleGrid>
  );
}
