export type Site = { https: boolean; host: string };
export type AppLink = { pkg: string; certSha256: string; domain: string | null };

export type Login = {
  type: 'login'; name: string; username: string; password: string;
  sites: Site[]; apps: AppLink[]; note: string; updatedAt: number;
};
export type Card = {
  type: 'card'; name: string; holder: string; number: string;
  expMonth: number | null; expYear: number | null; cvc: string; note: string; updatedAt: number;
};
export type Note = { type: 'note'; name: string; text: string; updatedAt: number };
export type Deleted = { type: 'deleted'; updatedAt: number };
export type Entry = Login | Card | Note | Deleted;

// Key order matches the Android encoder; the sealed bytes need not be identical, but the vectors check that they are.
export function encodeEntry(e: Entry): string {
  switch (e.type) {
    case 'login':
      return JSON.stringify({
        type: e.type, name: e.name, username: e.username, password: e.password,
        sites: e.sites.map((s) => ({ https: s.https, host: s.host })),
        apps: e.apps.map((a) => ({ pkg: a.pkg, certSha256: a.certSha256, domain: a.domain })),
        note: e.note, updatedAt: e.updatedAt,
      });
    case 'card':
      return JSON.stringify({
        type: e.type, name: e.name, holder: e.holder, number: e.number,
        expMonth: e.expMonth, expYear: e.expYear, cvc: e.cvc, note: e.note, updatedAt: e.updatedAt,
      });
    case 'note':
      return JSON.stringify({ type: e.type, name: e.name, text: e.text, updatedAt: e.updatedAt });
    case 'deleted':
      return JSON.stringify({ type: e.type, updatedAt: e.updatedAt });
  }
}

class Malformed extends Error {}
type Obj = Record<string, unknown>;

const bad = (key: string): never => {
  throw new Malformed(key);
};
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (o: Obj, k: string): string => (typeof o[k] === 'string' ? (o[k] as string) : bad(k));
const int = (o: Obj, k: string): number => (Number.isSafeInteger(o[k]) ? (o[k] as number) : bad(k));
const bool = (o: Obj, k: string): boolean => (typeof o[k] === 'boolean' ? (o[k] as boolean) : bad(k));
const optStr = (o: Obj, k: string): string | null => (o[k] === null ? null : str(o, k));
const optInt = (o: Obj, k: string): number | null => (o[k] === null ? null : int(o, k));
const objs = (o: Obj, k: string): Obj[] => (Array.isArray(o[k]) && (o[k] as unknown[]).every(isObj) ? (o[k] as Obj[]) : bad(k));

const site = (o: Obj): Site => ({ https: bool(o, 'https'), host: str(o, 'host') });
const appLink = (o: Obj): AppLink => {
  const certSha256 = str(o, 'certSha256');
  if (!/^[0-9a-f]{64}$/.test(certSha256)) bad('certSha256');
  return { pkg: str(o, 'pkg'), certSha256, domain: optStr(o, 'domain') };
};

/** null for anything that isn't a complete, well-typed entry. */
export function decodeEntry(text: string): Entry | null {
  try {
    const o: unknown = JSON.parse(text);
    if (!isObj(o)) return null;
    const updatedAt = int(o, 'updatedAt');
    switch (o.type) {
      case 'login':
        return {
          type: 'login', name: str(o, 'name'), username: str(o, 'username'), password: str(o, 'password'),
          sites: objs(o, 'sites').map(site), apps: objs(o, 'apps').map(appLink), note: str(o, 'note'), updatedAt,
        };
      case 'card':
        return {
          type: 'card', name: str(o, 'name'), holder: str(o, 'holder'), number: str(o, 'number'),
          expMonth: optInt(o, 'expMonth'), expYear: optInt(o, 'expYear'), cvc: str(o, 'cvc'), note: str(o, 'note'), updatedAt,
        };
      case 'note':
        return { type: 'note', name: str(o, 'name'), text: str(o, 'text'), updatedAt };
      case 'deleted':
        return { type: 'deleted', updatedAt };
      default:
        return null;
    }
  } catch (e) {
    if (e instanceof Malformed || e instanceof SyntaxError) return null;
    throw e;
  }
}
