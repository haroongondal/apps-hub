import DesignMedia, { type NativeJobStatus } from 'design-media';
import { useEffect, useState } from 'react';

// One shared subscription: every screen that shows the queue reads the same list.
let jobs: NativeJobStatus[] = [];
const listeners = new Set<(j: NativeJobStatus[]) => void>();
let started = false;

function set(next: NativeJobStatus[]) {
  jobs = next;
  listeners.forEach(l => l(jobs));
}

function start() {
  if (started) return;
  started = true;
  DesignMedia.addListener('onQueue', e => set(e.jobs));
  DesignMedia.addListener('onJobProgress', e => set(jobs.map(j => (j.id === e.id ? { ...j, progress: e.fraction, attempt: e.attempt } : j))));
}

export const refreshQueue = () => DesignMedia.queue().then(set, () => undefined);

export function useQueue(): NativeJobStatus[] {
  const [state, setState] = useState(jobs);
  useEffect(() => {
    start();
    listeners.add(setState);
    void refreshQueue();
    return () => { listeners.delete(setState); };
  }, []);
  return state;
}

export const isBusy = (j: NativeJobStatus) => j.state === 'running' || j.state === 'queued';
