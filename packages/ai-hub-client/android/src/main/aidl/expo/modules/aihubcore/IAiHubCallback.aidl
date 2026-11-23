package expo.modules.aihubcore;

oneway interface IAiHubCallback {
  void onResult(String requestId, String resultJson);
  void onError(String requestId, String kind, String message);
}
