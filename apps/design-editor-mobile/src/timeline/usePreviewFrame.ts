import DesignMedia from 'design-media';
import { useEffect, useRef, useState } from 'react';

import { createLatest } from './latest';

export function usePreviewFrame(uri: string | undefined, timeS: number): string | undefined {
  const [frame, setFrame] = useState<string>();
  const latest = useRef(createLatest<string>()).current;

  useEffect(() => { setFrame(undefined); }, [uri]);

  useEffect(() => {
    if (!uri) return;
    const timer = setTimeout(() => {
      latest(DesignMedia.previewFrame(uri, timeS, 480)).then(f => { if (f) setFrame(f); }, () => undefined);
    }, 120);
    return () => clearTimeout(timer);
  }, [uri, timeS, latest]);

  return frame;
}
