import type { WorkspaceDescriptor } from "@/stores/session-store";
import { buildHostNewWorkspaceRoute, buildHostRootRoute } from "@/utils/host-routes";
import { resolveProjectCreationDirectory } from "@/utils/sidebar-workspace-directory";
import { resolveWorkspaceRouteId } from "@/utils/workspace-execution";

export function buildWorkspaceArchiveRedirectRoute(input: {
  serverId: string;
  archivedWorkspaceId: string;
  workspaces: Iterable<WorkspaceDescriptor>;
}) {
  const archivedWorkspaceId = resolveWorkspaceRouteId({
    routeWorkspaceId: input.archivedWorkspaceId,
  });
  if (!archivedWorkspaceId) {
    return buildHostRootRoute(input.serverId);
  }

  const archivedWorkspace =
    Array.from(input.workspaces).find((workspace) => workspace.id === archivedWorkspaceId) ?? null;
  if (!archivedWorkspace) {
    return buildHostRootRoute(input.serverId);
  }
  const sourceDirectory = resolveProjectCreationDirectory({
    projectIconWorkingDir: archivedWorkspace.projectRootPath,
    workspaceDirectory: archivedWorkspace.workspaceDirectory,
  });
  if (!sourceDirectory) {
    return buildHostRootRoute(input.serverId);
  }

  return buildHostNewWorkspaceRoute(input.serverId, sourceDirectory, {
    displayName: archivedWorkspace.projectDisplayName,
    projectId: archivedWorkspace.projectId,
  });
}
