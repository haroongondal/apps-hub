import React, { Children, Fragment, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps as RNTextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from './theme.tsx';
import { fonts, radius, space, touch, type, type Palette, type Tone, type TypeVariant } from './tokens.ts';

type TextTone = 'text' | 'muted' | 'faint' | 'accent' | 'onAccent' | 'ok' | 'warn' | 'danger';

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  tone?: TextTone;
  align?: TextStyle['textAlign'];
}

export function Text({ variant = 'body', tone = 'text', align, style, ...rest }: TextProps) {
  const { c } = useTheme();
  const t = type[variant];
  return (
    <RNText
      {...rest}
      style={[
        { fontFamily: fonts[t.font], fontSize: t.size, lineHeight: t.lineHeight, letterSpacing: t.letterSpacing, color: c[tone], textAlign: align },
        variant === 'readout' || variant === 'data' ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
    />
  );
}

export function toneColors(c: Palette, tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case 'accent':
      return { fg: c.accent, bg: c.accentSoft };
    case 'ok':
      return { fg: c.ok, bg: c.okSoft };
    case 'warn':
      return { fg: c.warn, bg: c.warnSoft };
    case 'danger':
      return { fg: c.danger, bg: c.dangerSoft };
    default:
      return { fg: c.muted, bg: c.raised };
  }
}

export interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function Screen({ children, scroll, refreshing, onRefresh, style }: ScreenProps) {
  const { c, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const bar = <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />;
  if (scroll) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        {bar}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh && (
              <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[c.accent]} tintColor={c.accent} progressBackgroundColor={c.surface} />
            )
          }
          contentContainerStyle={[{ paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxxl, paddingHorizontal: space.lg, gap: space.xl }, style]}
        >
          {children}
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={[{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }, style]}>
      {bar}
      {children}
    </View>
  );
}

export function Header({ title, subtitle, trailing }: { title: string; subtitle?: ReactNode; trailing?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.md, paddingTop: space.sm }}>
      <View style={{ flex: 1, gap: space.xs }}>
        <Text variant="display" accessibilityRole="header">
          {title}
        </Text>
        {typeof subtitle === 'string' ? <Text tone="muted">{subtitle}</Text> : subtitle}
      </View>
      {trailing}
    </View>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  busy?: boolean;
  disabled?: boolean;
  block?: boolean;
  accessibilityHint?: string;
}

export function Button({ label, onPress, variant = 'primary', size = 'md', busy, disabled, block, accessibilityHint }: ButtonProps) {
  const { c } = useTheme();
  const off = disabled || busy;
  const palettes: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: c.accent, fg: c.onAccent, border: c.accent },
    secondary: { bg: c.surface, fg: c.text, border: c.line },
    ghost: { bg: 'transparent', fg: c.accent, border: 'transparent' },
    danger: { bg: 'transparent', fg: c.danger, border: c.line },
  };
  const p = palettes[variant];
  const height = size === 'sm' ? 36 : touch;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      hitSlop={(touch - height) / 2}
      style={({ pressed }) => ({
        minHeight: height,
        paddingHorizontal: size === 'sm' ? space.md : space.xl,
        borderRadius: radius.control,
        borderWidth: 1,
        borderColor: p.border,
        backgroundColor: p.bg,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: space.sm,
        alignSelf: block ? 'stretch' : 'flex-start',
        opacity: off ? 0.5 : pressed ? 0.8 : 1,
        transform: [{ scale: pressed && !off ? 0.98 : 1 }],
      })}
    >
      {busy && <ActivityIndicator size="small" color={p.fg} />}
      <Text variant={size === 'sm' ? 'meta' : 'bodyStrong'} style={{ color: p.fg, fontFamily: fonts.semibold }}>
        {label}
      </Text>
    </Pressable>
  );
}

export interface FieldProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string | null;
  mono?: boolean;
}

