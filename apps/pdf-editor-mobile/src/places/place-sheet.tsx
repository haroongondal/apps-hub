import type { Item } from '@apps-hub/library-core';
import { Button, Field, Group, Notice, Segmented, Sheet } from '@apps-hub/ui';
import { useState } from 'react';
import { PlaceReminders, type ReminderTrigger } from 'place-reminders';

import { errorMessage } from '../library/use-library';
import { openLibrary } from '../library/open-library';

import { ensurePlacePermissions, explainMissing } from './permissions';
import { RADIUS_CHOICES, formatRadius } from './describe';
import { syncPlaceReminders } from './sync';

const TRIGGERS: { key: ReminderTrigger; label: string }[] = [
  { key: 'arrive', label: 'Arrive' },
  { key: 'leave', label: 'Leave' },
];
const RADII = RADIUS_CHOICES.map((m) => ({ key: String(m), label: formatRadius(m) }));

const number = (text: string) => (text.trim() === '' ? NaN : Number(text));

export function PlaceSheet({ item, onSaved, onClose }: { item: Item; onSaved: () => void; onClose: () => void }) {
  const [trigger, setTrigger] = useState<ReminderTrigger>('arrive');
  const [radius, setRadius] = useState(String(RADIUS_CHOICES[1]));
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [busy, setBusy] = useState<'locate' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const locate = async () => {
    setBusy('locate');
    setError(null);
    try {
      const verdict = await ensurePlacePermissions();
      if (verdict === 'need-precise') return explainMissing(verdict);
      const place = await PlaceReminders.currentPlace();
      setLat(place.lat.toFixed(6));
      setLng(place.lng.toFixed(6));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (busy) return;
    setBusy('save');
    setError(null);
    try {
      const verdict = await ensurePlacePermissions();
      if (verdict !== 'ready') return explainMissing(verdict);
      const lib = await openLibrary();
      await lib.addReminder({ itemId: item.id, lat: number(lat), lng: number(lng), radiusM: Number(radius), trigger });
      await syncPlaceReminders();
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet visible title="Remind me at a place" doneLabel="Save" onClose={onClose} onDone={save}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Group title="When">
        <Segmented options={TRIGGERS} value={trigger} onChange={setTrigger} accessibilityLabel="When to remind" />
      </Group>
      <Group title="How close" footer="Accuracy is tens of metres, so very small radii can be missed.">
        <Segmented options={RADII} value={radius} onChange={setRadius} accessibilityLabel="Radius" />
      </Group>
      <Group title="Place" footer="Use where you are now, or type the coordinates of the place.">
        <Button label="Use my current location" variant="secondary" busy={busy === 'locate'} onPress={() => void locate()} />
        <Field label="Latitude" value={lat} onChangeText={setLat} keyboardType="numbers-and-punctuation" mono />
        <Field label="Longitude" value={lng} onChangeText={setLng} keyboardType="numbers-and-punctuation" mono />
      </Group>
    </Sheet>
  );
}
