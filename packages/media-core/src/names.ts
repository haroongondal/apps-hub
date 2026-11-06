// Output name: "<name> (<label>).<ext>", then "<name> (<label>) 2.<ext>", and so on. An empty label gives "<name>.<ext>".
// The label and ext come from the plan's tool (PRD FR-10); a caller never passes a user-typed extension.
export function outputName(inputName: string, label: string, ext: string, exists: (name: string) => boolean): string {
  const dot = inputName.lastIndexOf('.');
  const stem = (dot > 0 ? inputName.slice(0, dot) : inputName)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 100) || 'Video';
  const safeLabel = label.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 50);
  const base = safeLabel ? `${stem} (${safeLabel})` : stem;
  let name = `${base}.${ext}`;
  for (let n = 2; exists(name); n++) name = `${base} ${n}.${ext}`;
  return name;
}
