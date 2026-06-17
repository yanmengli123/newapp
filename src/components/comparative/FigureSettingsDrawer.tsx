import { useEffect, useMemo, useState } from "react";
import {
  Alert,
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
import { IconCopy, IconDownload, IconRefresh, IconSettings } from "@tabler/icons-react";
import {
  FIGURE_PRESETS,
  type FigureSettings,
  type StaticFigureItem,
} from "../../lib/comparativeApi";

interface FigureSettingsDrawerProps {
  opened: boolean;
  onClose: () => void;
  figure: StaticFigureItem;
  settings: FigureSettings;
  blocks: Record<string, string>[];
  rendering: boolean;
  error: string;
  onApply: (settings: FigureSettings) => void;
  onReset: () => void;
  onDownload: (settings: FigureSettings) => void;
  onCopyProvenance: (settings: FigureSettings) => void;
}

function mergeSettings(base: FigureSettings, patch: Partial<FigureSettings>): FigureSettings {
  return {
    ...base,
    ...patch,
    colorScheme: {
      ...base.colorScheme,
      ...(patch.colorScheme || {}),
    },
  };
}

function numeric(value: string | number, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

export default function FigureSettingsDrawer({
  opened,
  onClose,
  figure,
  settings,
  blocks,
  rendering,
  error,
  onApply,
  onReset,
  onDownload,
  onCopyProvenance,
}: FigureSettingsDrawerProps) {
  const [draft, setDraft] = useState<FigureSettings>(settings);
  const [activePreset, setActivePreset] = useState<string>("publication");

  useEffect(() => {
    if (opened) setDraft(settings);
  }, [opened, settings]);

  const blockOptions = useMemo(
    () => blocks
      .map((block) => {
        const id = block.block_id;
        if (!id) return null;
        const chr = block.chr_1 ? ` chr${block.chr_1}` : "";
        const anchors = block.anchor_count ? ` ${block.anchor_count} anchors` : "";
        return { value: id, label: `${id}${chr}${anchors}` };
      })
      .filter(Boolean) as { value: string; label: string }[],
    [blocks],
  );

  const update = (patch: Partial<FigureSettings>) => setDraft((current) => mergeSettings(current, patch));
  const updateColor = (key: keyof FigureSettings["colorScheme"], value: string) => {
    update({ colorScheme: { ...draft.colorScheme, [key]: value } });
  };

  const applyPreset = (presetName: string) => {
    const preset = FIGURE_PRESETS.find((item) => item.name === presetName);
    if (!preset) return;
    setActivePreset(presetName);
    setDraft((current) => mergeSettings(current, preset.settings));
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="lg"
      padding="md"
      title={
        <Group gap="xs">
          <IconSettings size={18} />
          <Title order={5}>{figure.title}</Title>
        </Group>
      }
    >
      <Stack gap="md">
        {error && <Alert color="red">{error}</Alert>}

        <SegmentedControl
          size="xs"
          fullWidth
          value={activePreset}
          onChange={applyPreset}
          data={FIGURE_PRESETS.map((preset) => ({ value: preset.name, label: preset.label }))}
        />

        <Divider label="Canvas" labelPosition="left" />

        <SimpleGrid cols={3}>
          <NumberInput
            label="Width"
            size="xs"
            min={800}
            max={4000}
            step={100}
            value={draft.width}
            onChange={(value) => update({ width: numeric(value, draft.width) })}
          />
          <NumberInput
            label="Height"
            size="xs"
            min={600}
            max={3000}
            step={100}
            value={draft.height}
            onChange={(value) => update({ height: numeric(value, draft.height) })}
          />
          <NumberInput
            label="DPI"
            size="xs"
            min={72}
            max={600}
            step={25}
            value={draft.dpi}
            onChange={(value) => update({ dpi: numeric(value, draft.dpi) })}
          />
        </SimpleGrid>

        <Divider label="Colors" labelPosition="left" />

        <SimpleGrid cols={2}>
          <ColorInput label="Forward" size="xs" value={draft.colorScheme.forward} onChange={(value) => updateColor("forward", value)} />
          <ColorInput label="Reverse" size="xs" value={draft.colorScheme.reverse} onChange={(value) => updateColor("reverse", value)} />
          <ColorInput label="Links" size="xs" value={draft.colorScheme.lowConfidence} onChange={(value) => updateColor("lowConfidence", value)} />
          <ColorInput label="Grid" size="xs" value={draft.colorScheme.grid} onChange={(value) => updateColor("grid", value)} />
          <ColorInput label="Background" size="xs" value={draft.colorScheme.background} onChange={(value) => updateColor("background", value)} />
          <ColorInput label="Text" size="xs" value={draft.colorScheme.text} onChange={(value) => updateColor("text", value)} />
        </SimpleGrid>

        <Divider label="Labels" labelPosition="left" />

        <SimpleGrid cols={2}>
          <Switch
            label="Labels"
            size="xs"
            checked={draft.showLabels}
            onChange={(event) => update({ showLabels: event.currentTarget.checked })}
          />
          <Switch
            label="Legend"
            size="xs"
            checked={draft.showLegend}
            onChange={(event) => update({ showLegend: event.currentTarget.checked })}
          />
          <Switch
            label="Title"
            size="xs"
            checked={draft.showTitle}
            onChange={(event) => update({ showTitle: event.currentTarget.checked })}
          />
          <Select
            label="Density"
            size="xs"
            value={draft.labelDensity}
            data={[
              { value: "primary_only", label: "Primary" },
              { value: "all", label: "All" },
              { value: "none", label: "None" },
            ]}
            onChange={(value) => value && update({ labelDensity: value as FigureSettings["labelDensity"] })}
          />
        </SimpleGrid>

        <SimpleGrid cols={2}>
          <TextInput
            label="Title override"
            size="xs"
            value={draft.title || ""}
            onChange={(event) => update({ title: event.currentTarget.value || undefined })}
          />
          <TextInput
            label="Subtitle override"
            size="xs"
            value={draft.subtitle || ""}
            onChange={(event) => update({ subtitle: event.currentTarget.value || undefined })}
          />
        </SimpleGrid>

        <Divider label="Marks" labelPosition="left" />

        <SimpleGrid cols={2}>
          <NumberInput
            label="Stroke"
            size="xs"
            min={0.5}
            max={8}
            step={0.25}
            value={draft.strokeWidth}
            onChange={(value) => update({ strokeWidth: numeric(value, draft.strokeWidth) })}
          />
          <NumberInput
            label="Point"
            size="xs"
            min={0.5}
            max={12}
            step={0.25}
            value={draft.pointSize}
            onChange={(value) => update({ pointSize: numeric(value, draft.pointSize) })}
          />
        </SimpleGrid>

        <div>
          <Text size="xs" fw={500} mb={4}>Opacity</Text>
          <Slider
            min={0.1}
            max={1}
            step={0.05}
            value={draft.opacity}
            onChange={(value) => update({ opacity: value })}
          />
        </div>

        {figure.id === "micro-synteny" && (
          <>
            <Divider label="Micro-synteny" labelPosition="left" />
            <Select
              label="Block"
              size="xs"
              searchable
              data={blockOptions}
              value={draft.selectedBlockId || null}
              onChange={(value) => update({ selectedBlockId: value || null })}
            />
            <SimpleGrid cols={2}>
              <Switch
                label="Gene arrows"
                size="xs"
                checked={draft.showGeneArrows}
                onChange={(event) => update({ showGeneArrows: event.currentTarget.checked })}
              />
              <Switch
                label="Anchor lines"
                size="xs"
                checked={draft.showAnchorLines}
                onChange={(event) => update({ showAnchorLines: event.currentTarget.checked })}
              />
            </SimpleGrid>
          </>
        )}

        <Divider />

        <Group justify="space-between" align="center">
          <Group gap="xs">
            <Button variant="subtle" color="gray" size="xs" leftSection={<IconRefresh size={14} />} onClick={onReset}>
              Reset
            </Button>
            <Button variant="subtle" size="xs" leftSection={<IconCopy size={14} />} onClick={() => onCopyProvenance(draft)}>
              Copy provenance
            </Button>
          </Group>
          <Group gap="xs">
            <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => onDownload(draft)} loading={rendering}>
              Export SVG
            </Button>
            <Button size="xs" onClick={() => onApply(draft)} loading={rendering}>
              Update preview
            </Button>
          </Group>
        </Group>
      </Stack>
    </Drawer>
  );
}
