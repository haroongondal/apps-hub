import { Button, Header, Screen, space, Text } from '@apps-hub/ui';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

export default function Home() {
  const [busy, setBusy] = useState(false);

  async function openPdf() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'] });
      const asset = res.assets?.[0];
      if (!res.canceled && asset) {
        // Router params stay small: bytes are read on the editor screen, not here.
        router.push({ pathname: '/editor', params: { uri: asset.uri, name: asset.name } });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen style={{ paddingHorizontal: space.xl, justifyContent: 'center', gap: space.xxl }}>
      <Header title="PDF Editor" subtitle="Edit text, mark up and rearrange the pages of any PDF." />
      <View style={{ gap: space.md }}>
        <Button label="Open a PDF" onPress={openPdf} busy={busy} />
        <Text variant="meta" tone="muted">
          Everything stays on this device. No account, no upload.
        </Text>
      </View>
    </Screen>
  );
}
