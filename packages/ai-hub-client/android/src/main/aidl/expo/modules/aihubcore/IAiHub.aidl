package expo.modules.aihubcore;

import android.os.ParcelFileDescriptor;
import expo.modules.aihubcore.IAiHubCallback;

interface IAiHub {
  int apiVersion();
  void submit(String requestJson, in ParcelFileDescriptor attachment, IAiHubCallback callback);
  void cancel(String requestId);
  String status();
}
