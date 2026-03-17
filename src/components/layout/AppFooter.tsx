import { Group, Text } from '@mantine/core';

export default function AppFooter() {
  return (
    <Group justify="space-between">
      <Text size="sm" c="dimmed">
        © 2026 BioViz
      </Text>
      <Text size="sm" c="dimmed">
        React + Vite + TypeScript + Mantine
      </Text>
    </Group>
  );
}