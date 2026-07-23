import { Badge } from '@mantine/core';
import type { AssertionState, AssignmentRole, ReviewState } from '../../lib/geneFamilyApi';

type StatusKind = AssertionState | AssignmentRole | ReviewState | string;

const COLORS: Record<string, string> = {
  accepted: 'teal',
  candidate: 'orange',
  unresolved: 'red',
  rejected: 'red',
  withdrawn: 'gray',
  primary: 'blue',
  secondary: 'violet',
  supplementary: 'grape',
  not_required: 'gray',
  unreviewed: 'orange',
  in_review: 'yellow',
  approved: 'teal',
  needs_mapping: 'red',
  ambiguous: 'orange',
  unmapped: 'red',
  external_curated: 'blue',
  multi_source_supported: 'teal',
  model_supported: 'cyan',
  domain_supported: 'grape',
  conflicting: 'red',
  weak_model: 'orange',
};

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function CatalogStatusBadge({ value, size = 'sm' }: { value: StatusKind; size?: 'xs' | 'sm' | 'md' }) {
  return (
    <Badge color={COLORS[value] ?? 'gray'} variant="light" size={size}>
      {label(value)}
    </Badge>
  );
}
