import Ionicons from '@expo/vector-icons/Ionicons';
import { Group, Row, useTheme } from '@apps-hub/ui';

import type { PageFilter } from './session-data';

const FILTERS: { key: PageFilter; label: string; hint: string }[] = [
  { key: 'original', label: 'Original', hint: 'The photo as you took it' },
  { key: 'auto', label: 'Magic', hint: 'Evens out the light and lifts colour' },
  { key: 'gray', label: 'Gray', hint: 'Clean grayscale, good for books' },
  { key: 'bw', label: 'Black and white', hint: 'Crisp text, small files' },
];

export function FilterPicker({ value, onChange }: { value: PageFilter; onChange(f: PageFilter): void }) {
  const { c } = useTheme();
  return (
    <Group title="Filter">
      {FILTERS.map((f) => (
        <Row
          key={f.key}
          title={f.label}
          subtitle={f.hint}
          accessibilityLabel={`${f.label}. ${f.hint}${value === f.key ? '. Selected' : ''}`}
          trailing={value === f.key ? <Ionicons name="checkmark" size={22} color={c.accent} /> : undefined}
          onPress={() => onChange(f.key)}
        />
      ))}
    </Group>
  );
}
