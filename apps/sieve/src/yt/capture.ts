import { flipFromMatrix } from '@apps-hub/sieve-core/src/screenshot.ts';
import { defineAction, notifyActions, runAction } from './actions.ts';
import { feature, mainState } from './bridge.ts';
import { addButton, toast } from './row.ts';
import { SEL } from './selectors.ts';

const NOT_READY = "Sieve can't take a screenshot yet. Play the video first.";
const NOT_ALLOWED = 'Chrome only opens picture-in-picture from a click on the page. Use the Picture-in-picture button under the video.';

const video = (): HTMLVideoElement | null => document.querySelector<HTMLVideoElement>(SEL.video);
// The main world does not fill MainState.title yet, so the page's own tab title ("(3) Name - YouTube") stands in.
const titleOf = (): string => mainState()?.title || document.title.replace(/^\(\d+\) /, '').replace(/ - YouTube$/, '');
const pipping = (): boolean => document.pictureInPictureElement !== null && document.pictureInPictureElement === video();

const NS = 'http://www.w3.org/2000/svg';
function pipIcon(): SVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  for (const attrs of [{ x: '3', y: '5', width: '18', height: '14', rx: '2' }, { x: '12', y: '11', width: '6', height: '5', rx: '1' }]) {
    const r = document.createElementNS(NS, 'rect');
    for (const [k, v] of Object.entries(attrs)) r.setAttribute(k, v);
    s.append(r);
  }
  return s;
}

const toDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('the picture could not be read'));
    reader.readAsDataURL(blob);
  });

// shortcut: a blur radius stays in video pixels, so on a video shown smaller than its size it looks softer than on screen; fix if the owner notices.
async function makePng(v: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = v.videoWidth;
  canvas.height = v.videoHeight;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('the browser has no canvas');
  const style = getComputedStyle(v);
  const flip = flipFromMatrix(style.transform);
  g.filter = style.filter;
  g.translate(flip.h ? canvas.width : 0, flip.v ? canvas.height : 0);
  g.scale(flip.h ? -1 : 1, flip.v ? -1 : 1);
  g.drawImage(v, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('the browser could not make the picture');
  return blob;
}

async function screenshot(): Promise<void> {
  const v = video();
  if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return toast(NOT_READY);
  let dataUrl: string;
  try {
    dataUrl = await toDataUrl(await makePng(v));
  } catch (e) {
    return toast(e instanceof DOMException && e.name === 'SecurityError' ? "Sieve can't take a screenshot of this video." : `Sieve couldn't save the screenshot: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const reply = (await chrome.runtime.sendMessage({ type: 'yt-screenshot', dataUrl, title: titleOf(), seconds: v.currentTime })) as { ok?: unknown; message?: unknown } | undefined;
    toast(reply?.ok === true ? 'Screenshot saved' : `Sieve couldn't save the screenshot: ${typeof reply?.message === 'string' ? reply.message : 'no answer from Sieve'}`);
  } catch {
    toast("Sieve couldn't save the screenshot: Sieve was reloaded or turned off. Reload this page, then try again.");
  }
}

async function pip(): Promise<void> {
  const v = video();
  if (!v) return;
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await v.requestPictureInPicture();
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotAllowedError') toast(NOT_ALLOWED);
    else console.warn('Sieve: picture-in-picture did not open', e);
  }
}

feature('screenshot and picture-in-picture', () => {
  defineAction('screenshot', screenshot);
  defineAction('pip', pip, pipping);
  addButton({ id: 'screenshot', label: 'Screenshot', onClick: () => void runAction('screenshot') });
  addButton({ id: 'pip', label: 'Picture-in-picture', icon: pipIcon, pressed: pipping, onClick: () => void runAction('pip') });
  for (const type of ['enterpictureinpicture', 'leavepictureinpicture']) document.addEventListener(type, () => notifyActions(), true);
});
