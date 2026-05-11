import { Card, Group, Badge, Text, Anchor, Stack, Tooltip } from "@mantine/core";
import { IconExternalLink } from "@tabler/icons-react";
import type { GOAnnotation } from "../../lib/geneApi";

const EVIDENCE_COLORS: Record<string, string> = {
  IEA: "gray",
  ISS: "yellow",
  ISO: "yellow",
  ISA: "yellow",
  ISM: "yellow",
  RCA: "pink",
  TAS: "green",
  NAS: "blue",
  ND: "gray",
  IEP: "violet",
  IGI: "cyan",
  IPI: "teal",
  IDA: "lime",
  IMP: "grape",
};

function getEvidenceColor(code: string): string {
  return EVIDENCE_COLORS[code] ?? "gray";
}

interface Props {
  item: GOAnnotation;
}

function getQualifierLabel(qualifier?: string): string {
  if (!qualifier) return "";
  const map: Record<string, string> = {
    "enables": "enables",
    "involved_in": "involved in",
    "located_in": "located in",
    "contributes_to": "contributes to",
    "colocalizes_with": "colocalizes with",
  };
  return map[qualifier] ?? qualifier;
}

export default function GOTermCard({ item }: Props) {
  const pubmedLink = item.pubmed_ids
    ? `https://pubmed.ncbi.nlm.nih.gov/${item.pubmed_ids.split(",")[0].trim()}`
    : null;

  return (
    <Card
      withBorder
      radius="md"
      padding="sm"
      style={{ borderLeftWidth: 3, borderLeftColor: "var(--mantine-color-blue-5)" }}
    >
      <Stack gap={6}>
        {/* GO ID + Name + Link */}
        <Group gap="xs" align="flex-start">
          <Badge variant="outline" color="blue" size="sm" style={{ fontFamily: "monospace" }}>
            {item.go_id}
          </Badge>
          <Text size="sm" fw={600} style={{ flex: 1 }}>
            {item.go_name}
          </Text>
          {item.official_link && (
            <Anchor
              href={item.official_link}
              target="_blank"
              rel="noopener noreferrer"
              size="xs"
              style={{ flexShrink: 0 }}
            >
              <Group gap={3}>
                <IconExternalLink size={11} />
                <span>AmiGO</span>
              </Group>
            </Anchor>
          )}
        </Group>

        {/* Evidence Code + Qualifier + Source */}
        <Group gap="xs">
          {item.evidence_code && (
            <Badge
              color={getEvidenceColor(item.evidence_code)}
              variant="light"
              size="xs"
              title="Evidence Code"
            >
              {item.evidence_code}
            </Badge>
          )}
          {item.qualifier && (
            <Tooltip label="GO term relationship">
              <Badge color="teal" variant="light" size="xs">
                {getQualifierLabel(item.qualifier)}
              </Badge>
            </Tooltip>
          )}
          {item.source && (
            <Badge color="gray" variant="outline" size="xs" title="Data Source">
              {item.source}
            </Badge>
          )}
          {item.assigned_by && (
            <Tooltip label="Annotation source">
              <Badge color="orange" variant="outline" size="xs">
                {item.assigned_by}
              </Badge>
            </Tooltip>
          )}
        </Group>

        {/* Reference/PubMed link */}
        {(item.reference || pubmedLink) && (
          <Group gap="xs">
            {item.reference && (
              <Text size="xs" c="dimmed">
                Ref: {item.reference}
              </Text>
            )}
            {pubmedLink && (
              <Anchor href={pubmedLink} target="_blank" rel="noopener noreferrer" size="xs">
                <Group gap={2}>
                  <IconExternalLink size={10} />
                  <span>PubMed</span>
                </Group>
              </Anchor>
            )}
          </Group>
        )}

        {/* GO Definition */}
        {item.go_definition && (
          <Text size="xs" c="dimmed" style={{ lineHeight: 1.5 }}>
            {item.go_definition}
          </Text>
        )}
      </Stack>
    </Card>
  );
}
