import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Group, Header, Notice, Pill, Row, Screen, Segmented, Sheet, Text, space } from '@apps-hub/ui';
import HaloEngine, { type ColorSource, type FaceOptions, type Settings, type Theme } from 'halo-engine';
import { removeTheme } from './aodForm.ts';
import { FacePicker, ThemePicture } from './FacePicker.tsx';
import { PaletteEditor, SOURCES } from './ColoursScreen.tsx';
import { BackButton, Stepper, SwitchRow } from './Stepper.tsx';
import type { UpdateSettings } from './useSettings.ts';

const SIZES = [
  { key: 's', label: 'Small' },
  { key: 'm', label: 'Medium' },
  { key: 'l', label: 'Large' },
] as const satisfies ReadonlyArray<{ key: FaceOptions['size']; label: string }>;

const POSITIONS = [
  { key: 'top', label: 'Top' },
  { key: 'centre', label: 'Centre' },
  { key: 'bottom', label: 'Bottom' },
] as const satisfies ReadonlyArray<{ key: FaceOptions['position']; label: string }>;

const SOURCE_NOTE: Record<ColorSource, string> = {
  albumArt: 'Colours come from the cover of what is playing. With no cover, your colours below are used.',
  wallpaper: 'Colours come from your wallpaper. If it gives none, your colours below are used.',
  palette: 'The face uses your colours below.',
};

const percent = (v: number) => `${Math.round(v * 100)}%`;
const brightness = (v: number) => `${Number((v * 100).toFixed(1))}%`;

