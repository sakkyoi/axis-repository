import { ValidationError } from "@axis-repository/core";
import {
  DebControlParseError,
  parseDebianControl,
  readDebControlMetadata as readSharedDebControlMetadata,
  type DebControlMetadata,
} from "../shared/deb-control";
import type { DebArchiveSource } from "../shared/deb-archive";

export type { DebControlMetadata };
export { parseDebianControl };

export async function readDebControlMetadata(
  source: DebArchiveSource | Uint8Array,
): Promise<DebControlMetadata> {
  try {
    return await readSharedDebControlMetadata(source);
  } catch (error) {
    if (error instanceof DebControlParseError) {
      throw new ValidationError(error.message);
    }
    throw error;
  }
}
