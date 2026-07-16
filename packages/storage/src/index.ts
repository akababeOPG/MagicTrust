import { createHash } from "node:crypto";

import { get, put } from "@vercel/blob";
import { getBlobReadWriteToken } from "@magictrust/config";

export type UploadPrivateFileInput = {
  body: Blob;
  storageKey: string;
  contentType: string;
};

export type UploadedPrivateFile = {
  provider: "vercel-blob";
  storageKey: string;
  checksum: string;
};

export type DownloadPrivateFileInput = {
  storageKey: string;
};

export type DownloadedPrivateFile = {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  sizeBytes: number;
};

export type PrivateFileStorageProvider = {
  readonly provider: UploadedPrivateFile["provider"];
  uploadPrivateFile(
    input: UploadPrivateFileInput,
  ): Promise<UploadedPrivateFile>;
  downloadPrivateFile(
    input: DownloadPrivateFileInput,
  ): Promise<DownloadedPrivateFile | null>;
};

export function createVercelBlobPrivateStorageProvider(): PrivateFileStorageProvider {
  return {
    provider: "vercel-blob",
    async uploadPrivateFile(input) {
      const token = getBlobReadWriteToken();

      if (!token) {
        throw new Error("BLOB_READ_WRITE_TOKEN is required for file uploads.");
      }

      const checksum = await sha256(input.body);

      await put(input.storageKey, input.body, {
        access: "private",
        addRandomSuffix: false,
        contentType: input.contentType,
        token,
      });

      return {
        provider: "vercel-blob",
        storageKey: input.storageKey,
        checksum,
      };
    },
    async downloadPrivateFile(input) {
      const token = getBlobReadWriteToken();

      if (!token) {
        throw new Error(
          "BLOB_READ_WRITE_TOKEN is required for file downloads.",
        );
      }

      const result = await get(input.storageKey, {
        access: "private",
        token,
        useCache: false,
      });

      if (!result || result.statusCode !== 200) {
        return null;
      }

      return {
        body: result.stream,
        contentType: result.blob.contentType,
        sizeBytes: result.blob.size,
      };
    },
  };
}

async function sha256(body: Blob): Promise<string> {
  const buffer = Buffer.from(await body.arrayBuffer());
  const digest = createHash("sha256").update(buffer).digest("hex");

  return `sha256-${digest}`;
}
