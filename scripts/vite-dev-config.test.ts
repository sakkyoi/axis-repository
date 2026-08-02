import { describe, expect, it } from "vitest";

import {
  applyAxisWorkerConfig,
  devRemoteBindings,
  type AxisWorkerConfig,
} from "../vite.dev-config";

describe("Vite Cloudflare development config", () => {
  it("replaces the AXIS_OBJECTS bucket from .dev.vars for signed R2 uploads", () => {
    const config = workerConfig();

    applyAxisWorkerConfig(config, {
      UPLOAD_BACKEND: "r2",
      R2_BUCKET_NAME: "axis-repository-test",
    });

    expect(config.r2_buckets).toEqual([{
      binding: "AXIS_OBJECTS",
      bucket_name: "axis-repository-test",
      remote: true,
    }]);
  });

  it("keeps local bindings when uploads go through the Worker", () => {
    expect(devRemoteBindings({ UPLOAD_BACKEND: "local-r2" })).toBe(false);
  });

  it("does not remove unrelated R2 bindings", () => {
    const config = workerConfig();
    config.r2_buckets?.push({
      binding: "OTHER_BUCKET",
      bucket_name: "other",
    });

    applyAxisWorkerConfig(config, {
      UPLOAD_BACKEND: "r2",
      R2_BUCKET_NAME: "axis-repository-test",
    });

    expect(config.r2_buckets).toEqual([
      {
        binding: "AXIS_OBJECTS",
        bucket_name: "axis-repository-test",
        remote: true,
      },
      {
        binding: "OTHER_BUCKET",
        bucket_name: "other",
      },
    ]);
  });
});

function workerConfig(): AxisWorkerConfig {
  return {
    assets: {},
    r2_buckets: [{
      binding: "AXIS_OBJECTS",
      bucket_name: "axis-repository",
    }],
  };
}
