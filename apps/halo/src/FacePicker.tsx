import React, { useEffect, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Text, radius, space, useTheme } from '@apps-hub/ui';
import HaloEngine, { type FaceInfo, type FaceOptions, type Theme } from 'halo-engine';

const SETTLE_MS = 300;

/** A rendered image URI for `key`; it waits for typing to settle, keeps the last picture while the next one draws, and stays empty if drawing fails. */
function useRendered(load: () => Promise<string>, key: string): string | null {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      load()
        .then((u) => current && setUri(u))
        .catch(() => undefined);
    }, SETTLE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // `key` stands for everything `load` reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return uri;
}

function Picture({ uri, width, height, label }: { uri: string | null; width: number | '100%'; height?: number; label: string }) {
  const { c } = useTheme();
  return (
    <View style={{ width, height, aspectRatio: height ? undefined : 0.5, borderRadius: radius.control, overflow: 'hidden', backgroundColor: c.raised, borderWidth: 1, borderColor: c.line }}>
      {uri && <Image source={{ uri }} accessibilityLabel={label} resizeMode="cover" style={{ width: '100%', height: '100%' }} />}
    </View>
  );
}

/** The theme as the always-on screen shows it: face, photo and dim. `photoVersion` changes when the photo file is replaced (the theme JSON stays the same then). */
export function ThemePicture({ theme, width, photoVersion = 0 }: { theme: Theme; width: number; photoVersion?: number }) {
  const uri = useRendered(() => HaloEngine.renderFacePreview(theme.id, 240, 480), `${photoVersion}${JSON.stringify(theme)}`);
  return <Picture uri={uri} width={width} height={width * 2} label={`${theme.name} preview`} />;
}

const GRID_GAP = space.md;

function FaceCell({ face, options, palette, selected, onPress }: { face: FaceInfo; options: FaceOptions; palette: string[]; selected: boolean; onPress: () => void }) {
  const { c } = useTheme();
  const uri = useRendered(() => HaloEngine.renderFaceThumb(face.id, options, palette, 240, 480), `${face.id}${JSON.stringify(options)}${palette.join()}`);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={selected ? `${face.name}, selected` : face.name}
      style={{ width: '31%', gap: space.xs }}
    >
      <View style={{ borderRadius: radius.control + 2, borderWidth: 2, borderColor: selected ? c.accent : 'transparent', padding: 2 }}>
        <Picture uri={uri} width="100%" label={`${face.name} face`} />
      </View>
      <Text variant="meta" align="center" style={{ color: selected ? c.text : c.muted }}>
        {face.name}
      </Text>
    </Pressable>
  );
}

export function FacePicker({ faces, value, options, palette, onChange }: { faces: readonly FaceInfo[]; value: string; options: FaceOptions; palette: string[]; onChange: (id: string) => void }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Face" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP, padding: space.md }}>
      {faces.map((f) => (
        <FaceCell key={f.id} face={f} options={options} palette={palette} selected={f.id === value} onPress={() => onChange(f.id)} />
      ))}
    </View>
  );
}
