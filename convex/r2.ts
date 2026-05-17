'use node';

// Cloudflare R2 presigned URL actions.
//
// Required env vars (set with `npx convex env set <NAME> <VALUE>`):
//   R2_ACCOUNT_ID         — Cloudflare account ID
//   R2_ACCESS_KEY_ID      — R2 API token access key
//   R2_SECRET_ACCESS_KEY  — R2 API token secret
//   R2_BUCKET             — target bucket name

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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
  args: {
    contentType: v.string(),
    key: v.optional(v.string()),
  },
  handler: async (ctx, { contentType, key }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Not authenticated');
    }

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

export const generatePresignedGetUrl = action({
  args: {
    key: v.string(),
  },
  handler: async (ctx, { key }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Not authenticated');
    }

    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
    });

    const url = await getSignedUrl(client, command, { expiresIn: 3600 });
    return { url };
  },
});
