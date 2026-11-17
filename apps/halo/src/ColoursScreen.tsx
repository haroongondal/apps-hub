import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Group, Header, Row, Screen, Segmented, space, useTheme } from '@apps-hub/ui';
import type { ColorSource, Settings } from 'halo-engine';
import { BackButton } from './Stepper.tsx';
import type { UpdateSettings } from './useSettings.ts';

export const SOURCES = [
  { key: 'albumArt', label: 'Album art' },
  { key: 'wallpaper', label: 'Wallpaper' },
  { key: 'palette', label: 'My colours' },
] as const satisfies ReadonlyArray<{ key: ColorSource; label: string }>;

export const SOURCE_NOTE: Record<ColorSource, string> = {
  albumArt: 'Colours come from the cover of what is playing. With no cover, your colours below are used.',
  wallpaper: 'Colours come from your wallpaper. If it gives none, your colours below are used.',
  palette: 'The lights use your colours below.',
};

const MAX = 4;
const HEX = /^#?[0-9a-fA-F]{6}$/;
const hex = (text: string) => `#${text.replace('#', '').toUpperCase()}`;

/** Up to four colour fields; the palette keeps the last valid colour for each. */
export function PaletteEditor({ palette, onChange }: { palette: string[]; onChange: (next: string[]) => void }) {
  const { c } = useTheme();
  const [drafts, setDrafts] = useState(palette);

  const edit = (i: number, text: string) => {
    setDrafts(drafts.map((d, j) => (j === i ? text : d)));
    if (HEX.test(text)) onChange(palette.map((p, j) => (j === i ? hex(text) : p)));
  };
  const add = () => {
    setDrafts([...drafts, '#FFFFFF']);
    onChange([...palette, '#FFFFFF']);
  };
  const remove = (i: number) => {
    setDrafts(drafts.filter((_, j) => j !== i));
    onChange(palette.filter((_, j) => j !== i));
  };

  return (
    <Group title="Your colours" footer="Up to four. Type six hex digits, like #22D3EE.">
      {drafts.map((d, i) => (
        <Row
          key={i}
          // The swatch shows the person's own colour, so it is the one place a colour comes from data, not the theme.
          leading={<View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: palette[i], borderWidth: 1, borderColor: c.line }} />}
          title={
            <Field
              label={`Colour ${i + 1}`}
              value={d}
              onChangeText={(t) => edit(i, t)}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={7}
              mono
              error={HEX.test(d) ? null : 'Use six hex digits, like #22D3EE.'}
            />
          }
          trailing={<Button label="Remove" variant="ghost" size="sm" disabled={drafts.length <= 1} onPress={() => remove(i)} />}
        />
      ))}
      <Row title={<Button label="Add a colour" variant="secondary" block disabled={drafts.length >= MAX} onPress={add} />} />
    </Group>
  );
}

export default function ColoursScreen({ settings, update, onBack }: { settings: Settings; update: UpdateSettings; onBack: () => void }) {
  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title="Colours" subtitle="Changes show on the screen edges while you are here." />
      <Group title="Colours from" footer={SOURCE_NOTE[settings.colors.source]}>
        <View style={{ padding: space.md }}>
          <Segmented options={SOURCES} value={settings.colors.source} onChange={(source) => update({ colors: { source } })} accessibilityLabel="Where the colours come from" />
        </View>
      </Group>
      <PaletteEditor palette={settings.colors.palette} onChange={(palette) => update({ colors: { palette } })} />
    </Screen>
  );
}
