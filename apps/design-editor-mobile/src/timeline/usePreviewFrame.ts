import DesignMedia from 'design-media';
import { useEffect, useMemo, useRef, useState } from 'react';

import { singleFlight } from './latest';

export function usePreviewFrame(uri: string | undefined, timeS: number): string | undefined {
  const [frame, setFrame] = useState<string>();
  const current = useRef(uri);
  current.current = uri;

  const ask = useMemo(() => singleFlight(
    (a: { uri: string; timeS: number }) => DesignMedia.previewFrame(a.uri, a.timeS, 480),
    (f, a) => { if (a.uri === current.current) setFrame(f); },
  ), []);

  useEffect(() => { setFrame(undefined); }, [uri]);

  useEffect(() => {
    if (!uri) return;
    const timer = setTimeout(() => ask({ uri, timeS }), 120);
    return () => clearTimeout(timer);
  }, [uri, timeS, ask]);

  return frame;
}
