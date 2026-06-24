import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Anchor, Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { IconDatabase, IconExternalLink, IconRefresh } from '@tabler/icons-react';
import { getBlastBase, getBlastUrl } from '../lib/blastConfig';

type BlastStatus = 'checking' | 'online' | 'offline';

export default function BlastPage() {
  const blastBase = useMemo(() => getBlastBase(), []);
  const searchDataUrl = useMemo(() => getBlastUrl('searchdata.json', blastBase), [blastBase]);
  const [status, setStatus] = useState<BlastStatus>('checking');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const checkStatus = useCallback(() => {
    setStatus('checking');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    fetch(getBlastUrl('', blastBase), {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(() => setStatus('online'))
      .catch(() => setStatus('offline'))
      .finally(() => {
        window.clearTimeout(timeout);
        setLastChecked(new Date());
      });
  }, [blastBase]);

  useEffect(() => {
    const timeout = window.setTimeout(checkStatus, 0);
    return () => window.clearTimeout(timeout);
  }, [checkStatus]);

  const statusColor = status === 'online' ? 'green' : status === 'offline' ? 'red' : 'yellow';
  const statusLabel = status === 'online' ? 'SequenceServer online' : status === 'offline' ? 'SequenceServer offline' : 'Checking SequenceServer';

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
          <Group justify="space-between" align="center">
            <Stack gap={2}>
              <Text fw={700}>SequenceServer endpoint</Text>
              <Anchor href={blastBase} target="_blank" rel="noreferrer" size="sm">
                {blastBase}
              </Anchor>
            </Stack>
            <Badge color={statusColor} variant="light">
              {statusLabel}
            </Badge>
          </Group>

          {status === 'offline' && (
            <Alert color="red" title="SequenceServer is not reachable">
              Start the WSL Docker service and SequenceServer container, then refresh this status.
            </Alert>
          )}

          <Group>
            <Button
              component="a"
              href={blastBase}
              target="_blank"
              rel="noreferrer"
              leftSection={<IconExternalLink size={16} />}
            >
              Open BLAST
            </Button>

            <Button
              component="a"
              variant="light"
              href={searchDataUrl}
              target="_blank"
              rel="noreferrer"
              leftSection={<IconDatabase size={16} />}
            >
              View database JSON
            </Button>

            <Button
              variant="subtle"
              onClick={checkStatus}
              loading={status === 'checking'}
              leftSection={<IconRefresh size={16} />}
            >
              Refresh status
            </Button>
          </Group>

          <Text size="sm" c="dimmed">
            Development uses SequenceServer on port 4567; production should reverse-proxy SequenceServer on a dedicated BLAST path or subdomain.
            {lastChecked ? ` Last checked ${lastChecked.toLocaleTimeString()}.` : ''}
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}
