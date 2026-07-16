import { createHash } from "node:crypto";

import { put } from "@vercel/blob";
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

export type PrivateFileStorageProvider = {
  readonly provider: UploadedPrivateFile["provider"];
  uploadPrivateFile(
    input: UploadPrivateFileInput,
  ): Promise<UploadedPrivateFile>;
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
  };
}

async function sha256(body: Blob): Promise<string> {
  const buffer = Buffer.from(await body.arrayBuffer());
  const digest = createHash("sha256").update(buffer).digest("hex");

  return `sha256-${digest}`;
}
