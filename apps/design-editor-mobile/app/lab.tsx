import { Redirect } from 'expo-router';

// The debug lab exists in development builds only: in a release build __DEV__ is false, the require
// below is removed, and this route sends a person home (PRD FR-13, AC-16).
export default function LabRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be a require so a release bundle drops the lab
  const MediaLab = require('../src/lab/MediaLab').default as () => React.JSX.Element;
  return <MediaLab />;
}
