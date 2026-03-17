import { Alert, Anchor, Button, Card, Group, Stack, Text, Title } from '@mantine/core';

const BLAST_URL = 'http://localhost:4567';

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
              href={BLAST_URL}
              target="_blank"
              rel="noreferrer"
            >
              打开 BLAST
            </Button>

            <Anchor
              href={`${BLAST_URL}/searchdata.json`}
              target="_blank"
              rel="noreferrer"
            >
              查看数据库 JSON
            </Anchor>
          </Group>

          <Text size="sm" c="dimmed">
            本地开发建议新窗口打开。后面如果你把 SequenceServer 反代到同源
            /blast-ui/，再改成 iframe 嵌入。
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}