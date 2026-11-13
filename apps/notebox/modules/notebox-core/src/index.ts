import { requireNativeModule } from 'expo';

// The contract grows with the native module (Tasks 5-7); the skeleton only proves the module loads.
export const NoteboxCore = requireNativeModule('NoteboxCore');

export default NoteboxCore;
