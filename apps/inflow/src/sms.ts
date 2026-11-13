import { PermissionsAndroid } from 'react-native';
import InflowCore from 'inflow-core';

export async function requestSms(): Promise<boolean> {
  try {
    const { READ_SMS, RECEIVE_SMS } = PermissionsAndroid.PERMISSIONS;
    const result = await PermissionsAndroid.requestMultiple([READ_SMS, RECEIVE_SMS]);
    if (result[READ_SMS] !== 'granted' || result[RECEIVE_SMS] !== 'granted') return false;
  } catch {
    return false;
  }
  // Not awaited: a big inbox takes a while, and the module announces new items itself.
  InflowCore.importSms().catch(() => {});
  return true;
}
