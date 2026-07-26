import { describe, expect, it } from "vitest";
import { md5Hex } from "../shared/md5";
import { parseStanzas, stanzaField } from "../shared/stanza";
import { buildTranslationIndex } from "./index-files";
import { buildPackageIndexes, descriptionDigest, withDescriptionDigest, type AptIndexStanzas } from "./packages";
import type { AptResolvedRepositoryConfig } from "./config";

const config: AptResolvedRepositoryConfig = {
  codename: "noble",
  components: ["main"],
  architectures: ["amd64", "arm64"],
  signingKeyId: "signing_key_prod",
};

function stanza(input: { name: string; architecture: string; description: string }) {
  return [
    { name: "Package", value: input.name },
    { name: "Version", value: "1.0.0" },
    { name: "Architecture", value: input.architecture },
    { name: "Filename", value: `pool/main/${input.name}/${input.name}_1.0.0_${input.architecture}.deb` },
    { name: "Description", value: input.description },
  ];
}

function stanzasByIndex(entries: Array<{ architecture: string; stanzas: ReturnType<typeof stanza>[] }>) {
  return new Map<string, AptIndexStanzas>(
    entries.map((entry) => [
      `main\0${entry.architecture}`,
      { component: "main", architecture: entry.architecture, stanzas: entry.stanzas },
    ]),
  );
}

describe("Description-md5", () => {
  it("hashes the description together with the newline that ends the field", () => {
    // apt computes the same digest from the Packages text, where the field is
    // terminated by a newline, so leaving it out would never match.
    expect(descriptionDigest("Example package")).toBe(md5Hex("Example package\n"));
    expect(descriptionDigest("Example package\n Long form.")).toBe(md5Hex("Example package\n Long form.\n"));
  });

  it("is added to indexes published before translations existed", () => {
    const legacy = stanza({ name: "alpha", architecture: "amd64", description: "Alpha package" });
    expect(stanzaField(legacy, "Description-md5")).toBeUndefined();

    const upgraded = withDescriptionDigest(legacy);

    expect(stanzaField(upgraded, "Description-md5")).toBe(descriptionDigest("Alpha package"));
  });

  it("leaves a digest that is already present alone", () => {
    const existing = [...stanza({ name: "alpha", architecture: "amd64", description: "Alpha" }),
      { name: "Description-md5", value: "already-computed" }];

    expect(withDescriptionDigest(existing)).toBe(existing);
  });
});

describe("Translation-en", () => {
  it("carries one entry per distinct description, shared across architectures", () => {
    const indexes = buildPackageIndexes({
      config,
      stanzasByIndex: stanzasByIndex([
        { architecture: "amd64", stanzas: [stanza({ name: "alpha", architecture: "all", description: "Alpha package\n Long form." })] },
        { architecture: "arm64", stanzas: [stanza({ name: "alpha", architecture: "all", description: "Alpha package\n Long form." })] },
      ]),
    });

    const translation = buildTranslationIndex(indexes);
    const stanzas = parseStanzas(translation ?? "");

    expect(stanzas).toHaveLength(1);
    expect(stanzaField(stanzas[0]!, "Package")).toBe("alpha");
    expect(stanzaField(stanzas[0]!, "Description-md5")).toBe(descriptionDigest("Alpha package\n Long form."));
    expect(stanzaField(stanzas[0]!, "Description-en")).toBe("Alpha package\n Long form.");
  });

  it("keeps separate entries when the same package has different descriptions", () => {
    const indexes = buildPackageIndexes({
      config,
      stanzasByIndex: stanzasByIndex([
        { architecture: "amd64", stanzas: [stanza({ name: "alpha", architecture: "amd64", description: "Alpha for amd64" })] },
        { architecture: "arm64", stanzas: [stanza({ name: "alpha", architecture: "arm64", description: "Alpha for arm64" })] },
      ]),
    });

    const stanzas = parseStanzas(buildTranslationIndex(indexes) ?? "");

    expect(stanzas.map((entry) => stanzaField(entry, "Description-en")).sort()).toEqual([
      "Alpha for amd64",
      "Alpha for arm64",
    ]);
  });

  it("matches the digest that the Packages index publishes", () => {
    const indexes = buildPackageIndexes({
      config,
      stanzasByIndex: stanzasByIndex([
        { architecture: "amd64", stanzas: [stanza({ name: "alpha", architecture: "amd64", description: "Alpha package" })] },
      ]),
    });

    const published = parseStanzas(indexes[0]!.packages)[0]!;
    const translated = parseStanzas(buildTranslationIndex(indexes) ?? "")[0]!;

    expect(stanzaField(translated, "Description-md5")).toBe(stanzaField(published, "Description-md5"));
  });

  it("is omitted for a component with nothing to translate", () => {
    expect(buildTranslationIndex([])).toBeUndefined();
  });
});
