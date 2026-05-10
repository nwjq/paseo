import type { WorkspaceDescriptor } from "@/stores/session-store";
import { resolveWorkspaceExecutionDirectory } from "@/utils/workspace-execution";
import { resolveWorkspaceLocationHint } from "@/utils/workspace-location-hint";

export interface ActiveWorkspaceLikeSelection {
  serverId: string;
  workspaceId: string;
}

export function resolveProjectHeaderWorkspaceId(input: {
  serverId: string | null;
  workspaceIds: readonly string[];
  activeSelection?: ActiveWorkspaceLikeSelection | null;
}): string | null {
  if (
    input.activeSelection &&
    input.serverId &&
    input.activeSelection.serverId === input.serverId &&
    input.workspaceIds.includes(input.activeSelection.workspaceId)
  ) {
    return input.activeSelection.workspaceId;
  }

  if (input.workspaceIds.length === 1) {
    return input.workspaceIds[0] ?? null;
  }

  return null;
}

export function resolveProjectCreationDirectory(input: {
  projectIconWorkingDir: string;
  workspaceDirectory?: string | null;
}): string | null {
  const workspaceDirectory = resolveWorkspaceExecutionDirectory({
    workspaceDirectory: input.workspaceDirectory,
  });
  if (workspaceDirectory) {
    return workspaceDirectory;
  }

  const fallback = input.projectIconWorkingDir.trim();
  return fallback.length > 0 ? fallback : null;
}

export function resolveWorkspaceLocationLabel(input: {
  projectKind: WorkspaceDescriptor["projectKind"];
  projectRootPath?: string | null;
  workspaceDirectory?: string | null;
}): string | null {
  const workspaceDirectory = resolveWorkspaceExecutionDirectory({
    workspaceDirectory: input.workspaceDirectory,
  });
  if (!workspaceDirectory) {
    return null;
  }

  const locationHint = resolveWorkspaceLocationHint({
    projectKind: input.projectKind,
    projectRootPath: input.projectRootPath,
    workspaceDirectory,
  });
  if (locationHint) {
    return `cwd: ${locationHint.label}`;
  }

  return `cwd: ${workspaceDirectory}`;
}
