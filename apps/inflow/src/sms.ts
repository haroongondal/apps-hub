import { PermissionsAndroid } from 'react-native';
import InflowCore from 'inflow-core';

/** 'never_ask_again' means Android will not show the dialog: the owner has to allow it in App info. */
export async function requestSms(): Promise<'granted' | 'denied' | 'never_ask_again'> {
  try {
    const { READ_SMS, RECEIVE_SMS } = PermissionsAndroid.PERMISSIONS;
    const result = await PermissionsAndroid.requestMultiple([READ_SMS, RECEIVE_SMS]);
    const results = [result[READ_SMS], result[RECEIVE_SMS]];
    if (results.includes('never_ask_again')) return 'never_ask_again';
    if (results.some((r) => r !== 'granted')) return 'denied';
  } catch {
    return 'denied';
  }
  // Not awaited: a big inbox takes a while, and the module announces new items itself.
  InflowCore.importSms().catch(() => {});
  return 'granted';
}
