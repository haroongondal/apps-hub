/**
 * Design Editor receives pictures and videos from other apps' share sheets (E3). The main activity gets a SEND and a
 * SEND_MULTIPLE filter for image/* and video/*. The activity is singleTask, so a share while the app is open arrives
 * in onNewIntent, which the design-media module handles. The committed android/ manifest carries the same filters;
 * plugin/__tests__/manifest.test.ts runs this over it so the two cannot drift apart.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const ACTIONS = ['android.intent.action.SEND', 'android.intent.action.SEND_MULTIPLE'];
const MIME_TYPES = ['image/*', 'video/*'];

const filterFor = (action) => ({
  action: [{ $: { 'android:name': action } }],
  category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
  data: MIME_TYPES.map((mime) => ({ $: { 'android:mimeType': mime } })),
});

const hasAction = (filter, action) => (filter.action ?? []).some((a) => a.$?.['android:name'] === action);

/** Mutates the parsed manifest (xml2js shape). Safe to run more than once. */
function configureManifest(manifest) {
  const activity = manifest.manifest?.application?.[0]?.activity?.find((a) => a.$?.['android:name'] === '.MainActivity');
  if (!activity) throw new Error('share-target: .MainActivity not found in the manifest');
  const kept = (activity['intent-filter'] ??= []).filter((f) => !ACTIONS.some((a) => hasAction(f, a)));
  activity['intent-filter'] = [...kept, ...ACTIONS.map(filterFor)];
  return manifest;
}

module.exports = (config) =>
  withAndroidManifest(config, (config) => {
    configureManifest(config.modResults);
    return config;
  });
module.exports.configureManifest = configureManifest;
