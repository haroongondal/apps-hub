import { Button, Empty, Group, Header, Row, Screen } from '@apps-hub/ui';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { IconButton } from '../../src/library/icon-button';
import type { Cv } from '../../src/cv/model';
import { listCvs } from '../../src/cv/store';
import { TEMPLATES } from '../../src/cv/templates';

export default function CvTab() {
  const [cvs, setCvs] = useState<Cv[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      void listCvs()
        .then(setCvs)
        .catch((err) => console.warn('CVs did not load', err));
    }, []),
  );

  const make = () => router.push('/cv/new');

  return (
    <Screen scroll>
      <Header
        title="CV"
        subtitle="Written by AI, laid out in one of three templates"
        trailing={<IconButton icon="add" label="New CV" onPress={make} />}
      />
      {cvs?.length ? (
        <Group title="Your CVs">
          {cvs.map((cv) => (
            <Row
              key={cv.id}
              title={cv.name}
              subtitle={`${TEMPLATES[cv.template].label} · edited ${new Date(cv.updated).toLocaleDateString()}`}
              onPress={() => router.push({ pathname: '/cv/[id]', params: { id: cv.id } })}
            />
          ))}
        </Group>
      ) : cvs ? (
        <Empty
          title="No CVs yet"
          body="Describe your experience and Nexus writes a CV in one of three templates. You can then change any section with AI."
          action={<Button label="Make a CV" onPress={make} />}
        />
      ) : null}
    </Screen>
  );
}
