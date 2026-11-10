// Helpers for the dl e2e modules (contract: bodies arrive with Task 3.7's implementation).
const nope = () => {
  throw new Error('not implemented');
};
export async function extPage(_t, _file = 'options.html') { nope(); }
export async function sendMsg(_t, _message) { nope(); }
export async function engineCount(_t) { nope(); }
export async function readRecords(_t) { nope(); }
export async function setDownloads(_t, _patch) { nope(); }
export async function resetDl(_t) { nope(); }
export async function readPart(_t, _name) { nope(); }
export async function readMeta(_t, _key) { nope(); }
export async function opfsNames(_t) { nope(); }
export async function localGet(_t, _keyOrNull) { nope(); }
export async function sessionGet(_t, _keyOrNull) { nope(); }
export async function until(_fn, _ms = 10000) { nope(); }
