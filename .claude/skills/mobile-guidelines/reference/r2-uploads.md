---
name: r2-uploads
description: Cloudflare R2 upload flow for this codebase - mobile requests a presigned PUT URL from a Convex action, uploads with FileSystem.uploadAsync, then persists the returned key on the owning record via a Convex mutation. R2 credentials never leave the server.
---

# R2 Uploads

## Purpose

Cloudflare R2 is the object store for user-generated files in this codebase. The mobile client must never see R2 credentials and must never sign requests itself. The flow is three steps: (1) call a Convex `action` to mint a short-lived presigned PUT URL, (2) `FileSystem.uploadAsync` the file with `httpMethod: "PUT"` and a `Content-Type` header that matches what was signed, (3) call a follow-up Convex `mutation` to persist the returned `key` on the owning row so other clients can fetch a presigned GET URL later. Keys follow the pattern `uploads/{authIdentitySubject}/{uuid}.{ext}` so a user's objects are namespaced and traceable.

## Patterns

### 1. Convex action mints the presigned PUT URL

The action runs in the Node runtime (`'use node'`), holds the R2 credentials from Convex env vars, and returns `{ url, key }`. The key defaults to `uploads/{identity.subject}/{uuid}` so callers don't have to supply one. URL TTL is 5 minutes - long enough for a single upload, short enough to be uninteresting if leaked.

```ts
// convex/r2.ts
'use node';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v } from 'convex/values';
import { action } from './_generated/server';

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  },
});

export const generatePresignedPutUrl = action({
  args: { contentType: v.string(), key: v.optional(v.string()) },
  handler: async (ctx, { contentType, key }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Not authenticated');

    const objectKey = key ?? `uploads/${identity.subject}/${crypto.randomUUID()}`;
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: objectKey,
      ContentType: contentType,
    });
    const url = await getSignedUrl(client, command, { expiresIn: 300 });
    return { url, key: objectKey };
  },
});
```

Mirrored `generatePresignedGetUrl` returns a 1-hour read URL keyed by an existing object - same auth check, no key minting.

### 2. Mobile uploads with `FileSystem.uploadAsync`

The client uses `expo-file-system` with `httpMethod: 'PUT'`, `uploadType: BINARY_CONTENT`, and the same `Content-Type` that was signed. Mismatching the content-type from the presign step makes R2 reject the PUT with a `SignatureDoesNotMatch` error.

```ts
// lib/r2/upload.ts
import * as FileSystem from 'expo-file-system';
import { api } from '@/convex/_generated/api';
import { convexClient } from '@/lib/convex';

export async function uploadToR2({
  fileUri,
  contentType,
  key,
}: UploadInput): Promise<UploadResult> {
  const presigned = await convexClient.action(
    api.r2.generatePresignedPutUrl,
    { contentType, key },
  );

  const response = await FileSystem.uploadAsync(presigned.url, fileUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { 'Content-Type': contentType },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`R2 upload failed: ${response.status} ${response.body}`);
  }

  return {
    key: presigned.key,
    etag: response.headers?.etag ?? response.headers?.ETag,
  };
}
```

`lib/r2/upload.ts` and `lib/r2/download.ts` are the canonical adapters - screens import `uploadToR2` and `getR2Url` from `@/lib/r2`, never `expo-file-system` directly for object storage and never the Convex action directly.

### 3. Persist the key on the owning record

`uploadToR2` returns the key only. The screen (or a thin domain helper) then calls a Convex mutation that writes that key onto the row that "owns" the file - a `users.avatarKey`, `posts.attachmentKey`, etc. Reads later round-trip through `getR2Url(key)` for a presigned GET.

```tsx
// app/(tabs)/profile/edit.tsx (sketch)
import { uploadToR2 } from '@/lib/r2';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

const setAvatar = useMutation(api.users.setAvatarKey);

async function onPickedAvatar(uri: string) {
  const { key } = await uploadToR2({ fileUri: uri, contentType: 'image/jpeg' });
  await setAvatar({ key });
}
```

### 4. Key pattern: `uploads/{authIdentitySubject}/{uuid}.{ext}`

The Convex action enforces the prefix (`uploads/${identity.subject}/...`) when the client omits `key`. Callers that need a stable extension can pass `key: \`uploads/${subject}/${uuid}.jpg\`` themselves - but the auth-subject prefix is mandatory because it's the only thing tying an object back to a user when scanning the bucket.

### 5. Presigned GET for reads

Reads are symmetric: a Convex action returns a short-lived GET URL. Never store the presigned URL itself in the database - URLs expire; keys don't.

```ts
// lib/r2/download.ts
export async function getR2Url(key: string): Promise<string> {
  const { url } = await convexClient.action(api.r2.generatePresignedGetUrl, { key });
  return url;
}
```

## Anti-Patterns

- **Signing on the client.** The `@aws-sdk/s3-request-presigner` import must never appear under `lib/` or any RN code path. The mobile bundle has no R2 credentials; signing there is impossible without leaking them.
- **Storing R2 credentials in `EXPO_PUBLIC_*` env vars.** Anything prefixed with `EXPO_PUBLIC_` ships in the JS bundle and is readable on-device. R2 credentials live in Convex env (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) and only the action at `convex/r2.ts:24` reads them.
- **Returning a long-lived URL from the server.** `getSignedUrl(... , { expiresIn: 300 })` for PUT and `{ expiresIn: 3600 }` for GET are the ceilings. Anything longer is a leaked URL waiting to happen.
- **Persisting the presigned URL on the row.** The URL expires; the key is forever. Store `key`, regenerate URLs on demand via `getR2Url`.
- **`Content-Type` drift between presign and PUT.** The header sent to `FileSystem.uploadAsync` must equal the `contentType` passed to `generatePresignedPutUrl`. R2 rejects mismatches as `SignatureDoesNotMatch`.
- **Skipping the auth check in the action.** Removing the `ctx.auth.getUserIdentity()` guard at `convex/r2.ts:35` would let any caller mint URLs that write into someone else's prefix.

## Decision Rationale

See `../decisions.md` for:

- Why presigning happens in a Convex action rather than a Convex HTTP endpoint or a separate worker
- Why `expo-file-system`'s `uploadAsync` is preferred over `fetch(PUT, body)` (resumability + native progress on large files)
- Why the key pattern is auth-subject prefixed instead of randomly scattered (auditability + per-user lifecycle ops)
- Why R2 GET URLs are minted on demand instead of cached on the row
