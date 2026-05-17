import * as FileSystem from 'expo-file-system';
import { api } from '@/convex/_generated/api';
import { convexClient } from '@/lib/convex';

export type UploadInput = {
  fileUri: string;
  contentType: string;
  key?: string;
};

export type UploadResult = {
  key: string;
  publicUrl?: string;
  etag?: string;
};

export async function uploadToR2({
  fileUri,
  contentType,
  key,
}: UploadInput): Promise<UploadResult> {
  const presigned = await convexClient.action(
    api.r2.generatePresignedPutUrl,
    { contentType, key },
  );

  try {
    const response = await FileSystem.uploadAsync(presigned.url, fileUri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': contentType },
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`R2 upload failed: ${response.status} ${response.body}`);
    }

    const etag =
      response.headers?.etag ??
      response.headers?.ETag ??
      undefined;

    return {
      key: presigned.key,
      etag,
    };
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('R2 upload failed: unknown error');
  }
}
