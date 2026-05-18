---
name: example-r2-upload-flow
description: Annotated walkthrough of the R2 presigned-PUT upload flow — mobile + Convex action working together.
---

# Example: R2 Upload Flow

File uploads to Cloudflare R2 go through a Convex `action` that signs the URL server-side, then a direct PUT from the device. The device never sees R2 credentials.

## The three steps

1. **Mobile** calls a Convex `action` with file metadata (mime type, optional intended key).
2. **Convex action** returns `{ uploadUrl, key }`.
3. **Mobile** uploads via `FileSystem.uploadAsync(uploadUrl, fileUri, { httpMethod: 'PUT', headers: { 'content-type': mimeType } })`.
4. Optional: **Mobile** calls a follow-up Convex `mutation` to persist `key` on the owning record (e.g., `users.avatarKey`).

## Backend (Convex action)

```ts
// convex/r2.ts — canonical shape
import { v } from 'convex/values';
import { action } from './_generated/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const getUploadUrl = action({
  args: { contentType: v.string(), ext: v.string() },
  returns: v.object({ uploadUrl: v.string(), key: v.string() }),
  handler: async (ctx, { contentType, ext }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('unauthenticated');

    const key = `uploads/${identity.subject}/${crypto.randomUUID()}.${ext}`;
    const s3 = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 60 });
    return { uploadUrl, key };
  },
});
```

## Mobile side

```ts
// lib/r2/upload.ts — canonical shape
import * as FileSystem from 'expo-file-system';
import { convexClient } from '@/lib/convex';
import { api } from '@/convex/_generated/api';

export async function uploadFile(args: {
  fileUri: string;
  contentType: string;
}): Promise<{ key: string }> {
  const ext = args.contentType.split('/')[1] ?? 'bin';
  const { uploadUrl, key } = await convexClient.action(api.r2.getUploadUrl, {
    contentType: args.contentType,
    ext,
  });

  const result = await FileSystem.uploadAsync(uploadUrl, args.fileUri, {
    httpMethod: 'PUT',
    headers: { 'content-type': args.contentType },
  });

  if (result.status >= 300) {
    throw new Error(`R2 upload failed: ${result.status}`);
  }
  return { key };
}
```

## Call site

```ts
// e.g., from an avatar picker
import * as ImagePicker from 'expo-image-picker';
import { uploadFile } from '@/lib/r2';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

const setAvatar = useMutation(api.users.setAvatarKey);

const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images' });
if (picked.canceled) return;

const { key } = await uploadFile({
  fileUri: picked.assets[0]!.uri,
  contentType: 'image/jpeg',
});
await setAvatar({ key });
```

## Patterns demonstrated

- ✓ **Server-side signing** — R2 credentials live in Convex env (or EAS secrets piped to Convex), never on device.
- ✓ **Short URL expiry** — `expiresIn: 60` seconds. If the upload hasn't started in a minute, the URL is dead.
- ✓ **Key format** — `uploads/{authId}/{uuid}.{ext}`. Predictable for cleanup; user-scoped for access control.
- ✓ **Content-Type required** — both in the signed URL and in the PUT header. Mismatched content type fails the signature.
- ✓ **`FileSystem.uploadAsync`** — streams from disk; no need to read the file into JS memory.
- ✓ **Follow-up mutation** persists the key on the owning record. The R2 object alone has no meaning until it's referenced.

## Anti-patterns

- ❌ Returning `R2_ACCESS_KEY_ID` to the device. The whole point of presigning is to avoid this.
- ❌ Using `fetch(uploadUrl, { method: 'PUT', body: fileBlob })` — the file gets read into JS memory and a large image will OOM.
- ❌ Hard-coding a key on the device (`avatars/${userId}.jpg`). Convex assigns the key; device receives it.
- ❌ Long-lived signed URLs (`expiresIn: 3600+`). Use 60s. Re-sign if upload restarts.
- ❌ Skipping the follow-up mutation. An orphaned R2 object you can't find isn't a feature.
