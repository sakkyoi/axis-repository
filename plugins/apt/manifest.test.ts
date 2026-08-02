import { describe, expect, it } from "vitest";
import { resolvePluginIconAssets } from "@axis-repository/core/plugin-icons";
import { aptPluginManifest } from "./manifest";

const manifest = aptPluginManifest;

describe("APT plugin manifest", () => {
  it("identifies the ecosystem it configures", () => {
    expect(manifest.ecosystem).toBe("apt");
    expect(manifest.repositoryConfig.namespace).toBe("apt");
    expect(manifest.clientHelpers?.namespace).toBe("apt");
    expect(manifest.adminResources.namespace).toBe("apt");
    expect(manifest.capabilities.length).toBeGreaterThan(0);
  });

  it("names every config field, helper action, and admin route exactly once", () => {
    const names = [
      manifest.repositoryConfig.fields.map((field) => field.name),
      manifest.clientHelpers?.actions.map((action) => action.name) ?? [],
      manifest.adminResources.routes.map((route) => route.name),
    ];

    for (const group of names) {
      expect(group.length).toBeGreaterThan(0);
      expect(new Set(group).size, `duplicate name in ${group.join(", ")}`).toBe(group.length);
      for (const name of group) {
        expect(name.trim()).not.toBe("");
      }
    }
  });

  it("declares admin routes that the resource dispatcher can match", () => {
    for (const route of manifest.adminResources.routes) {
      expect(["GET", "POST", "PUT", "PATCH", "DELETE"]).toContain(route.method);
      expect(route.path.length).toBeGreaterThan(0);
      for (const segment of route.path) {
        // A ":" prefix marks a parameter; the dispatcher rejects a bare ":".
        expect(segment).not.toBe(":");
        expect(segment.trim()).toBe(segment);
        expect(segment).not.toContain("/");
      }
    }

    const routeKeys = manifest.adminResources.routes.map((route) => `${route.method} ${route.path.length}`);
    // Routes are matched by method plus segment count, so two routes sharing
    // both would make the first shadow the second.
    const shadowed = routeKeys.filter((key, index) => routeKeys.indexOf(key) !== index);
    const parameterised = manifest.adminResources.routes.filter((route) =>
      route.path.some((segment) => segment.startsWith(":")),
    );
    expect(shadowed.length === 0 || parameterised.length > 0).toBe(true);
  });

  it("marks only unauthenticated-safe helper actions public", () => {
    // A public action bypasses repository read authorization, so anything
    // exposing private data must not be marked public.
    const publicActions = (manifest.clientHelpers?.actions ?? [])
      .filter((action) => action.public)
      .map((action) => action.name);

    expect(publicActions).toEqual(["key.gpg", "source", "install"]);
  });

  it("provides a plugin-owned ecosystem icon", () => {
    expect(manifest.icon?.title).toBe("APT");
    expect(manifest.icon?.accentColor).toBe("#A80030");
    expect(manifest.icon).toMatchObject({
      svgSource: {
        name: "Debian Open Use Logo without Debian label",
        url: "https://www.debian.org/logos/openlogo-nd.svg",
        rights: "LGPL-3.0-or-later OR CC-BY-SA-3.0",
      },
    });
    expect(manifest.icon).not.toHaveProperty("shapes");
    const assets = resolvePluginIconAssets(manifest.icon);
    expect(assets.title).toBe("APT");
    expect(assets.accentColor).toBe("#A80030");
    expect(assets.inlineSvg).toContain("viewBox=\"0 0 87.041 108.445\"");
    expect(assets.inlineSvg).toContain("#A80030");
    expect(assets.inlineSvg).not.toContain("<!DOCTYPE");
  });
});
