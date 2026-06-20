import { Buffer } from 'buffer';

// Hermes/quick-crypto code paths (e.g. PKCE base64url encoding) expect a global
// Buffer, which React Native does not provide by default.
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}
