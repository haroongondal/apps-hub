import React, { useEffect, useRef, useState } from 'react';
import { Image, PermissionsAndroid, View } from 'react-native';
import { Group, Notice, Row, Sheet, Text, space } from '@apps-hub/ui';
import InflowCore, { type Txn } from 'inflow-core';
import TextOcr, { allText } from 'text-ocr';
import { exactTime } from './format.ts';
import { RECEIPT_NONE, RECEIPT_PHOTOS_DENIED, RECEIPT_SAVE_ERROR, RECEIPT_SEARCH_ERROR } from './messages.ts';
import { MAX_PHOTOS_READ, matchReceipt, receiptWindow, type ReceiptMatch } from './receipts.ts';

interface Found { uri: string; takenAt: number; match: ReceiptMatch }

function matchLabel(m: ReceiptMatch): string {
  if (m.amountMatch && m.nameMatch) return 'Amount and name match';
  if (m.amountMatch) return 'Amount matches';
  if (m.nameMatch) return 'Name matches';
  return 'No match';
}

export function ReceiptSheet({ txn, onClose, onAttached }: { txn: Txn | null; onClose: () => void; onAttached: () => void }) {
  const [phase, setPhase] = useState<'loading' | 'reading' | 'done'>('loading');
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [found, setFound] = useState<Found[]>([]);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (txn) void search(txn);
    return () => {
      alive.current = false;
    };
  }, [txn?.id]);

  async function search(t: Txn) {
    setPhase('loading');
    setFound([]);
    setError(null);
    try {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES);
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) return fail(RECEIPT_PHOTOS_DENIED);
      const { from, to } = receiptWindow(t.at);
      const photos = InflowCore.galleryBetween(from, to).sort((a, b) => b.takenAt - a.takenAt).slice(0, MAX_PHOTOS_READ);
      if (!alive.current) return;
      if (photos.length === 0) return fail(RECEIPT_NONE);
      setPhase('reading');
      setTotal(photos.length);
      const out: Found[] = [];
      for (const [i, p] of photos.entries()) {
        if (!alive.current) return;
        try {
          const ocr = await TextOcr.recognizeFile(p.uri);
          out.push({ ...p, match: matchReceipt(allText(ocr.lines), t) });
        } catch {
          // A photo that cannot be read is left out of the list, not an error for the whole search.
        }
        setProgress(i + 1);
      }
      if (!alive.current) return;
      setFound(out.sort((a, b) => b.match.score - a.match.score || b.takenAt - a.takenAt));
      setPhase('done');
    } catch {
      fail(RECEIPT_SEARCH_ERROR);
    }
  }

  function fail(message: string) {
    if (!alive.current) return;
    setError(message);
    setPhase('done');
  }

  const attach = (f: Found) => {
    if (!txn || txn.itemIds.length === 0) return;
    try {
      InflowCore.attachReceipt(txn.itemIds[0], f.uri);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : RECEIPT_SAVE_ERROR);
      return;
    }
    onAttached();
    onClose();
  };

  return (
    <Sheet visible={txn !== null} onClose={onClose} title="Find receipt">
      {error !== null && <Notice tone="danger">{error}</Notice>}
      {phase !== 'done' && error === null && (
        <Notice>{phase === 'loading' ? 'Looking through your photos…' : `Reading photo ${progress} of ${total} on this phone.`}</Notice>
      )}
      {phase === 'done' && error === null && found.length === 0 && <Notice>{RECEIPT_NONE}</Notice>}
      {phase === 'done' && found.length > 0 && (
        <Group title="Photos from around this date">
          {found.map((f) => (
            <Row
              key={f.uri}
              title={exactTime(f.takenAt)}
              subtitle={matchLabel(f.match)}
              leading={<Image source={{ uri: f.uri }} style={{ width: 48, height: 48, borderRadius: 6 }} />}
              onPress={() => attach(f)}
              accessibilityHint="Attach this photo to the transaction"
            />
          ))}
        </Group>
      )}
      <View style={{ height: space.sm }} />
      <Text variant="meta" tone="muted">Photos are read on this phone only. The one you pick is saved encrypted with the transaction's message.</Text>
    </Sheet>
  );
}
