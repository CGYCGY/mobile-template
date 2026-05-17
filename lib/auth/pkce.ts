import QuickCrypto from 'react-native-quick-crypto';

export type PkcePair = {
  verifier: string;
  challenge: string;
};

function base64UrlEncode(bytes: Uint8Array | Buffer): string {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function generatePkcePair(): Promise<PkcePair> {
  const randomBytes = QuickCrypto.randomBytes(48);
  const verifier = base64UrlEncode(randomBytes);

  const hash = QuickCrypto.createHash('sha256');
  hash.update(verifier);
  const digest = hash.digest();
  const challenge = base64UrlEncode(digest);

  return { verifier, challenge };
}
