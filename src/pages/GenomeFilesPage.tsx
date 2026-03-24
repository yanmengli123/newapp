import { useState, useEffect } from 'react';
import {
  Title,
  Text,
  Card,
  Group,
  Stack,
  Badge,
  Table,
  ScrollArea,
  Alert,
  Loader,
  Center,
  ActionIcon,
  Tooltip,
} from '@mantine/core';
import { IconRefresh, IconFile, IconFileZip, IconCheck, IconX } from '@tabler/icons-react';
import { getGenomeFiles, scanGenomeFiles, type GenomeFilesResponse } from '../lib/genomeApi';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function FileStatusBadge({ exists }: { exists: boolean }) {
  return (
    <Badge color={exists ? 'green' : 'red'} leftSection={exists ? <IconCheck size={10} /> : <IconX size={10} />}>
      {exists ? 'Found' : 'Missing'}
    </Badge>
  );
}

export default function GenomeFilesPage() {
  const [data, setData] = useState<GenomeFilesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFiles = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getGenomeFiles();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  };

  const handleScan = async () => {
    try {
      setScanning(true);
      setError(null);
      const result = await scanGenomeFiles();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan files');
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  if (loading) {
    return (
      <Center py="xl">
        <Loader size="lg" />
      </Center>
    );
  }

  const fileTypeLabels: Record<string, string> = {
    genomic: 'Genome Sequence',
    gff: 'Gene Annotation (GFF)',
    cds: 'CDS Sequences',
    protein: 'Protein Sequences',
    rna: 'RNA Sequences',
  };

  const files = data?.files ? Object.values(data.files) : [];

  return (
    <Stack gap="xl">
      <Group justify="space-between">
        <div>
          <Title order={2} mb="xs">
            Genome Files
          </Title>
          <Text c="dimmed">
            View available genome files for GRCg6a analysis
          </Text>
        </div>
        <Tooltip label="Rescan files">
          <ActionIcon
            variant="light"
            size="lg"
            loading={scanning}
            onClick={handleScan}
          >
            <IconRefresh size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {error && (
        <Alert color="red" title="Error">
          {error}
        </Alert>
      )}

      {/* Summary Cards */}
      <Group gap="md">
        <Card withBorder shadow="sm" padding="md">
          <Text size="sm" c="dimmed">Total Files</Text>
          <Text size="xl" fw={700}>{files.length}</Text>
        </Card>
        <Card withBorder shadow="sm" padding="md">
          <Text size="sm" c="dimmed">Found</Text>
          <Text size="xl" fw={700} c="green">{files.filter(f => f.exists).length}</Text>
        </Card>
        <Card withBorder shadow="sm" padding="md">
          <Text size="sm" c="dimmed">Missing</Text>
          <Text size="xl" fw={700} c="red">{data?.missing_types?.length || 0}</Text>
        </Card>
        <Card withBorder shadow="sm" padding="md">
          <Text size="sm" c="dimmed">Total Size</Text>
          <Text size="xl" fw={700}>{formatBytes(data?.total_size || 0)}</Text>
        </Card>
      </Group>

      {/* Missing Types */}
      {data?.missing_types && data.missing_types.length > 0 && (
        <Alert color="yellow" title="Missing File Types">
          The following file types are missing: {data.missing_types.join(', ')}
        </Alert>
      )}

      {/* Files Table */}
      <Card withBorder shadow="sm" padding="md">
        <ScrollArea>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Status</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Filename</Table.Th>
                <Table.Th>Size</Table.Th>
                <Table.Th>Compressed</Table.Th>
                <Table.Th>Path</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {files.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed" ta="center">No files found</Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                files.map((file) => (
                  <Table.Tr key={file.file_type}>
                    <Table.Td>
                      <FileStatusBadge exists={file.exists} />
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        {file.file_type === 'genomic' && <IconFile size={16} />}
                        {file.file_type === 'gff' && <IconFile size={16} />}
                        {file.file_type === 'cds' && <IconFileZip size={16} />}
                        {file.file_type === 'protein' && <IconFileZip size={16} />}
                        {file.file_type === 'rna' && <IconFileZip size={16} />}
                        <Text size="sm">{fileTypeLabels[file.file_type] || file.file_type}</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">{file.filename}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{file.exists ? formatBytes(file.size_bytes) : '-'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={file.is_compressed ? 'blue' : 'gray'} size="sm">
                        {file.is_compressed ? 'GZ' : 'No'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed" ff="monospace" lineClamp={1} maw={300}>
                        {file.path}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Card>
    </Stack>
  );
}