export default function ThemeScreen({ settings, update, themeId, onBack }: { settings: Settings; update: UpdateSettings; themeId: string; onBack: () => void }) {
  const theme = settings.themes.find((t) => t.id === themeId);
  const faces = useMemo(() => HaloEngine.listFaces(), []);
  const patterns = useMemo(() => HaloEngine.listPatterns(), []);
  const [name, setName] = useState(theme?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosingPattern, setChoosingPattern] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [photoVersion, setPhotoVersion] = useState(0);

  if (!theme) return null;
  const set = (patch: Partial<Theme>) => update({ themes: settings.themes.map((t) => (t.id === themeId ? { ...t, ...patch } : t)) });
  const setOptions = (patch: Partial<FaceOptions>) => set({ faceOptions: { ...theme.faceOptions, ...patch } });
  const o = theme.faceOptions;
  const face = faces.find((f) => f.id === theme.face);
  const last = settings.themes.length <= 1;
  const pattern = patterns.find((p) => p.id === theme.edge.pattern);

  const editName = (text: string) => {
    setName(text);
    if (text.trim() !== '') set({ name: text.trim() });
  };
  const pickPhoto = async () => {
    setBusy(true);
    setError(null);
    try {
      if (await HaloEngine.pickBackground(themeId)) {
        set({ photo: true });
        setPhotoVersion((v) => v + 1);
      }
    } catch {
      setError('Halo could not use that photo. Pick a different one.');
    } finally {
      setBusy(false);
    }
  };
  const removePhoto = async () => {
    setBusy(true);
    setError(null);
    try {
      await HaloEngine.clearBackground(themeId);
      set({ photo: false });
    } catch {
      setError('Halo could not remove the photo. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const doDelete = async () => {
    const next = removeTheme(settings.themes, settings.aod, themeId);
    setConfirmDelete(false);
    if (!next) return;
    try {
      // The photo goes first, so no file is left behind for a theme that no longer exists.
      await HaloEngine.clearBackground(themeId);
    } catch {
      setError('Halo could not remove this theme. Try again.');
      return;
    }
    update({ themes: next.themes, aod: next.aod });
    onBack();
  };

  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title="Theme" subtitle="Changes save as you make them." />
      <View style={{ alignItems: 'center', gap: space.md }}>
        <ThemePicture theme={theme} width={140} photoVersion={photoVersion} />
        <Button label="Preview" variant="secondary" block onPress={() => HaloEngine.previewAod(themeId)} accessibilityHint="Opens the always-on screen with this theme" />
      </View>
      <Group>
        <Row title={<Field label="Name" value={name} onChangeText={editName} maxLength={40} error={name.trim() === '' ? 'Give the theme a name.' : null} />} />
      </Group>
      <Group title="Face">
        <FacePicker faces={faces} value={theme.face} options={o} palette={theme.colours.palette} onChange={(id) => set({ face: id })} />
      </Group>
      <Group title="Face options">
        <View style={{ padding: space.md, gap: space.md }}>
          <Text variant="caption" tone="muted">
            Size
          </Text>
          <Segmented options={SIZES} value={o.size} onChange={(size) => setOptions({ size })} accessibilityLabel="Face size" />
          <Text variant="caption" tone="muted">
            Position
          </Text>
          <Segmented options={POSITIONS} value={o.position} onChange={(position) => setOptions({ position })} accessibilityLabel="Face position" />
        </View>
        <SwitchRow title="24-hour clock" value={o.h24} onChange={(h24) => setOptions({ h24 })} />
        <SwitchRow title="Date" value={o.date} onChange={(date) => setOptions({ date })} />
        <SwitchRow title="Battery" value={o.battery} onChange={(battery) => setOptions({ battery })} />
        <SwitchRow title="Next alarm" value={o.alarm} onChange={(alarm) => setOptions({ alarm })} />
        {face?.supportsSeconds && <SwitchRow title="Seconds" subtitle="Uses a little more battery." value={o.seconds} onChange={(seconds) => setOptions({ seconds })} />}
      </Group>
      <Group title="Colours from" footer={SOURCE_NOTE[theme.colours.source]}>
        <View style={{ padding: space.md }}>
          <Segmented options={SOURCES} value={theme.colours.source} onChange={(source) => set({ colours: { ...theme.colours, source } })} accessibilityLabel="Where the colours come from" />
        </View>
      </Group>
      <PaletteEditor palette={theme.colours.palette} onChange={(palette) => set({ colours: { ...theme.colours, palette } })} />
      <Group title="Background photo" footer="The photo is copied into Halo. Removing it deletes that copy.">
        <Row
          title={theme.photo ? 'Photo set' : 'No photo'}
          trailing={
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label={theme.photo ? 'Change' : 'Pick'} variant="secondary" size="sm" busy={busy} onPress={pickPhoto} />
              {theme.photo && <Button label="Remove" variant="ghost" size="sm" busy={busy} onPress={removePhoto} />}
            </View>
          }
        />
        {theme.photo && <Stepper label="Dim the photo" value={theme.dim} min={0} max={0.9} step={0.1} show={percent} onChange={(dim) => set({ dim })} />}
      </Group>
      {error && <Notice tone="danger">{error}</Notice>}
      <Group title="Edge lights" footer="Lights around the screen edges while this theme shows.">
        <SwitchRow title="Edge lights" value={theme.edge.on} onChange={(on) => set({ edge: { ...theme.edge, on } })} />
        {theme.edge.on && <Row title="Pattern" subtitle={pattern?.name ?? theme.edge.pattern} onPress={() => setChoosingPattern(true)} />}
      </Group>
      <Group title="Brightness" footer="How bright the always-on screen is. Low saves battery.">
        <Stepper label="Brightness" value={theme.brightness} min={0.005} max={0.3} step={0.01} show={brightness} onChange={(b) => set({ brightness: b })} />
      </Group>
      <Group footer={last ? 'Halo keeps at least one theme.' : undefined}>
        <Row title={<Button label="Delete theme" variant="danger" block disabled={last} onPress={() => setConfirmDelete(true)} />} />
      </Group>
      <Sheet visible={choosingPattern} onClose={() => setChoosingPattern(false)} title="Edge pattern">
        <Group>
          {patterns.map((p) => (
            <Row
              key={p.id}
              title={p.name}
              trailing={p.id === theme.edge.pattern ? <Pill label="Selected" tone="accent" /> : undefined}
              accessibilityLabel={p.id === theme.edge.pattern ? `${p.name}, selected` : p.name}
              onPress={() => {
                set({ edge: { ...theme.edge, pattern: p.id } });
                setChoosingPattern(false);
              }}
            />
          ))}
        </Group>
      </Sheet>
      <Sheet visible={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${theme.name}?`} doneLabel="Delete" onDone={doDelete}>
        <Text tone="muted">The theme, its photo and any time slots that use it are removed. This cannot be undone.</Text>
      </Sheet>
    </Screen>
  );
}
