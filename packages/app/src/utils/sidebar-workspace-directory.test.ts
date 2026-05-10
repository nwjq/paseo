import { describe, expect, it } from "vitest";
import {
  resolveProjectCreationDirectory,
  resolveProjectHeaderWorkspaceId,
  resolveWorkspaceLocationLabel,
} from "./sidebar-workspace-directory";

describe("resolveProjectHeaderWorkspaceId", () => {
  it("uses the active workspace when it belongs to the same project and server", () => {
    expect(
      resolveProjectHeaderWorkspaceId({
        serverId: "srv",
        workspaceIds: ["ws-root", "ws-subdir"],
        activeSelection: { serverId: "srv", workspaceId: "ws-subdir" },
      }),
    ).toBe("ws-subdir");
  });

  it("returns the only workspace id for single-workspace projects", () => {
    expect(
      resolveProjectHeaderWorkspaceId({
        serverId: "srv",
        workspaceIds: ["ws-subdir"],
        activeSelection: null,
      }),
    ).toBe("ws-subdir");
  });

  it("does not fall back to the first workspace for multi-workspace projects without an active selection", () => {
    expect(
      resolveProjectHeaderWorkspaceId({
        serverId: "srv",
        workspaceIds: ["ws-root", "ws-subdir"],
        activeSelection: null,
      }),
    ).toBeNull();
  });
});

describe("resolveProjectCreationDirectory", () => {
  it("prefers the workspace directory when available", () => {
    expect(
      resolveProjectCreationDirectory({
        projectIconWorkingDir: "/repo",
        workspaceDirectory: "/repo/packages/app",
      }),
    ).toBe("/repo/packages/app");
  });

  it("falls back to the project icon working directory", () => {
    expect(
      resolveProjectCreationDirectory({
        projectIconWorkingDir: "/repo",
        workspaceDirectory: null,
      }),
    ).toBe("/repo");
  });

  it("returns null when both inputs are empty", () => {
    expect(
      resolveProjectCreationDirectory({
        projectIconWorkingDir: "   ",
        workspaceDirectory: null,
      }),
    ).toBeNull();
  });
});

describe("resolveWorkspaceLocationLabel", () => {
  it("formats repo root labels", () => {
    expect(
      resolveWorkspaceLocationLabel({
        projectKind: "git",
        projectRootPath: "/repo",
        workspaceDirectory: "/repo",
      }),
    ).toBe("cwd: repo root");
  });

  it("formats subdirectory labels for git projects", () => {
    expect(
      resolveWorkspaceLocationLabel({
        projectKind: "git",
        projectRootPath: "/repo",
        workspaceDirectory: "/repo/packages/app",
      }),
    ).toBe("cwd: subdir: packages/app");
  });

  it("falls back to absolute path labels when git relationship is unknown", () => {
    expect(
      resolveWorkspaceLocationLabel({
        projectKind: "non_git",
        projectRootPath: "/notes",
        workspaceDirectory: "/notes",
      }),
    ).toBe("cwd: /notes");
  });
});
