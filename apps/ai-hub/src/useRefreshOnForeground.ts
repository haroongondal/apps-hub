import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

// The hub's service records a newly asking app while the screen is in the background, so lists that read it reload when the owner comes back.
export function useRefreshOnForeground(refresh: () => unknown): void {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') latest.current();
    });
    return () => sub.remove();
  }, []);
}
