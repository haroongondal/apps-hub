// Output name for a size job: "<name> (compressed).mp4", then "<name> (compressed) 2.mp4", and so on.
// shortcut: size outputs only; Phase 2 adds the other tools' labels (PRD FR-10).
export function outputName(inputName: string, exists: (name: string) => boolean): string {
  const dot = inputName.lastIndexOf('.');
  const stem = (dot > 0 ? inputName.slice(0, dot) : inputName)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 100) || 'Video';
  const base = `${stem} (compressed)`;
  let name = `${base}.mp4`;
  for (let n = 2; exists(name); n++) name = `${base} ${n}.mp4`;
  return name;
}