export function Field({ label, hint, error, mono, style, ...input }: FieldProps) {
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space.xs + 2 }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.faint}
        selectionColor={c.accent}
        {...input}
        onFocus={(e) => {
          setFocused(true);
          input.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          input.onBlur?.(e);
        }}
        style={[
          {
            minHeight: touch,
            paddingHorizontal: space.md + 2,
            borderRadius: radius.control,
            borderWidth: focused ? 2 : 1,
            borderColor: error ? c.danger : focused ? c.accent : c.line,
            backgroundColor: c.surface,
            color: c.text,
            fontFamily: mono ? fonts.mono : fonts.regular,
            fontSize: 16,
          },
          style,
        ]}
      />
      {error ? (
        <Text variant="meta" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="meta" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function Group({ title, footer, trailing, children }: { title?: string; footer?: ReactNode; trailing?: ReactNode; children?: ReactNode }) {
  const { c } = useTheme();
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={{ gap: space.sm }}>
      {(title || trailing) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xs, minHeight: 24 }}>
          {title ? (
            <Text variant="caption" tone="muted" accessibilityRole="header">
              {title}
            </Text>
          ) : (
            <View />
          )}
          {trailing}
        </View>
      )}
      {items.length > 0 && (
        <View style={{ backgroundColor: c.surface, borderRadius: radius.group, borderWidth: 1, borderColor: c.line, overflow: 'hidden' }}>
          {items.map((child, i) => (
            <Fragment key={child.key ?? i}>
              {i > 0 && <View style={{ height: 1, backgroundColor: c.line, marginLeft: space.lg }} />}
              {child}
            </Fragment>
          ))}
        </View>
      )}
      {typeof footer === 'string' ? (
        <Text variant="meta" tone="muted" style={{ paddingHorizontal: space.xs }}>
          {footer}
        </Text>
      ) : (
        footer
      )}
    </View>
  );
}

export interface RowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  mono?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  children?: ReactNode;
}

export function Row({ title, subtitle, mono, leading, trailing, onPress, accessibilityLabel, accessibilityHint, children }: RowProps) {
  const { c } = useTheme();
  const body = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        {leading}
        <View style={{ flex: 1, gap: 2 }}>
          {typeof title === 'string' ? <Text variant="bodyStrong">{title}</Text> : title}
          {typeof subtitle === 'string' ? (
            <Text variant={mono ? 'data' : 'meta'} tone="muted">
              {subtitle}
            </Text>
          ) : (
            subtitle
          )}
        </View>
        {trailing}
      </View>
      {children}
    </>
  );
  const pad: ViewStyle = { paddingHorizontal: space.lg, paddingVertical: space.md + 2, minHeight: touch + 8, justifyContent: 'center', gap: space.md };
  if (!onPress) return <View style={pad}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      android_ripple={{ color: c.raised }}
      style={({ pressed }) => [pad, pressed && { backgroundColor: c.raised }]}
    >
      {body}
    </Pressable>
  );
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const { c } = useTheme();
  const { fg, bg } = toneColors(c, tone);
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: space.sm + 2, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text variant="caption" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}

