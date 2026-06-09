import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { WorkspaceStructureProject } from "@/projects/workspace-structure";
import { resolveWorkspaceDescriptorExecutionDirectory } from "@/utils/workspace-execution";

export interface HostProjectListItem {
  serverId: string;
  projectKey: string;
  projectName: string;
  projectKind: WorkspaceDescriptor["projectKind"];
  projectRootPath: string;
  iconWorkingDir: string;
  creationWorkingDir: string;
  workspaceKeys: string[];
  canCreateWorktree: boolean;
}

export interface HostProjectRouteContext {
  serverId: string;
  projectId?: string;
  displayName?: string;
  sourceDirectory?: string;
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

export function canCreateWorktreeForProjectKind(
  projectKind: WorkspaceDescriptor["projectKind"],
): boolean {
  return projectKind === "git";
}

export function buildHostProjectList(input: {
  serverId: string;
  projects: readonly WorkspaceStructureProject[];
}): HostProjectListItem[] {
  return input.projects.map((project) => ({
    serverId: input.serverId,
    projectKey: project.projectKey,
    projectName: project.projectName,
    projectKind: project.projectKind,
    projectRootPath: project.projectRootPath,
    iconWorkingDir: project.iconWorkingDir,
    creationWorkingDir: project.creationWorkingDir,
    workspaceKeys: project.workspaceKeys,
    canCreateWorktree: canCreateWorktreeForProjectKind(project.projectKind),
  }));
}

export function hostProjectFromRoute(route: HostProjectRouteContext): HostProjectListItem | null {
  const projectKey = trimOptional(route.projectId);
  const iconWorkingDir = trimOptional(route.sourceDirectory);
  if (!projectKey || !iconWorkingDir) {
    return null;
  }
  return {
    serverId: route.serverId,
    projectKey,
    projectName: trimOptional(route.displayName) ?? projectKey,
    projectKind: "git",
    projectRootPath: iconWorkingDir,
    iconWorkingDir,
    creationWorkingDir: iconWorkingDir,
    workspaceKeys: [],
    canCreateWorktree: true,
  };
}

export function hostProjectFromWorkspace(input: {
  serverId: string;
  workspace: WorkspaceDescriptor | null;
}): HostProjectListItem | null {
  if (!input.workspace) {
    return null;
  }
  const projectKey = input.workspace.projectId.trim();
  const iconWorkingDir = input.workspace.projectRootPath.trim();
  if (!projectKey || !iconWorkingDir) {
    return null;
  }
  const workspaceCreationDirectory =
    (resolveWorkspaceDescriptorExecutionDirectory(input.workspace) ??
      input.workspace.workspaceDirectory.trim()) ||
    iconWorkingDir;
  return {
    serverId: input.serverId,
    projectKey,
    projectName: input.workspace.projectDisplayName || projectKey,
    projectKind: input.workspace.projectKind,
    projectRootPath: input.workspace.projectRootPath,
    iconWorkingDir,
    creationWorkingDir: workspaceCreationDirectory,
    workspaceKeys: [input.workspace.id],
    canCreateWorktree: canCreateWorktreeForProjectKind(input.workspace.projectKind),
  };
}

export function resolveInitialWorktreeProject(input: {
  routeProject: HostProjectListItem | null;
  lastActiveProject: HostProjectListItem | null;
  projects: readonly HostProjectListItem[];
}): HostProjectListItem | null {
  if (input.routeProject?.canCreateWorktree) {
    return input.routeProject;
  }
  if (input.lastActiveProject?.canCreateWorktree) {
    return input.lastActiveProject;
  }
  return input.projects.find((project) => project.canCreateWorktree) ?? null;
}

export function resolveSelectedHostProject(input: {
  selectedProjectKey: string | null;
  projects: readonly HostProjectListItem[];
  routeProject: HostProjectListItem | null;
  lastActiveProject: HostProjectListItem | null;
}): HostProjectListItem | null {
  const selectedProjectKey = input.selectedProjectKey?.trim() ?? "";
  if (!selectedProjectKey) {
    return null;
  }

  return (
    input.projects.find((project) => project.projectKey === selectedProjectKey) ??
    (input.routeProject?.projectKey === selectedProjectKey ? input.routeProject : null) ??
    (input.lastActiveProject?.projectKey === selectedProjectKey ? input.lastActiveProject : null)
  );
}
