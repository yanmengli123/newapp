import { Paper, Stack, Text, Title } from "@mantine/core";

type PlaceholderPageProps = {
  title: string;
  description: string;
};

export default function PlaceholderPage({
  title,
  description,
}: PlaceholderPageProps) {
  return (
    <Paper withBorder radius="xl" p="xl">
      <Stack gap="sm">
        <Title order={2}>{title}</Title>
        <Text c="dimmed">{description}</Text>
      </Stack>
    </Paper>
  );
}
