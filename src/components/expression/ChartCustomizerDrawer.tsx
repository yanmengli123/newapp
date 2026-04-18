import {
  Badge,
  Box,
  Button,
  ColorInput,
  Divider,
  Drawer,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Slider,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useCallback } from "react";
import type {
  ChartPreset,
  ChartType,
  ScopeLevel,
} from "./chartCustomizer.types";
import {
  CHART_TYPE_LABELS,
} from "./chartCustomizer.defaults";
import type { UseChartCustomizerReturn } from "./useChartCustomizer";

interface ChartCustomizerDrawerProps {
  opened: boolean;
  onClose: () => void;
  hook: UseChartCustomizerReturn;
}

const SCOPE_OPTIONS: { label: string; value: ScopeLevel }[] = [
  { label: "Theme", value: "theme" },
  { label: "Current Chart", value: "current" },
  { label: "Advanced", value: "advanced" },
];

const PRESET_OPTIONS: { label: string; value: ChartPreset }[] = [
  { label: "Default", value: "default" },
  { label: "Print", value: "print" },
  { label: "High Contrast", value: "highContrast" },
  { label: "Colorblind Safe", value: "colorblindSafe" },
];

const CHART_TYPE_OPTIONS = Object.entries(CHART_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

function ThemePanel({ hook }: { hook: UseChartCustomizerReturn }) {
  const { config, updateTheme, updatePreset } = hook;
  const theme = config.theme;

  return (
    <Stack gap="md">
      {/* Preset */}
      <Select
        label="Color Preset"
        size="xs"
        data={PRESET_OPTIONS}
        value={theme.preset}
        onChange={(v) => v && updatePreset(v as ChartPreset)}
      />

      <Divider label="Colors" labelPosition="left" />

      <SimpleGrid cols={2}>
        <ColorInput
          label="Male Color"
          size="xs"
          value={theme.colors.male}
          onChange={(v) => updateTheme({ colors: { ...theme.colors, male: v } })}
        />
        <ColorInput
          label="Female Color"
          size="xs"
          value={theme.colors.female}
          onChange={(v) => updateTheme({ colors: { ...theme.colors, female: v } })}
        />
        <ColorInput
          label="Up-reg Color"
          size="xs"
          value={theme.colors.up}
          onChange={(v) => updateTheme({ colors: { ...theme.colors, up: v } })}
        />
        <ColorInput
          label="Down-reg Color"
          size="xs"
          value={theme.colors.down}
          onChange={(v) => updateTheme({ colors: { ...theme.colors, down: v } })}
        />
        <ColorInput
          label="Neutral Color"
          size="xs"
          value={theme.colors.neutral}
          onChange={(v) => updateTheme({ colors: { ...theme.colors, neutral: v } })}
        />
        <ColorInput
          label="Grid Color"
          size="xs"
          value={theme.colors.grid}
          onChange={(v) => updateTheme({ colors: { ...theme.colors, grid: v } })}
        />
      </SimpleGrid>

      <Divider label="Layout" labelPosition="left" />

      <NumberInput
        label="Font Size"
        size="xs"
        min={8}
        max={18}
        value={theme.fontSize}
        onChange={(v) => updateTheme({ fontSize: Number(v) })}
      />

      <Box>
        <Text size="xs" fw={500} mb={4}>Chart Height</Text>
        <Slider
          min={160}
          max={480}
          step={20}
          value={theme.chartHeight}
          onChange={(v) => updateTheme({ chartHeight: v })}
          marks={[
            { value: 160, label: "160" },
            { value: 280, label: "280" },
            { value: 400, label: "400" },
          ]}
        />
      </Box>

      <SimpleGrid cols={2}>
        <Switch
          label="Show Legend"
          size="xs"
          checked={theme.showLegend}
          onChange={(e) => updateTheme({ showLegend: e.currentTarget.checked })}
        />
        <Switch
          label="Show Grid"
          size="xs"
          checked={theme.showGrid}
          onChange={(e) => updateTheme({ showGrid: e.currentTarget.checked })}
        />
      </SimpleGrid>

      <Divider label="Title Override" labelPosition="left" />

      <TextInput
        label="Custom Title"
        size="xs"
        placeholder="Leave empty for default"
        value={theme.title ?? ""}
        onChange={(e) => updateTheme({ title: e.target.value || undefined })}
      />
      <TextInput
        label="Subtitle"
        size="xs"
        placeholder="Leave empty for none"
        value={theme.subtitle ?? ""}
        onChange={(e) => updateTheme({ subtitle: e.target.value || undefined })}
      />
    </Stack>
  );
}

function ChartSpecificPanel({ hook }: { hook: UseChartCustomizerReturn }) {
  const { config, selectedChartType, updateChartStyle } = hook;
  const chartStyle = config.charts[selectedChartType] ?? {};

  const update = useCallback(
    (partial: Record<string, unknown>) => updateChartStyle(selectedChartType, partial),
    [selectedChartType, updateChartStyle]
  );

  switch (selectedChartType) {
    case "stage":
      return (
        <Stack gap="md">
          <Switch
            label="Show Mean Line"
            size="xs"
            checked={(chartStyle as Record<string, unknown>).showMeanLine !== false}
            onChange={(e) => update({ showMeanLine: e.currentTarget.checked })}
          />
          <NumberInput
            label="Bar Radius"
            size="xs"
            min={0}
            max={8}
            value={(chartStyle as Record<string, unknown>).barRadius as number ?? 0}
            onChange={(v) => update({ barRadius: Number(v) })}
          />
          <Switch
            label="Show Value Labels"
            size="xs"
            checked={(chartStyle as Record<string, unknown>).showValueLabel as boolean}
            onChange={(e) => update({ showValueLabel: e.currentTarget.checked })}
          />
        </Stack>
      );

    case "line":
      return (
        <Stack gap="md">
          <NumberInput
            label="Line Width"
            size="xs"
            min={1}
            max={6}
            step={0.5}
            value={(chartStyle as Record<string, unknown>).lineWidth as number ?? 2.5}
            onChange={(v) => update({ lineWidth: Number(v) })}
          />
          <NumberInput
            label="Marker Size"
            size="xs"
            min={4}
            max={16}
            value={(chartStyle as Record<string, unknown>).markerSize as number ?? 8}
            onChange={(v) => update({ markerSize: Number(v) })}
          />
          <Switch
            label="Show Replicates"
            size="xs"
            checked={(chartStyle as Record<string, unknown>).showReplicates as boolean}
            onChange={(e) => update({ showReplicates: e.currentTarget.checked })}
          />
          <Switch
            label="Show CI Band"
            size="xs"
            checked={(chartStyle as Record<string, unknown>).showCIBand as boolean}
            onChange={(e) => update({ showCIBand: e.currentTarget.checked })}
          />
        </Stack>
      );

    case "heatmap":
      return (
        <Stack gap="md">
          <Switch
            label="Show Cell Values"
            size="xs"
            checked={(chartStyle as Record<string, unknown>).showValues !== false}
            onChange={(e) => update({ showValues: e.currentTarget.checked })}
          />
          <Select
            label="Color Scale"
            size="xs"
            data={[
              { value: "blues", label: "Blues" },
              { value: "purples", label: "Purples" },
              { value: "greys", label: "Greys" },
              { value: "viridis", label: "Viridis" },
              { value: "RdBu", label: "Red-Blue Diverging" },
            ]}
            value={(chartStyle as Record<string, unknown>).colorScale as string ?? "blues"}
            onChange={(v) => v && update({ colorScale: v })}
          />
          <NumberInput
            label="Label Font Size"
            size="xs"
            min={7}
            max={14}
            value={(chartStyle as Record<string, unknown>).labelFontSize as number ?? 9}
            onChange={(v) => update({ labelFontSize: Number(v) })}
          />
        </Stack>
      );

    case "zscore":
      return (
        <Stack gap="md">
          <Box>
            <Text size="xs" fw={500} mb={4}>Zero Line Style</Text>
            <SegmentedControl
              size="xs"
              fullWidth
              data={[
                { label: "Dashed", value: "dashed" },
                { label: "Solid", value: "solid" },
              ]}
              value={(chartStyle as Record<string, unknown>).zeroLineStyle as string ?? "dashed"}
              onChange={(v) => update({ zeroLineStyle: v })}
            />
          </Box>
          <Switch
            label="Show 95% CI Band"
            size="xs"
            checked={(chartStyle as Record<string, unknown>).showCIBand !== false}
            onChange={(e) => update({ showCIBand: e.currentTarget.checked })}
          />
          <NumberInput
            label="CI Threshold"
            size="xs"
            min={1}
            max={3}
            step={0.1}
            value={((chartStyle as Record<string, unknown>).thresholdLines as number[])?.[0] ?? 1.96}
            onChange={(v) => update({ thresholdLines: [Number(v), -Number(v)] })}
          />
        </Stack>
      );

    case "fctraj":
      return (
        <Stack gap="md">
          <Switch
            label="Show Reference Lines"
            size="xs"
            checked={(chartStyle as Record<string, unknown>).showReferenceLines !== false}
            onChange={(e) => update({ showReferenceLines: e.currentTarget.checked })}
          />
          <Switch
            label="Show Value Labels"
            size="xs"
            checked={(chartStyle as Record<string, unknown>).showValueLabel !== false}
            onChange={(e) => update({ showValueLabel: e.currentTarget.checked })}
          />
          <NumberInput
            label="Bar Width (%)"
            size="xs"
            min={20}
            max={90}
            value={((chartStyle as Record<string, unknown>).barWidth as number ?? 0.6) * 100}
            onChange={(v) => update({ barWidth: Number(v) / 100 })}
          />
        </Stack>
      );

    case "fcbar":
      return (
        <Stack gap="md">
          <Switch
            label="Show Value Labels"
            size="xs"
            checked={(chartStyle as Record<string, unknown>).showValueLabel !== false}
            onChange={(e) => update({ showValueLabel: e.currentTarget.checked })}
          />
          <NumberInput
            label="Bar Width (%)"
            size="xs"
            min={20}
            max={90}
            value={((chartStyle as Record<string, unknown>).barWidth as number ?? 0.6) * 100}
            onChange={(v) => update({ barWidth: Number(v) / 100 })}
          />
        </Stack>
      );

    case "area":
      return (
        <Stack gap="md">
          <NumberInput
            label="Fill Opacity"
            size="xs"
            min={0.1}
            max={1}
            step={0.1}
            value={(chartStyle as Record<string, unknown>).opacity as number ?? 0.6}
            onChange={(v) => update({ opacity: Number(v) })}
          />
          <Switch
            label="Show Mean Line"
            size="xs"
            checked={(chartStyle as Record<string, unknown>).showMeanLine !== false}
            onChange={(e) => update({ showMeanLine: e.currentTarget.checked })}
          />
        </Stack>
      );

    case "violin":
      return (
        <Stack gap="md">
          <Switch
            label="Show Points"
            size="xs"
            checked={(chartStyle as Record<string, unknown>).showPoints !== false}
            onChange={(e) => update({ showPoints: e.currentTarget.checked })}
          />
          <NumberInput
            label="Opacity"
            size="xs"
            min={0.1}
            max={1}
            step={0.1}
            value={(chartStyle as Record<string, unknown>).opacity as number ?? 0.7}
            onChange={(v) => update({ opacity: Number(v) })}
          />
        </Stack>
      );

    case "radar":
      return (
        <Stack gap="md">
          <NumberInput
            label="Fill Opacity"
            size="xs"
            min={0.1}
            max={0.8}
            step={0.05}
            value={(chartStyle as Record<string, unknown>).fillOpacity as number ?? 0.25}
            onChange={(v) => update({ fillOpacity: Number(v) })}
          />
          <Box>
            <Text size="xs" fw={500} mb={4}>Normalization</Text>
            <SegmentedControl
              size="xs"
              fullWidth
              data={[
                { label: "Linear", value: "linear" },
                { label: "Log", value: "log" },
              ]}
              value={(chartStyle as Record<string, unknown>).normalizeMode as string ?? "linear"}
              onChange={(v) => update({ normalizeMode: v })}
            />
          </Box>
        </Stack>
      );

    case "dendrogram":
      return (
        <Stack gap="md">
          <NumberInput
            label="Point Size"
            size="xs"
            min={4}
            max={16}
            value={(chartStyle as Record<string, unknown>).pointSize as number ?? 8}
            onChange={(v) => update({ pointSize: Number(v) })}
          />
          <Switch
            label="Show Labels"
            size="xs"
            checked={(chartStyle as Record<string, unknown>).showLabels !== false}
            onChange={(e) => update({ showLabels: e.currentTarget.checked })}
          />
        </Stack>
      );

    default:
      return (
        <Text size="xs" c="dimmed">
          No options available for this chart type.
        </Text>
      );
  }
}

export default function ChartCustomizerDrawer({
  opened,
  onClose,
  hook,
}: ChartCustomizerDrawerProps) {
  const { scope, selectedChartType, setScope, setSelectedChartType, resetCurrent, resetAll } = hook;

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="xl"
      padding="md"
      title={
        <Group gap="xs">
          <IconX size={18} />
          <Title order={5}>Chart Style Customizer</Title>
        </Group>
      }
      withCloseButton={false}
    >
      <Stack gap="md" style={{ height: "calc(100vh - 80px)", display: "flex", flexDirection: "column" }}>
        {/* Subtitle */}
        <Text size="xs" c="dimmed">
          Adjust visual settings without changing expression data. Changes apply immediately.
        </Text>

        <Divider />

        {/* Scope Selector */}
        <SegmentedControl
          size="xs"
          fullWidth
          data={SCOPE_OPTIONS}
          value={scope}
          onChange={(v) => setScope(v as ScopeLevel)}
        />

        {/* Chart Type Selector — only when scope !== theme */}
        {scope !== "theme" && (
          <Select
            label="Chart Type"
            size="xs"
            data={CHART_TYPE_OPTIONS}
            value={selectedChartType}
            onChange={(v) => v && setSelectedChartType(v as ChartType)}
            searchable={false}
          />
        )}

        <Divider />

        {/* Style Options */}
        <Box style={{ flex: 1, overflowY: "auto" }}>
          {scope === "theme" ? (
            <ThemePanel hook={hook} />
          ) : (
            <Stack gap="md">
              <Badge variant="light" color="violet" size="sm" mb="xs">
                {CHART_TYPE_LABELS[selectedChartType] ?? selectedChartType}
              </Badge>
              <ChartSpecificPanel hook={hook} />
            </Stack>
          )}
        </Box>

        <Divider />

        {/* Action Buttons */}
        <Group justify="space-between">
          <Group gap="xs">
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              onClick={resetCurrent}
            >
              Reset Current
            </Button>
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              onClick={resetAll}
            >
              Reset All
            </Button>
          </Group>
          <Button variant="filled" size="xs" onClick={onClose}>
            Apply &amp; Close
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