export function Dot({ tone = 'ok', size = 10 }: { tone?: Tone; size?: number }) {
  const { c } = useTheme();
  const color = tone === 'neutral' ? c.faint : toneColors(c, tone).fg;
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export interface SegmentedProps<K extends string> {
  options: ReadonlyArray<{ key: K; label: string; a11yLabel?: string }>;
  value: K;
  onChange: (key: K) => void;
  accessibilityLabel: string;
}

export function Segmented<K extends string>({ options, value, onChange, accessibilityLabel }: SegmentedProps<K>) {
  const { c } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: 'row', backgroundColor: c.raised, borderRadius: radius.control + 2, padding: 3, gap: 3 }}
    >
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.a11yLabel ?? o.label}
            style={{
              flex: 1,
              minHeight: 40,
              borderRadius: radius.control - 1,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: on ? c.surface : 'transparent',
              borderWidth: on ? 1 : 0,
              borderColor: c.line,
            }}
          >
            <Text variant="meta" style={{ fontFamily: on ? fonts.semibold : fonts.regular, color: on ? c.text : c.muted }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface TabBarProps<K extends string> {
  tabs: ReadonlyArray<{ key: K; label: string }>;
  value: K;
  onChange: (key: K) => void;
}

export function TabBar<K extends string>({ tabs, value, onChange }: TabBarProps<K>) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.line, paddingBottom: insets.bottom }}>
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.label}
            style={{ flex: 1, minHeight: touch + 8, alignItems: 'center', justifyContent: 'center' }}
          >
            <View style={{ position: 'absolute', top: -1, height: 3, width: 40, borderRadius: 2, backgroundColor: on ? c.accent : 'transparent' }} />
            <Text variant="bodyStrong" style={{ color: on ? c.text : c.muted, fontFamily: on ? fonts.semibold : fonts.regular }}>
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Readout({ value, unit, label, tone }: { value: string; unit?: string; label: string; tone?: Tone }) {
  const { c } = useTheme();
  const color = tone && tone !== 'neutral' ? toneColors(c, tone).fg : c.text;
  return (
    <View accessible accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}`} style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.xs }}>
        <Text variant="readout" style={{ color }}>
          {value}
        </Text>
        {unit && (
          <Text variant="data" tone="muted">
            {unit}
          </Text>
        )}
      </View>
      <Text variant="meta" tone="muted">
        {label}
      </Text>
    </View>
  );
}

export function Progress({ value }: { value: number | null }) {
  const { c } = useTheme();
  const sweep = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (value !== null) return;
    const loop = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 1200, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [value, sweep]);
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="progressbar"
      accessibilityValue={value === null ? undefined : { min: 0, max: 100, now: Math.round(value * 100) }}
      style={{ height: 4, borderRadius: 2, backgroundColor: c.raised, overflow: 'hidden' }}
    >
      {value === null ? (
        <Animated.View
          style={{
            width: '35%',
            height: '100%',
            backgroundColor: c.accent,
            transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-0.35 * width, width] }) }],
          }}
        />
      ) : (
        <View style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height: '100%', backgroundColor: c.accent }} />
      )}
    </View>
  );
}

export function Notice({ tone = 'neutral', title, children, action }: { tone?: Tone; title?: string; children?: ReactNode; action?: ReactNode }) {
  const { c } = useTheme();
  const { fg, bg } = toneColors(c, tone);
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', backgroundColor: bg, borderRadius: radius.control, overflow: 'hidden' }}
    >
      <View style={{ width: 4, backgroundColor: fg }} />
      <View style={{ flex: 1, padding: space.md, gap: space.xs }}>
        {title && (
          <Text variant="bodyStrong" style={{ color: tone === 'neutral' ? c.text : fg }}>
            {title}
          </Text>
        )}
        {typeof children === 'string' ? <Text variant="meta">{children}</Text> : children}
        {action && <View style={{ paddingTop: space.xs }}>{action}</View>}
      </View>
    </View>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={{ paddingVertical: space.xxxl, paddingHorizontal: space.xl, alignItems: 'center', gap: space.sm }}>
      <Text variant="heading" align="center">
        {title}
      </Text>
      {body && (
        <Text tone="muted" align="center" style={{ maxWidth: 320 }}>
          {body}
        </Text>
      )}
      {action && <View style={{ paddingTop: space.md }}>{action}</View>}
    </View>
  );
}

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  doneLabel?: string;
  onDone?: () => void;
  children: ReactNode;
}

// Backdrop and Back always call onClose (discard); only the header action calls onDone (commit).
export function Sheet({ visible, onClose, title, doneLabel = 'Done', onDone, children }: SheetProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} accessibilityLabel="Close" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#00000099' }} />
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: c.bg,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            borderWidth: 1,
            borderColor: c.line,
            maxHeight: '88%',
            paddingBottom: insets.bottom,
          }}
        >
          <View style={{ alignItems: 'center', paddingTop: space.sm }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.line }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.md, gap: space.md }}>
            <Text variant="title" style={{ flex: 1 }} accessibilityRole="header">
              {title}
            </Text>
            <Button label={doneLabel} variant="ghost" size="sm" onPress={onDone ?? onClose} />
          </View>
          <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
