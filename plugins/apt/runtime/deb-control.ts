import { ValidationError } from "@axis-repository/core";
import {
  DebControlParseError,
  parseDebianControl,
  readDebControlMetadata as readSharedDebControlMetadata,
  type DebControlMetadata,
} from "../shared/deb-control";

export type { DebControlMetadata };
export { parseDebianControl };

export async function readDebControlMetadata(bytes: Uint8Array): Promise<DebControlMetadata> {
  try {
    return await readSharedDebControlMetadata(bytes);
  } catch (error) {
    if (error instanceof DebControlParseError) {
      throw new ValidationError(error.message);
    }
    throw error;
  }
}
