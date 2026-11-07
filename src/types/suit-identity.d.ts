// @supersuit/suit-identity ships JavaScript with no types. These are the calls this host makes.
declare module '@supersuit/suit-identity' {
  export function newDeviceKey(): { priv: string; pub: string }
  export function genesisEntry(o: { priv: string; device?: string; at?: string }): { v: 1; op: 'genesis'; suit: string; key: string; device?: string; at?: string; prev: null; sig: string }
  export function signEntry<T extends Record<string, unknown>>(payload: T, priv: string): T & { sig: string }
  export function verifySig(payload: unknown, sig: unknown, pub: string): boolean
  export function verifyLog(log: unknown, opts?: { idOptions?: { prefix?: string; length?: number } }): { ok: true; suit: string; keys: string[] } | { ok: false; why: string }
  export function checkHandle(h: unknown, opts?: { min?: number; max?: number; reserved?: readonly string[] }): { ok: true } | { ok: false; why: string }
}
