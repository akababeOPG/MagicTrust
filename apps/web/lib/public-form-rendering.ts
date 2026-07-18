import "server-only";

import {
  createDatabase,
  createFormManagementStore,
} from "@magictrust/database";
import type {
  FormManagementStore,
  PublishedFormRuntime,
} from "@magictrust/database";
import { getRequiredDatabaseUrl } from "@magictrust/config";
import { z } from "zod";

const publicFormSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export type PublicFormRenderingDependencies = {
  store: Pick<FormManagementStore, "getPublishedFormBySlug">;
};

export function createPublicFormRenderingDependencies(): PublicFormRenderingDependencies {
  const databaseUrl = getRequiredDatabaseUrl();
  return {
    store: databaseUrl
      ? createFormManagementStore(createDatabase(databaseUrl))
      : {
          async getPublishedFormBySlug() {
            throw new Error("DATABASE_URL is required for public forms.");
          },
        },
  };
}

export async function getPublicFormRuntime(
  slug: string,
  dependencies: PublicFormRenderingDependencies,
): Promise<PublishedFormRuntime | null> {
  const parsed = publicFormSlugSchema.safeParse(slug);
  if (!parsed.success) return null;
  return dependencies.store.getPublishedFormBySlug(parsed.data);
}
