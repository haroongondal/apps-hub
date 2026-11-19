import { RE2 } from '@adguard/re2-wasm';

// Node only (build script, tests). The converter checks regexes with chrome.declarativeNetRequest, so in Node it would
// refuse them all; this does what its own CLI does: RE2 under Chrome's memory limit, through the module it uses inside.
export async function checkRegexesWithRe2(): Promise<void> {
  const url = new URL('re2-regexp/re2-validator.js', import.meta.resolve('@adguard/dnr-converter'));
  const { re2Validator } = await import(url.href);
  re2Validator.setValidator(async (regex: string) => Boolean(new RE2(regex, 'u', 1979)));
}
