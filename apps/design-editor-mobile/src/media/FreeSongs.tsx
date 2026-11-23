import type { SongHit } from '@apps-hub/media-core';
import { Button, Field, Group, Notice, Row, Text } from '@apps-hub/ui';
import { useEffect, useState } from 'react';

import { plainError } from './errors';
import { downloadSong, loadToken, saveToken, searchSongs } from './songs';
import { timeText } from './tools';

export interface PickedSong { uri: string; name: string; durationS: number }

const say = (e: unknown) => plainError(e, 'Something went wrong. Try again.');

// The Sound section's free songs: the person's own Freesound key, a search, and one song added at the line.
export function FreeSongs({ onPick }: { onPick: (song: PickedSong) => Promise<void> }) {
  const [token, setToken] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SongHit[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadToken().then(setToken, () => setToken('')); }, []);

  async function run(job: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try { await job(); } catch (e) { setError(say(e)); } finally { setBusy(false); }
  }

  const saveKey = () => run(async () => {
    if (!keyDraft.trim()) throw new Error('Paste your Freesound key first.');
    await saveToken(keyDraft);
    setToken(keyDraft.trim());
    setKeyDraft('');
  });

  const search = (next: number) => run(async () => {
    if (!query.trim()) throw new Error('Type what you are looking for.');
    const got = await searchSongs(query, token ?? '', next);
    setHits(next === 1 ? got.hits : [...hits, ...got.hits]);
    setPage(next);
    setHasMore(got.hasMore);
  });

  const add = (hit: SongHit) => run(async () => onPick(await downloadSong(hit)));

  if (token === null) return null;
  if (!token) {
    return (
      <Group title="Free songs" footer="Free songs come from Freesound. Get a free key at freesound.org, then paste it here. It stays on this phone.">
        <Field label="Freesound key" value={keyDraft} onChangeText={setKeyDraft} autoCapitalize="none" autoCorrect={false} secureTextEntry />
        <Button label="Save key" variant="secondary" busy={busy} onPress={saveKey} />
        {error ? <Notice tone="warn">{error}</Notice> : null}
      </Group>
    );
  }
  return (
    <Group title="Free songs" footer="Only songs with no credit needed (Creative Commons 0) are listed.">
      <Field label="Search songs" value={query} onChangeText={setQuery} returnKeyType="search" onSubmitEditing={() => search(1)} />
      <Button label="Search" variant="secondary" busy={busy} onPress={() => search(1)} accessibilityHint="Finds free songs that match the words" />
      {error ? <Notice tone="warn">{error}</Notice> : null}
      {page > 0 && !hits.length ? <Text tone="muted">No free songs match that. Try other words.</Text> : null}
      {hits.map(hit => (
        <Row
          key={hit.id}
          title={hit.name}
          subtitle={timeText(hit.durationS)}
          trailing={<Button label="Add" variant="secondary" size="sm" busy={busy} onPress={() => add(hit)} accessibilityHint="Adds this song at the line" />}
        />
      ))}
      {hasMore ? <Button label="More songs" variant="ghost" busy={busy} onPress={() => search(page + 1)} /> : null}
    </Group>
  );
}
