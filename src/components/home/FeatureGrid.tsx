import { Box, Card, Group, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconChartBar, IconDatabase, IconDna } from '@tabler/icons-react';
import type { ReactNode } from 'react';

type FeatureCardProps = {
  icon: ReactNode;
  title: string;
  description: string;
};

function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <Card withBorder radius="xl" p="xl" h="100%">
      <Stack gap="md">
        <ThemeIcon size={48} radius="xl" variant="light" color="cyan">
          {icon}
        </ThemeIcon>
        <Title order={3}>{title}</Title>
        <Text c="dimmed">{description}</Text>
      </Stack>
    </Card>
  );
}

export default function FeatureGrid() {
  return (
    <Box>
      <Group justify="space-between" mb="lg">
        <div>
          <Text c="dimmed" size="sm" fw={600}>
            CORE MODULES
          </Text>
          <Title order={2}>Start simple, extend later</Title>
        </div>
      </Group>

      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
        <FeatureCard
          icon={<IconDna size={24} />}
          title="Genome Browser"
          description="Reserve this page for future JBrowse 2 integration, including tracks, annotations, variants, and alignment views."
        />

        <FeatureCard
          icon={<IconChartBar size={24} />}
          title="Interactive Visualizations"
          description="Prepare a clean entry for future Recharts or Plotly modules such as PCA, volcano plots, heatmaps, and expression summaries."
        />

        <FeatureCard
          icon={<IconDatabase size={24} />}
          title="Dataset Hub"
          description="Provide a single place for uploaded files, metadata records, experiment groups, and searchable biological datasets."
        />
      </SimpleGrid>
    </Box>
  );
}