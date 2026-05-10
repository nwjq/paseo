import { describe, expect, it } from "vitest";
import { resolveWorkspaceLocationHint } from "./workspace-location-hint";

describe("resolveWorkspaceLocationHint", () => {
  it("returns repo root when workspace directory equals project root", () => {
    expect(
      resolveWorkspaceLocationHint({
        projectKind: "git",
        projectRootPath: "/repo/main",
        workspaceDirectory: "/repo/main",
      }),
    ).toEqual({
      isSubdirectory: false,
      label: "repo root",
    });
  });

  it("returns subdir path when workspace directory is under project root", () => {
    expect(
      resolveWorkspaceLocationHint({
        projectKind: "git",
        projectRootPath: "/repo/main",
        workspaceDirectory: "/repo/main/packages/app",
      }),
    ).toEqual({
      isSubdirectory: true,
      label: "subdir: packages/app",
    });
  });

  it("handles Windows-style paths case-insensitively", () => {
    expect(
      resolveWorkspaceLocationHint({
        projectKind: "git",
        projectRootPath: "C:\\Repo\\Main",
        workspaceDirectory: "c:\\repo\\main\\packages\\app",
      }),
    ).toEqual({
      isSubdirectory: true,
      label: "subdir: packages/app",
    });
  });

  it("returns null when the workspace directory is outside the project root", () => {
    expect(
      resolveWorkspaceLocationHint({
        projectKind: "git",
        projectRootPath: "/repo/main",
        workspaceDirectory: "/repo/other",
      }),
    ).toBeNull();
  });

  it("returns null for non-git projects", () => {
    expect(
      resolveWorkspaceLocationHint({
        projectKind: "non_git",
        projectRootPath: "/notes",
        workspaceDirectory: "/notes",
      }),
    ).toBeNull();
  });
});
