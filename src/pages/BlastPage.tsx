import { Alert, Anchor, Button, Card, Group, Stack, Text, Title } from '@mantine/core';

const BLAST_BASE = import.meta.env.VITE_BLAST_BASE || '/blast';

export default function BlastPage() {
  return (
    <Stack gap="md">
      <Title order={2}>BLAST</Title>
      <Text c="dimmed">
        Advanced BLAST portal for GRCg6a. Supports blastn, blastp, blastx, tblastn, tblastx.
      </Text>

      <Alert color="blue" title="Advanced mode">
        SequenceServer provides the full advanced BLAST UI, database tree selection,
        presets, result pages, and downloads.
      </Alert>

      <Card withBorder radius="md" p="md">
        <Stack gap="md">
          <Group>
            <Button
              component="a"
              href={BLAST_BASE}
              target="_blank"
              rel="noreferrer"
            >
              Open BLAST
            </Button>

            <Anchor
              href={`${BLAST_BASE}/searchdata.json`}
              target="_blank"
              rel="noreferrer"
            >
              View database JSON
            </Anchor>
          </Group>

          <Text size="sm" c="dimmed">
            In production, SequenceServer should be reverse-proxied to /blast
            on the same domain as this app.
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}