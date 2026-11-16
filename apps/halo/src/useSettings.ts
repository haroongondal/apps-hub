import { useCallback, useEffect, useRef, useState } from 'react';
import HaloEngine, { type Settings } from 'halo-engine';

export type SettingsPatch = Partial<Pick<Settings, 'enabled' | 'pattern'>> & {
  params?: Partial<Settings['params']>;
  colors?: Partial<Settings['colors']>;
  edges?: Partial<Settings['edges']>;
};
export type UpdateSettings = (patch: SettingsPatch) => void;

const WRITE_DELAY_MS = 150;

/** The settings document: local state changes at once, the native write waits for a 150 ms pause. */
export function useSettings(): [Settings, UpdateSettings] {
  const [settings, setSettings] = useState(() => HaloEngine.getSettings());
  const latest = useRef(settings);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const write = useCallback(() => {
    timer.current = null;
    HaloEngine.setSettings(latest.current);
  }, []);

  // A write still waiting when the app closes is sent rather than lost.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        write();
      }
    },
    [write],
  );

  const update = useCallback<UpdateSettings>(
    (patch) => {
      const s = latest.current;
      const next: Settings = {
        ...s,
        ...patch,
        params: { ...s.params, ...patch.params },
        colors: { ...s.colors, ...patch.colors },
        edges: { ...s.edges, ...patch.edges },
      };
      latest.current = next;
      setSettings(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(write, WRITE_DELAY_MS);
    },
    [write],
  );

  return [settings, update];
}
