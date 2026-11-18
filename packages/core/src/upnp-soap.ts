/** UPnP SOAP over the LAN-only HTTP helper: build the envelope, parse the reply with regexes (no XML library). */
import { httpRequest } from './lan-http.ts';
import type { HttpTarget } from './lan-http.ts';
import type { InterfaceInfo } from './model.ts';
import type { NetLensNativeBinding } from './native-binding.ts';

export interface SoapService {
  serviceType: string;
  control: HttpTarget;
}

export type SoapResult = { ok: true; values: Record<string, string> } | { ok: false; errorCode: number | null };

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const escapeXml = (s: string): string => s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);

/** Argument order matters to UPnP devices, so args is an ordered list, not an object. */
export function buildSoapEnvelope(serviceType: string, action: string, args: ReadonlyArray<[string, string]>): string {
  const body = args.map(([name, value]) => `<${name}>${escapeXml(value)}</${name}>`).join('');
  return (
    '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
    `<u:${action} xmlns:u="${serviceType}">${body}</u:${action}></s:Body></s:Envelope>`
  );
}

const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// One pass, so "&amp;lt;" decodes to "&lt;" and not "<".
function decodeXml(s: string): string {
  return s.replace(ENTITY, (whole, e: string) => {
    if (e[0] !== '#') return NAMED[e];
    const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
  });
}

const FAULT = /<(?:[\w.-]+:)?Fault[\s>]/;
const ERROR_CODE = /<(?:[\w.-]+:)?errorCode\s*>\s*(\d+)\s*</;
const RESPONSE_OPEN = /<(?:[\w.-]+:)?([\w.-]*Response)\b[^>]*?(\/?)>/;
const ELEMENT = /<(?:[\w.-]+:)?([\w.-]+)(?:\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?\1\s*>)/g;

export function parseSoapResponse(status: number, body: string): SoapResult {
  if (status !== 200 || FAULT.test(body)) {
    const code = ERROR_CODE.exec(body);
    return { ok: false, errorCode: code ? Number(code[1]) : null };
  }
  const values: Record<string, string> = {};
  const open = RESPONSE_OPEN.exec(body);
  if (!open || open[2] === '/') return { ok: true, values };
  const rest = body.slice(open.index + open[0].length);
  const close = new RegExp(`</(?:[\\w.-]+:)?${open[1].replace(/\./g, '\\.')}\\s*>`).exec(rest);
  const inner = close ? rest.slice(0, close.index) : rest;
  for (const m of inner.matchAll(ELEMENT)) {
    const content = m[2] ?? '';
    if (!content.includes('<')) values[m[1]] = decodeXml(content);
  }
  return { ok: true, values };
}

export async function soapCall(
  binding: Pick<NetLensNativeBinding, 'tcpFetch'>,
  iface: InterfaceInfo,
  service: SoapService,
  action: string,
  args: ReadonlyArray<[string, string]> = [],
  timeoutMs?: number,
): Promise<SoapResult> {
  const res = await httpRequest(binding, iface, service.control, {
    method: 'POST',
    headers: { SOAPAction: `"${service.serviceType}#${action}"`, 'Content-Type': 'text/xml; charset="utf-8"' },
    body: buildSoapEnvelope(service.serviceType, action, args),
    timeoutMs,
  });
  return res ? parseSoapResponse(res.status, res.body) : { ok: false, errorCode: null };
}
