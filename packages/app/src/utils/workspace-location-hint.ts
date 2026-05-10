import { normalizeWorkspacePath } from "@/utils/workspace-identity";

function normalizePathForCompare(value: string): string {
  return /^[A-Za-z]:/.test(value) ? value.toLowerCase() : value;
}

export interface WorkspaceLocationHint {
  isSubdirectory: boolean;
  label: string;
}

export function resolveWorkspaceLocationHint(input: {
  projectKind: "git" | "non_git" | "directory";
  projectRootPath?: string | null;
  workspaceDirectory?: string | null;
}): WorkspaceLocationHint | null {
  if (input.projectKind !== "git") {
    return null;
  }

  const projectRootPath = normalizeWorkspacePath(input.projectRootPath)?.replace(/\\/g, "/");
  const workspaceDirectory = normalizeWorkspacePath(input.workspaceDirectory)?.replace(/\\/g, "/");
  if (!projectRootPath || !workspaceDirectory) {
    return null;
  }

  const compareProjectRootPath = normalizePathForCompare(projectRootPath);
  const compareWorkspaceDirectory = normalizePathForCompare(workspaceDirectory);
  if (compareProjectRootPath === compareWorkspaceDirectory) {
    return { isSubdirectory: false, label: "repo root" };
  }

  const projectRootPrefix = compareProjectRootPath === "/" ? "/" : `${compareProjectRootPath}/`;
  if (!compareWorkspaceDirectory.startsWith(projectRootPrefix)) {
    return null;
  }

  const relativePath = workspaceDirectory.slice(projectRootPath.length + 1).trim();
  if (!relativePath) {
    return { isSubdirectory: false, label: "repo root" };
  }

  return {
    isSubdirectory: true,
    label: `subdir: ${relativePath}`,
  };
}
