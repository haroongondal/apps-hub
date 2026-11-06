// The 10,000 most common passwords from SecLists, keeping the entries of 12 or more characters
// (shorter ones already fail the length rule), lowercased and de-duplicated.
// Source: https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/10k-most-common.txt
// Licence: MIT (SecLists, Daniel Miessler and contributors). Downloaded 2026-10-30.
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  "masterbating",
  "unbelievable",
  "businessbabe",
  "contortionist",
  "masterbaiting",
  "masturbation",
  "pornographic",
  "scandinavian",
  "films+pic+galeries",
  "motherfucker",
]);
