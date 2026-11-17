import React from 'react';
import { Switch, View } from 'react-native';
import { Button, Row, Text, space, useTheme } from '@apps-hub/ui';
import { stepValue } from './step.ts';

export interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** How the value reads on screen; plain number by default. */
  show?: (v: number) => string;
  onChange: (v: number) => void;
}

export function Stepper({ label, value, min, max, step, show = String, onChange }: StepperProps) {
  const name = label.toLowerCase();
  return (
    <Row
      title={label}
      trailing={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Button label="−" variant="secondary" size="sm" disabled={value <= min} accessibilityHint={`Lower ${name}`} onPress={() => onChange(stepValue(value, -1, min, max, step))} />
          <Text variant="data" align="center" style={{ minWidth: 40 }} accessibilityLabel={`${label} ${show(value)}`}>
            {show(value)}
          </Text>
          <Button label="+" variant="secondary" size="sm" disabled={value >= max} accessibilityHint={`Raise ${name}`} onPress={() => onChange(stepValue(value, 1, min, max, step))} />
        </View>
      }
    />
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const { c } = useTheme();
  return <Switch value={value} onValueChange={onChange} accessibilityLabel={label} trackColor={{ false: c.line, true: c.accent }} thumbColor={value ? c.surface : c.muted} />;
}

export function SwitchRow({ title, subtitle, value, onChange }: { title: string; subtitle?: string; value: boolean; onChange: (v: boolean) => void }) {
  return <Row title={title} subtitle={subtitle} trailing={<Toggle label={title} value={value} onChange={onChange} />} />;
}

export const BackButton = ({ onPress }: { onPress: () => void }) => <Button label="Back" variant="ghost" size="sm" onPress={onPress} />;
