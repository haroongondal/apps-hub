import { space, useTheme } from '@apps-hub/ui';
import type { ReactElement } from 'react';
import { FlatList, Image, Pressable, useWindowDimensions } from 'react-native';

// A tile whose photo is gone keeps its raised background, so a failed load shows an empty square.
export function PhotoGrid({ uris, header, empty, onPick }: { uris: string[]; header: ReactElement; empty?: ReactElement | null; onPick: (uri: string) => void }) {
  const { c } = useTheme();
  const size = (useWindowDimensions().width - 2 * space.xs) / 3;
  return (
    <FlatList
      data={uris}
      keyExtractor={u => u}
      numColumns={3}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      columnWrapperStyle={{ gap: space.xs }}
      contentContainerStyle={{ gap: space.xs, paddingBottom: space.xxxl }}
      renderItem={({ item, index }) => (
        <Pressable
          onPress={() => onPick(item)}
          accessibilityRole="imagebutton"
          accessibilityLabel={`Photo ${index + 1} of ${uris.length}`}
          accessibilityHint="Shows this photo larger"
          style={{ width: size, height: size, backgroundColor: c.raised }}
        >
          <Image source={{ uri: item }} resizeMethod="resize" style={{ width: size, height: size }} />
        </Pressable>
      )}
    />
  );
}
