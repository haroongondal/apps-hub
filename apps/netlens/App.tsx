import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Phase 1 placeholder — the full Scanner/Diagnostics UI arrives in Phase 4.
 * This screen only proves the Expo bootstrap + workspace module resolution.
 */
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>NetLens</Text>
      <Text style={styles.subtitle}>
        Phase 1: native networking engine bootstrap (see docs/netlens)
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b1020',
  },
  title: { color: '#7dd3fc', fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#94a3b8', fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
});
