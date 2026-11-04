import { Group, Row } from '@apps-hub/ui';
import { router } from 'expo-router';

// Development builds only (the Designs screen renders this inside a __DEV__ check).
export function LabRow() {
  return (
    <Group title="Developer">
      <Row title="Media lab" subtitle="Phone checks for development builds." onPress={() => router.push('/lab')} />
    </Group>
  );
}
