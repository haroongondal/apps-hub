import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Group, Notice, Row, Segmented, space } from '@apps-hub/ui';
import { models, setModel, type JobKey, type ModelChoice, type ServiceKey } from 'ai-hub-core';
import { JOBS, SERVICE_LABEL, plainError, servicesFor } from './format.ts';

function JobRow({ job, label, saved, onSaved, onError }: { job: JobKey; label: string; saved: ModelChoice; onSaved: () => void; onError: (message: string) => void }) {
  const [service, setService] = useState<ServiceKey>(saved.service);
  const [model, setModelId] = useState(saved.model);
  const [busy, setBusy] = useState(false);
  const options = servicesFor(job);
  const dirty = service !== saved.service || model.trim() !== saved.model;

  useEffect(() => {
    setService(saved.service);
    setModelId(saved.model);
  }, [saved.service, saved.model]);

  const save = async () => {
    setBusy(true);
    try {
      await setModel(job, service, model);
      onSaved();
    } catch (e) {
      onError(plainError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row title={label}>
      {options.length > 1 && (
        <View style={{ alignSelf: 'flex-start' }}>
          <Segmented
            accessibilityLabel={`${label} service`}
            options={options.map((key) => ({ key, label: SERVICE_LABEL[key] }))}
            value={service}
            onChange={setService}
          />
        </View>
      )}
      <Field label={options.length > 1 ? 'Model id' : `Model id on ${SERVICE_LABEL[options[0]]}`} value={model} onChangeText={setModelId} autoCapitalize="none" autoCorrect={false} mono />
      {dirty && <Button label="Save" size="sm" onPress={save} busy={busy} disabled={model.trim().length === 0} accessibilityLabel={`Save ${label} model`} />}
    </Row>
  );
}

export function ModelsGroup() {
  const [choices, setChoices] = useState<Record<JobKey, ModelChoice> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setError(null);
    models().then(setChoices).catch((e) => setError(plainError(e)));
  };
  useEffect(refresh, []);

  return (
    <View style={{ gap: space.md }}>
      <Group title="Models">
        {choices && JOBS.map(({ key, label }) => <JobRow key={key} job={key} label={label} saved={choices[key]} onSaved={refresh} onError={setError} />)}
      </Group>
      {error && <Notice tone="danger">{error}</Notice>}
    </View>
  );
}
