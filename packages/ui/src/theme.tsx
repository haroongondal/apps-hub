import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { fonts, palette, type BrandKey, type Palette, type Scheme } from './tokens.ts';

export interface Theme {
  brand: BrandKey;
  scheme: Scheme;
  c: Palette;
}

const ThemeContext = createContext<Theme | null>(null);

const fontFiles = {
  [fonts.regular]: require('../fonts/AtkinsonHyperlegibleNext_400Regular.ttf'),
  [fonts.semibold]: require('../fonts/AtkinsonHyperlegibleNext_600SemiBold.ttf'),
  [fonts.heavy]: require('../fonts/AtkinsonHyperlegibleNext_800ExtraBold.ttf'),
  [fonts.mono]: require('../fonts/AtkinsonHyperlegibleMono_400Regular.ttf'),
  [fonts.monoSemibold]: require('../fonts/AtkinsonHyperlegibleMono_600SemiBold.ttf'),
};

export function ThemeProvider({ brand, scheme, children }: { brand: BrandKey; scheme?: Scheme; children: ReactNode }) {
  const system = useColorScheme();
  const resolved: Scheme = scheme ?? (system === 'light' ? 'light' : 'dark');
  const theme = useMemo(() => ({ brand, scheme: resolved, c: palette(brand, resolved) }), [brand, resolved]);
  const [loaded, error] = useFonts(fontFiles);
  // Fonts ship in the bundle, so this resolves within a frame; on failure fall back to system fonts.
  if (!loaded && !error) return null;
  return (
    <SafeAreaProvider>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </SafeAreaProvider>
  );
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme() must be used inside <ThemeProvider>');
  return theme;
}
