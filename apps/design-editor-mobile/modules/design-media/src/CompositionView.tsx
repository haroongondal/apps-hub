import { requireNativeViewManager } from 'expo-modules-core';
import { forwardRef, type ComponentType, type Ref } from 'react';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

export interface CompositionViewProps extends ViewProps {
  plan: string | null; // JSON of a ComposePlan
  playing: boolean;
  onPosition?: (e: { timeS: number }) => void;
  onEnded?: () => void;
  onError?: () => void;
}

// The native view's prototype carries these view functions, so the forwarded ref is the handle itself.
export interface CompositionViewHandle {
  seekTo(timeS: number): Promise<void>;
  setScrubbing(on: boolean): Promise<void>;
}

type NativeProps = Omit<CompositionViewProps, 'onPosition'> & {
  onPosition?: (e: NativeSyntheticEvent<{ timeS: number }>) => void;
  ref?: Ref<CompositionViewHandle>;
};
const Native = requireNativeViewManager('DesignMedia') as ComponentType<NativeProps>;

export const CompositionView = forwardRef<CompositionViewHandle, CompositionViewProps>(function CompositionView({ onPosition, ...rest }, ref) {
  return <Native {...rest} ref={ref} onPosition={onPosition && (e => onPosition(e.nativeEvent))} />;
});
