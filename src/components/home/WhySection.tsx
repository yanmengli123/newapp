import { Button, Group, Paper, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconFlask } from '@tabler/icons-react';
import { Link } from 'react-router-dom';

export default function WhySection() {
  return (
    <Paper withBorder radius="xl" p="xl">
      <Group justify="space-between" align="flex-start">
        <Stack gap="xs">
          <Group gap="sm">
            <ThemeIcon variant="light" radius="xl" color="teal">
              <IconFlask size={18} />
            </ThemeIcon>
            <Title order={3}>Why this structure works</Title>
          </Group>

          <Text c="dimmed" maw={760}>
            This homepage keeps the UI thin and extensible. You can now add
            route-based modules one by one without rewriting the shell.
          </Text>
        </Stack>

        <Button variant="light" component={Link} to="/data">
          View datasets
        </Button>
      </Group>
    </Paper>
  );
}