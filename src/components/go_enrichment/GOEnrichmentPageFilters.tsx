/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef } from "react";
import { Checkbox, Group, Text } from "@mantine/core";

interface OntologyFilter {
  P: boolean;
  C: boolean;
  F: boolean;
}

interface Props {
  filter: OntologyFilter;
  onChange: (f: OntologyFilter) => void;
}

function FilterCheckbox({ label, color, checked, onChange }: {
  label: string;
  color: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  function handleChange(e: any) {
    e.stopPropagation();
    onChange(e.currentTarget.checked);
  }

  return (
    <Checkbox
      ref={ref as any}
      label={label}
      color={color}
      checked={checked}
      onChange={handleChange}
      size="sm"
    />
  );
}

export function BarChartFilters({ filter, onChange }: Props) {
  return (
    <Group gap="xs">
      <FilterCheckbox label="BP" color="blue" checked={filter.P} onChange={(v) => onChange({ ...filter, P: v })} />
      <FilterCheckbox label="CC" color="orange" checked={filter.C} onChange={(v) => onChange({ ...filter, C: v })} />
      <FilterCheckbox label="MF" color="green" checked={filter.F} onChange={(v) => onChange({ ...filter, F: v })} />
    </Group>
  );
}

export function TableFilters({ filter, onChange }: Props) {
  return (
    <Group gap="xs">
      <Text size="sm" c="dimmed">Filter:</Text>
      <FilterCheckbox label="Biological Process" color="blue" checked={filter.P} onChange={(v) => onChange({ ...filter, P: v })} />
      <FilterCheckbox label="Cellular Component" color="orange" checked={filter.C} onChange={(v) => onChange({ ...filter, C: v })} />
      <FilterCheckbox label="Molecular Function" color="green" checked={filter.F} onChange={(v) => onChange({ ...filter, F: v })} />
    </Group>
  );
}