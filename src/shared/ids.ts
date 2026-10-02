export type EntityPrefix =
  | 'usr'
  | 'srv'
  | 'nod'
  | 'db'
  | 'bkp'
  | 'sch'
  | 'act'
  | 'ses';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export function generatePublicId(prefix: EntityPrefix, length = 16): string {
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let token = '';
  for (let i = 0; i < length; i++) {
    token += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${prefix}_${token}`;
}

export function formatEntityPublicId(
  prefix: EntityPrefix,
  rawId: string,
  explicitPublicId?: string | null
): string {
  if (explicitPublicId && explicitPublicId.startsWith(`${prefix}_`)) {
    return explicitPublicId;
  }
  if (rawId.startsWith(`${prefix}_`)) {
    return rawId;
  }
  const clean = rawId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return `${prefix}_${clean.slice(0, 18)}`;
}
