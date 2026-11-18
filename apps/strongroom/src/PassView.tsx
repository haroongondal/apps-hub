import React, { useEffect, useRef, useState } from 'react';
import { AppState, Image, PixelRatio, View } from 'react-native';
import { Button, Notice, Sheet, Text, radius, space } from '@apps-hub/ui';
import Vault from 'strongroom-vault';
import { serialBrightness } from './brightness.ts';
import { isLocked, messageOf } from './call.ts';
import { secondsLeft, secondsLeftText } from './forms.ts';

interface Props {
  id: string;
  onLocked: () => void;
}

// The barcode at full width on a bright screen, and the "Hold to reader" sheet that arms the NFC tag.
export function PassView({ id, onLocked }: Props) {
  const [width, setWidth] = useState(0);
  const [uri, setUri] = useState<string | null>(null);
  const [ratio, setRatio] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [until, setUntil] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const armed = useRef(false);
  const mounted = useRef(true);
  const busy = useRef(false);

  const fail = (e: unknown) => (isLocked(e) ? onLocked() : setError(messageOf(e)));

  useEffect(() => {
    if (width === 0) return;
    let live = true;
    Vault.passImage(id, Math.round(width * PixelRatio.get())).then(
      (u) => live && (setUri(u), setError(null)),
      (e) => live && fail(e),
    );
    return () => {
      live = false;
    };
  }, [id, width]);

  // Brightness is cosmetic, so a failed call isn't worth an error; the native side restores it itself when the app goes to the background.
  useEffect(() => {
    const bright = serialBrightness((on) => Vault.setBright(on));
    bright(true);
    const sub = AppState.addEventListener('change', (s) => bright(s === 'active'));
    return () => {
      sub.remove();
      bright(false);
    };
  }, []);

  const close = () => {
    armed.current = false;
    setUntil(null);
  };

  const stop = () => {
    close();
    Vault.stopPresenting().catch(fail);
  };

  const present = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const { expiresInMs } = await Vault.presentPass(id);
      if (!mounted.current) return void Vault.stopPresenting().catch(() => {});
      armed.current = true;
      setError(null);
      setLeft(secondsLeft(expiresInMs, 0));
      setUntil(Date.now() + expiresInMs);
    } catch (e) {
      if (mounted.current) fail(e);
    } finally {
      busy.current = false;
    }
  };

  useEffect(() => {
    if (until === null) return;
    const tick = setInterval(() => {
      const n = secondsLeft(until, Date.now());
      setLeft(n);
      // The native side disarms by itself at expiry, so the sheet only closes.
      if (n === 0) close();
    }, 250);
    // Presenting also ends natively in the background; close the sheet to match.
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && close());
    return () => {
      clearInterval(tick);
      sub.remove();
    };
  }, [until]);

  // Leaving the screen disarms the tag.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (armed.current) Vault.stopPresenting().catch(() => {});
    };
  }, []);

  return (
    <>
      <View onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))} style={{ gap: space.md }}>
        {uri && (
          <Image
            source={{ uri }}
            onLoad={(e) => setRatio(e.nativeEvent.source.width / e.nativeEvent.source.height)}
            accessibilityLabel="Barcode"
            style={{ width: '100%', aspectRatio: ratio, borderRadius: radius.control }}
            resizeMode="contain"
          />
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        <Button label="Hold to reader" variant="secondary" onPress={present} block />
      </View>
      <Sheet visible={until !== null} onClose={stop} title="Hold to reader" doneLabel="Cancel">
        <Text>Hold the back of your phone to the reader.</Text>
        <Text variant="data" accessibilityLabel={secondsLeftText(left)}>{secondsLeftText(left)}</Text>
      </Sheet>
    </>
  );
}
