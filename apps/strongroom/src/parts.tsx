import React from 'react';
import { Platform, View } from 'react-native';
import { Button, Field, Text, radius, space, useTheme, type FieldProps } from '@apps-hub/ui';

// Password and recovery-key inputs: hidden while typed, no autocorrect, no autofill, no keyboard suggestions.
export function SecretField({ shown, ...props }: FieldProps & { shown?: boolean }) {
  return (
    <Field
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="off"
      importantForAutofill="no"
      secureTextEntry={!shown}
      keyboardType={shown ? 'visible-password' : 'default'}
      {...props}
    />
  );
}

export function NewPasswordFields(p: { password: string; confirm: string; onPassword: (v: string) => void; onConfirm: (v: string) => void; error: string | null; label?: string }) {
  return (
    <>
      <SecretField label={p.label ?? 'Master password'} hint="At least 12 characters. There are no other rules." value={p.password} onChangeText={p.onPassword} />
      <SecretField label="Type it again" value={p.confirm} onChangeText={p.onConfirm} error={p.error} />
    </>
  );
}

export const BackButton = ({ onPress }: { onPress: () => void }) => <Button label="Back" variant="ghost" size="sm" onPress={onPress} />;

// Android 13 has no accessibility-sensitive flag on the window, so a shown secret hides itself from accessibility services.
export const HIDE_FROM_ACCESSIBILITY = Platform.OS === 'android' && Platform.Version < 34 ? ({ importantForAccessibility: 'no-hide-descendants' } as const) : {};

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
