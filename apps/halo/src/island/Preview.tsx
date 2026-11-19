import React, { useState } from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import { Group, Segmented, space } from '@apps-hub/ui';
import { SWATCHES, clockLabel, earPlan, pillHex, resolveClock, type NotchSettings } from './settings';

// Same numbers as the native pill: closed width max(hole + 16, 32% of the screen), height hole + 4,
// expanded card 11 in from each side, 84 high (160 for music), content inset 20.
const SCREEN = 300;
const HOLE = 22;
const SCALE = { compact: 0.85, regular: 1, large: 1.15 } as const;
const RADIUS = { pill: 44, rounded: 28, squared: 6 } as const;
const SAMPLES = [
  { key: 'music', label: 'Music' },
  { key: 'call', label: 'Call' },
  { key: 'timer', label: 'Timer' },
  { key: 'event', label: 'Event' },
  { key: 'ears', label: 'Clock' },
] as const;
type Sample = (typeof SAMPLES)[number]['key'];

const WHITE = '#FFFFFF';
const SOFT = 'rgba(255,255,255,0.65)';
const BUTTON = 'rgba(255,255,255,0.16)';

function Round({ size, colour, children }: { size: number; colour: string; children: React.ReactNode }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colour, alignItems: 'center', justifyContent: 'center' }}>{children}</View>;
}

function Triangle({ dir }: { dir: 'left' | 'right' }) {
  const side = dir === 'right' ? 'borderLeftWidth' : 'borderRightWidth';
  const colour = dir === 'right' ? 'borderLeftColor' : 'borderRightColor';
  return <View style={{ width: 0, height: 0, borderTopWidth: 6, borderBottomWidth: 6, borderTopColor: 'transparent', borderBottomColor: 'transparent', [side]: 10, [colour]: WHITE } as ViewStyle} />;
}

// A lightning bolt from two slanted bars and a joining bar.
const Bolt = ({ colour }: { colour: string }) => (
  <View style={{ width: 28, height: 28 }}>
    <View style={{ position: 'absolute', left: 12, top: 2, width: 6, height: 13, backgroundColor: colour, transform: [{ skewX: '-25deg' }] }} />
    <View style={{ position: 'absolute', left: 8, top: 12, width: 13, height: 4, backgroundColor: colour }} />
    <View style={{ position: 'absolute', left: 10, top: 13, width: 6, height: 13, backgroundColor: colour, transform: [{ skewX: '-25deg' }] }} />
  </View>
);

const Bars = () => (
  <View style={{ flexDirection: 'row', gap: 3 }}>
    <View style={{ width: 4, height: 12, backgroundColor: WHITE }} />
    <View style={{ width: 4, height: 12, backgroundColor: WHITE }} />
  </View>
);

// The pill is always dark, whatever the app theme, so its text is fixed white.
export function Preview({ value }: { value: NotchSettings }) {
  const [sample, setSample] = useState<Sample>(() => (value.widgets.includes('media') ? 'music' : value.widgets.includes('timer') ? 'timer' : 'ears'));
  const background = pillHex(value.pill, value.accent);
  const accent = SWATCHES[value.accent];
  const now = new Date();
  const time = clockLabel(now.getHours(), now.getMinutes(), resolveClock(value.clock));
  const ears = earPlan(value.widgets);

  const closedHeight = HOLE + 4;
  const closedWidth = Math.max(HOLE + 16, 0.32 * SCREEN) * SCALE[value.size];
  const height = sample === 'music' ? 160 : 84;
  const cardRadius = Math.min(RADIUS[value.corners], height / 2);

  const earsRow = (
    <View style={{ flexDirection: 'row', alignItems: 'center', height: HOLE + 12 }}>
      <View style={{ flex: 1, paddingLeft: 20 }}>{ears.time && <Text style={{ color: WHITE, fontSize: 15, fontWeight: '600' }}>{time}</Text>}</View>
      <View style={{ width: HOLE + 16 }} />
      <View style={{ flex: 1, alignItems: 'flex-end', paddingRight: 20 }}>
        {ears.battery && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: accent }} />
            <Text style={{ color: WHITE, fontSize: 13 }}>82%</Text>
          </View>
        )}
      </View>
    </View>
  );

  const sideRow = (left: React.ReactNode, right: React.ReactNode) => (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 }}>
      <View>{left}</View>
      <View style={{ flexDirection: 'row', gap: 12 }}>{right}</View>
    </View>
  );

  let content: React.ReactNode;
  if (sample === 'music') {
    content = (
      <>
        {earsRow}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, marginTop: 16 }}>
          <View style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: accent }} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: WHITE, fontSize: 15, fontWeight: '700' }}>Song title</Text>
            <Text numberOfLines={1} style={{ color: SOFT, fontSize: 13 }}>Artist name</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 8 }}>
          <Round size={34} colour={BUTTON}><Triangle dir="left" /></Round>
          <Round size={34} colour={BUTTON}><Bars /></Round>
          <Round size={34} colour={BUTTON}><Triangle dir="right" /></Round>
        </View>
      </>
    );
  } else if (sample === 'call') {
    content = sideRow(
      <>
        <Text style={{ color: WHITE, fontSize: 15, fontWeight: '700' }}>Sam Carter</Text>
        <Text style={{ color: SOFT, fontSize: 13 }}>00:42</Text>
      </>,
      <>
        <Round size={44} colour={SWATCHES.rose}><View style={{ width: 16, height: 4, borderRadius: 2, backgroundColor: '#000000' }} /></Round>
        <Round size={44} colour={SWATCHES.mint}><View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: '#000000' }} /></Round>
      </>,
    );
  } else if (sample === 'timer') {
    content = sideRow(
      <Text style={{ color: WHITE, fontSize: 32, fontWeight: '600' }}>04:12</Text>,
      <>
        <Round size={44} colour={BUTTON}><Bars /></Round>
        <Round size={44} colour={accent}><View style={{ width: 14, height: 14, backgroundColor: '#000000' }} /></Round>
      </>,
    );
  } else if (sample === 'event') {
    content = (
      <>
        {earsRow}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, marginTop: 8 }}>
          <Bolt colour={accent} />
          <View>
            <Text style={{ color: WHITE, fontSize: 17, fontWeight: '700' }}>Charging</Text>
            <Text style={{ color: SOFT, fontSize: 13 }}>82%</Text>
          </View>
        </View>
      </>
    );
  } else {
    content = (
      <>
        {earsRow}
        {ears.dateLine && <Text style={{ color: SOFT, fontSize: 12, textAlign: 'center' }}>Thu 19 Nov</Text>}
      </>
    );
  }

  return (
    <Group title="Preview" footer="The battery number, song, caller, timer and event are samples.">
      <View accessibilityRole="image" accessibilityLabel="Preview of the pill" style={{ alignItems: 'center', gap: 12, paddingVertical: 12 }}>
        <View style={{ width: closedWidth, height: closedHeight, borderRadius: Math.min(RADIUS[value.corners], closedHeight / 2), backgroundColor: background, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent }} />
        </View>
        <View style={{ width: SCREEN - 22, height, borderRadius: cardRadius, backgroundColor: background, overflow: 'hidden' }}>{content}</View>
      </View>
      <View style={{ padding: space.md, paddingTop: 0 }}>
        <Segmented options={SAMPLES} value={sample} onChange={setSample} accessibilityLabel="Sample to preview" />
      </View>
    </Group>
  );
}
