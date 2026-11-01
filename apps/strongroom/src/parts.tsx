import React, { useState } from 'react';
import { Platform, View } from 'react-native';
import { Button, Notice, Text, fonts, radius, space, touch, useTheme } from '@apps-hub/ui';
import { SecretInput } from 'strongroom-vault';
import { MISMATCH, keyboardNotice } from './forms.ts';

// Android 13 has no accessibility-sensitive flag on the window, so a shown secret hides itself from accessibility services.
export const HIDE_FROM_ACCESSIBILITY = Platform.OS === 'android' && Platform.Version < 34 ? ({ importantForAccessibility: 'no-hide-descendants' } as const) : {};

interface SecretFieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  value: string;
  onChangeText: (text: string) => void;
  onSubmitEditing?: () => void;
  shown?: boolean;
  mono?: boolean;
  keyboardType?: 'number-pad';
  multiline?: boolean;
  minHeight?: number;
  placeholder?: string;
}

// Passwords, card details, recovery keys and notes: @apps-hub/ui's Field rebuilt around a native input that autofill services can't see, with no keyboard suggestions or learning.
export function SecretField({ label, hint, error, value, onChangeText, onSubmitEditing, shown = false, mono, keyboardType, multiline = false, minHeight = touch, placeholder }: SecretFieldProps) {
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  return (
    <View style={{ gap: space.xs + 2 }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <SecretInput
        label={label}
        value={value}
        mostRecentEventCount={eventCount}
        onChangeValue={({ nativeEvent }) => {
          setEventCount(nativeEvent.eventCount);
          onChangeText(nativeEvent.text);
        }}
        onSubmit={() => onSubmitEditing?.()}
        onFocusChange={({ nativeEvent }) => setFocused(nativeEvent.focused)}
        onContentHeight={({ nativeEvent }) => setContentHeight(nativeEvent.height)}
        shown={shown}
        numeric={keyboardType === 'number-pad'}
        multiline={multiline}
        fontFamily={mono ? fonts.mono : fonts.regular}
        fontSize={16}
        textInset={space.md + 2}
        textColor={c.text}
        placeholder={placeholder}
        placeholderColor={c.faint}
        selectionColor={c.accent}
        style={{
          height: Math.max(minHeight, contentHeight),
          borderRadius: radius.control,
          borderWidth: focused ? 2 : 1,
          borderColor: error ? c.danger : focused ? c.accent : c.line,
          backgroundColor: c.surface,
        }}
        {...(shown ? HIDE_FROM_ACCESSIBILITY : {})}
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

export function NewPasswordFields(p: { password: string; confirm: string; onPassword: (v: string) => void; onConfirm: (v: string) => void; error: string | null; label?: string }) {
  const notice = keyboardNotice(p.password);
  return (
    <>
      <SecretField
        label={p.label ?? 'Master password'}
        hint="At least 12 characters. There are no other rules."
        value={p.password}
        onChangeText={p.onPassword}
        error={p.error === MISMATCH ? null : p.error}
      />
      <SecretField label="Type it again" value={p.confirm} onChangeText={p.onConfirm} error={p.error === MISMATCH ? p.error : null} />
      {notice && <Notice tone="warn">{notice}</Notice>}
    </>
  );
}

export const BackButton = ({ onPress }: { onPress: () => void }) => <Button label="Back" variant="ghost" size="sm" onPress={onPress} />;

export function RecoveryKeyCard({ value }: { value: string }) {
  const { c } = useTheme();
  const groups = value.split('-');
  return (
    <View style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: radius.group, padding: space.lg, gap: space.sm }} {...HIDE_FROM_ACCESSIBILITY}>
      {[groups.slice(0, 4), groups.slice(4)].map((line, i) => (
        <Text key={i} variant="data" style={{ fontSize: 20, lineHeight: 28 }}>
          {line.join('-')}
        </Text>
      ))}
    </View>
  );
}
