import { Button, Group, Paper, Stack, Text, ThemeIcon, Title, rem } from '@mantine/core';
import { IconArrowRight, IconDna } from '@tabler/icons-react';
import { Link } from 'react-router-dom';

export default function HeroSection() {
  return (
    <Paper
      radius="xl"
      p={{ base: 'xl', sm: 'xl', md: rem(48) }}
      style={{
        background:
          'linear-gradient(135deg, rgba(6, 182, 212, 0.10) 0%, rgba(59, 130, 246, 0.08) 45%, rgba(16, 185, 129, 0.08) 100%)',
        border: '1px solid rgba(0,0,0,0.06)',
      }}
    >
      <Stack gap="lg" align="center">
        <ThemeIcon size={56} radius="xl" variant="light" color="cyan">
          <IconDna size={30} />
        </ThemeIcon>

        <Stack gap="sm" align="center">
          <Title order={1} ta="center" maw={900}>
            GRCg6a Gene Browser
          </Title>
          <Text ta="center" c="dimmed" size="lg" maw={760}>
            Search genes, transcripts and chromosome regions on NC_ primary chromosomes
          </Text>
        </Stack>

        <Group>
          <Button
            size="md"
            rightSection={<IconArrowRight size={16} />}
            component={Link}
            to="/query"
          >
            Search Genes
          </Button>
          <Button size="md" variant="outline" component={Link} to="/jbrowse">
            Genome Browser
          </Button>
        </Group>

        <Group gap="xl" mt="sm">
          <Stack gap={0} align="center">
            <Text fw={700} size="xl">
              35
            </Text>
            <Text size="sm" c="dimmed">
              Chromosomes
            </Text>
          </Stack>

          <Stack gap={0} align="center">
            <Text fw={700} size="xl">
              23,640
            </Text>
            <Text size="sm" c="dimmed">
              Genes
            </Text>
          </Stack>

          <Stack gap={0} align="center">
            <Text fw={700} size="xl">
              1B+
            </Text>
            <Text size="sm" c="dimmed">
              Base Pairs
            </Text>
          </Stack>

          <Stack gap={0} align="center">
            <Text fw={700} size="xl">
              6,212
            </Text>
            <Text size="sm" c="dimmed">
              KEGG Pathways
            </Text>
          </Stack>
        </Group>
      </Stack>
    </Paper>
  );
}
