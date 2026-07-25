import { describe, expect, it } from "vitest";
import {
  filesFromFileList,
  repositoryBrowserAcceptedPublishFiles,
  repositoryBrowserUploadOverlayClasses,
  repositoryBrowserUploadOverlay,
} from "./repository-browser-upload-model";

describe("repository browser upload model", () => {
  it("shows a publish overlay while files are dragged over a publishable repository", () => {
    expect(repositoryBrowserUploadOverlay({
      repositoryName: "debian-internal",
      canPublish: true,
      isDraggingFiles: true,
    })).toEqual({
      tone: "default",
      title: "Drop files to publish",
      description: "debian-internal",
    });
  });

  it("shows an unavailable overlay when the repository has no publish form", () => {
    expect(repositoryBrowserUploadOverlay({
      repositoryName: "python-internal",
      canPublish: false,
      isDraggingFiles: true,
    })).toEqual({
      tone: "muted",
      title: "Publishing is unavailable",
      description: "This repository does not support browser publishing.",
    });
  });

  it("does not show an overlay when files are not being dragged", () => {
    expect(repositoryBrowserUploadOverlay({
      repositoryName: "debian-internal",
      canPublish: true,
      isDraggingFiles: false,
    })).toBeUndefined();
  });

  it("uses a full-screen drop panel instead of a small centered card", () => {
    expect(repositoryBrowserUploadOverlayClasses("default")).toEqual({
      backdrop: "pointer-events-none fixed inset-0 z-50 bg-background/70 p-6 backdrop-blur-sm",
      panel: "grid h-full w-full place-items-center rounded-lg border border-dashed p-8 text-center shadow-lg border-primary bg-panel/95 text-foreground",
      content: "grid place-items-center gap-2",
    });
    expect(repositoryBrowserUploadOverlayClasses("muted").panel).toContain("border-border bg-panel/95 text-muted-foreground");
  });

  it("normalizes file list inputs into arrays", () => {
    const first = new File(["a"], "a.deb");
    const second = new File(["b"], "b.deb");
    const fileList = {
      0: first,
      1: second,
      length: 2,
      item: (index: number) => [first, second][index] ?? null,
      [Symbol.iterator]: function* () {
        yield first;
        yield second;
      },
    } as FileList;

    expect(filesFromFileList(fileList)).toEqual([first, second]);
    expect(filesFromFileList(null)).toEqual([]);
  });

  it("splits selected files by plugin-provided accepted file rules", () => {
    const deb = new File(["deb"], "package.deb");
    const wheel = new File(["wheel"], "package.whl");

    expect(repositoryBrowserAcceptedPublishFiles({
      files: [deb, wheel],
      isAcceptedFile: (file) => file.name.endsWith(".deb"),
    })).toEqual({
      accepted: [deb],
      rejected: [wheel],
    });
  });

  it("accepts every selected file when the plugin does not provide file rules", () => {
    const file = new File(["content"], "artifact.bin");

    expect(repositoryBrowserAcceptedPublishFiles({ files: [file] })).toEqual({
      accepted: [file],
      rejected: [],
    });
  });
});
