// window.native.vision (SPEC §14.3, as built 2026-11-18) against a fake app that answers
// visionChunk / vision / visionRead / visionCancel the way app/editor.tsx does.
export async function run({ page, assert }) {
  await page.evaluate(() => {
    const PIECE = 786432;
    const b64 = bytes => {
      let s = '';
      for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(s);
    };
    const fake = window.__vision = { pieces: {}, chunks: [], runs: [], reads: [], cancels: [], result: null, hold: null, fail: null };
    const answer = (reqId, value) => setTimeout(() => window.__editorCommand('reply', { reqId, ok: true, value }));
    const prev = window.ReactNativeWebView.postMessage;
    window.ReactNativeWebView.postMessage = m => {
      prev(m);
      const msg = JSON.parse(m);
      if (msg.type === 'visionTools') answer(msg.reqId, ['person', 'object']);
      else if (msg.type === 'visionChunk') {
        fake.chunks.push(msg.data.length);
        (fake.pieces[msg.id] ||= [])[msg.index] = msg.data;
        answer(msg.reqId, true);
      } else if (msg.type === 'vision') {
        fake.runs.push({ id: msg.id, op: msg.op, option: msg.option, chunks: msg.chunks });
        if (fake.fail) setTimeout(() => window.__editorCommand('reply', { reqId: msg.reqId, ok: false, error: fake.fail }));
        else if (fake.hold) fake.hold = msg.reqId;
        else {
          window.__editorCommand('visionProgress', { id: msg.id, phase: 'download', fraction: 0.5 });
          window.__editorCommand('visionProgress', { id: 'someone-else', phase: 'run', fraction: 0.9 });
          window.__editorCommand('visionProgress', { id: msg.id, phase: 'run', fraction: 0.25 });
          answer(msg.reqId, { bytes: fake.result.length });
        }
      } else if (msg.type === 'visionRead') {
        fake.reads.push(msg.index);
        const part = fake.result.subarray(msg.index * PIECE, (msg.index + 1) * PIECE);
        answer(msg.reqId, { data: b64(part), done: (msg.index + 1) * PIECE >= fake.result.length });
      } else if (msg.type === 'visionCancel') {
        fake.cancels.push(msg.id);
        answer(msg.reqId, true);
      }
    };
  });

  assert.equal(await page.evaluate(() => typeof window.native.vision), 'function', 'the phone page has native.vision');
  assert.deepEqual(await page.evaluate(() => window.native.vision({ op: 'tools' })), ['person', 'object']);

  const trip = await page.evaluate(async () => {
    const fake = window.__vision;
    const src = new Uint8Array(2_500_000);
    for (let i = 0; i < src.length; i++) src[i] = (i * 7 + (i >> 9)) & 255;
    fake.result = src.slice(0, 1_700_000).map(v => v ^ 0x5a);
    const progress = [];
    const blob = await window.native.vision({ op: 'cutout', kind: 'person', image: new Blob([src]), onProgress: (phase, f) => progress.push([phase, f]) });
    const got = new Uint8Array(await blob.arrayBuffer());
    const run = fake.runs.at(-1);
    const sent = Uint8Array.from(atob(fake.pieces[run.id].join('')), c => c.charCodeAt(0));
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    return {
      run, progress, chunks: fake.chunks, reads: fake.reads, type: blob.type,
      sourceSame: same(sent, src), resultSame: same(got, fake.result),
    };
  });
  assert.match(trip.run.id, /^v[A-Za-z0-9_-]{1,63}$/, 'run ids fit the Kotlin rule');
  assert.deepEqual({ op: trip.run.op, option: trip.run.option, chunks: trip.run.chunks }, { op: 'cutout', option: 'person', chunks: 4 });
  assert.deepEqual(trip.chunks, [1_048_576, 1_048_576, 1_048_576, 4 * Math.ceil((2_500_000 - 3 * 786_432) / 3)], 'pieces are 1 MB of base64');
  assert.ok(trip.sourceSame, 'the image rebuilds byte-identical on the app side');
  assert.deepEqual(trip.reads, [0, 1, 2], 'the result comes back in three pieces');
  assert.ok(trip.resultSame, 'the result Blob has the same bytes');
  assert.equal(trip.type, 'image/png');
  assert.deepEqual(trip.progress, [['download', 0.5], ['run', 0.25]], 'only this run\'s progress reaches onProgress');

  const cancel = await page.evaluate(async () => {
    const fake = window.__vision;
    fake.reads.length = 0;
    fake.hold = true;
    const p = window.native.vision({ op: 'upscale', scale: 4, image: new Blob([new Uint8Array(10)]) });
    while (fake.hold === true) await new Promise(r => setTimeout(r, 10));
    await window.native.vision({ op: 'cancel' });
    const value = await p;
    const busy = await window.native.vision({ op: 'cutout', kind: 'object', image: new Blob([new Uint8Array(1)]) }).then(() => 'ran', e => e.message);
    window.__editorCommand('reply', { reqId: fake.hold, ok: true, value: null });
    fake.hold = null;
    await new Promise(r => setTimeout(r, 50));
    const run = fake.runs.at(-1);
    return { value, busy, option: run.option, cancelled: fake.cancels.includes(run.id), reads: fake.reads.length };
  });
  assert.equal(cancel.value, null, 'a cancelled run resolves null');
  assert.equal(cancel.option, '4');
  assert.ok(cancel.cancelled, 'visionCancel reached the app');
  assert.equal(cancel.reads, 0, 'nothing was read back');
  assert.equal(cancel.busy, 'Wait for the current change to finish.', 'one run at a time, until the app answers');

  const failed = await page.evaluate(async () => {
    const fake = window.__vision;
    fake.fail = 'Connect to the internet once to get this tool.';
    const message = await window.native.vision({ op: 'cutout', kind: 'person', image: new Blob([new Uint8Array(3)]) }).then(() => 'ran', e => e.message);
    fake.fail = null;
    await new Promise(r => setTimeout(r, 50));
    return { message, cancelled: fake.cancels.includes(fake.runs.at(-1).id) };
  });
  assert.deepEqual(failed, { message: 'Connect to the internet once to get this tool.', cancelled: true }, 'an app error keeps its message and the app is told to drop the run');
}
