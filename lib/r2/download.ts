import { api } from '@/convex/_generated/api';
import { convexClient } from '@/lib/convex';

export async function getR2Url(key: string): Promise<string> {
  const { url } = await convexClient.action(api.r2.generatePresignedGetUrl, {
    key,
  });
  return url;
}
