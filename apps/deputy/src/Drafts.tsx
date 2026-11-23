import React from 'react';
import { Group, RecordMenu, Row, editDeleteActions } from '@apps-hub/ui';
import type { Draft } from 'deputy-agent';
import { draftRow } from './share';

export function Drafts({ drafts, onOpen, onDelete }: { drafts: Draft[]; onOpen: (d: Draft) => void; onDelete: (d: Draft) => void }) {
  if (drafts.length === 0) return null;
  return (
    <Group title="Drafts" footer="Shared text and suggested tasks wait here until you open them and tap Start.">
      {drafts.map((d) => {
        const row = draftRow(d);
        return (
          <Row
            key={d.id}
            title={row.title}
            subtitle={row.subtitle}
            trailing={<RecordMenu title={row.title} actions={editDeleteActions({ onEdit: () => onOpen(d), onDelete: () => onDelete(d), noun: 'draft', name: row.title })} />}
            onPress={() => onOpen(d)}
            accessibilityHint="Opens this draft"
          />
        );
      })}
    </Group>
  );
}
