import { existsSync } from "node:fs";
import type pino from "pino";
import type {
  ProjectRegistry,
  WorkspaceRegistry,
  PersistedProjectRecord,
  PersistedWorkspaceRecord,
} from "./workspace-registry.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";

const DEFAULT_RECONCILE_INTERVAL_MS = 60_000;

export type ReconciliationChange =
  | { kind: "workspace_archived"; workspaceId: string; directory: string; reason: string }
  | { kind: "project_archived"; projectId: string; directory: string; reason: string }
  | {
      kind: "project_updated";
      projectId: string;
      directory: string;
      fields: Partial<Pick<PersistedProjectRecord, "kind" | "displayName" | "rootPath">>;
    }
  | {
      kind: "workspace_updated";
      workspaceId: string;
      directory: string;
      fields: Partial<Pick<PersistedWorkspaceRecord, "displayName" | "kind">>;
    };

export interface ReconciliationResult {
  changesApplied: ReconciliationChange[];
  durationMs: number;
}

export interface WorkspaceReconciliationServiceOptions {
  projectRegistry: ProjectRegistry;
  workspaceRegistry: WorkspaceRegistry;
  logger: pino.Logger;
  intervalMs?: number;
  onChanges?: (changes: ReconciliationChange[]) => void;
  workspaceGitService?: Pick<WorkspaceGitService, "getWorkspaceGitMetadata">;
}

export class WorkspaceReconciliationService {
  private readonly projectRegistry: ProjectRegistry;
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly logger: pino.Logger;
  private readonly intervalMs: number;
  private readonly onChanges: ((changes: ReconciliationChange[]) => void) | null;
  private readonly workspaceGitService: Pick<WorkspaceGitService, "getWorkspaceGitMetadata"> | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(options: WorkspaceReconciliationServiceOptions) {
    this.projectRegistry = options.projectRegistry;
    this.workspaceRegistry = options.workspaceRegistry;
    this.logger = options.logger.child({ module: "workspace-reconciliation" });
    this.intervalMs = options.intervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
    this.onChanges = options.onChanges ?? null;
    this.workspaceGitService = options.workspaceGitService ?? null;
  }

  start(): void {
    if (this.timer) return;
    this.logger.info({ intervalMs: this.intervalMs }, "Starting workspace reconciliation service");
    this.timer = setInterval(() => void this.runSafe(), this.intervalMs);
    // Run once immediately on start
    void this.runSafe();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<ReconciliationResult> {
    return this.reconcile();
  }

  private async runSafe(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.reconcile();
      if (result.changesApplied.length > 0) {
        this.logger.info(
          { changeCount: result.changesApplied.length, durationMs: result.durationMs },
          "Reconciliation pass completed with changes",
        );
      }
    } catch (error) {
      this.logger.error({ err: error }, "Reconciliation pass failed");
    } finally {
      this.running = false;
    }
  }

  private async reconcile(): Promise<ReconciliationResult> {
    const start = Date.now();
    const changes: ReconciliationChange[] = [];

    const allProjects = await this.projectRegistry.list();
    const allWorkspaces = await this.workspaceRegistry.list();

    const activeProjects = allProjects.filter((p) => !p.archivedAt);
    const activeWorkspaces = allWorkspaces.filter((w) => !w.archivedAt);

    const workspacesByProject = new Map<string, PersistedWorkspaceRecord[]>();
    for (const workspace of activeWorkspaces) {
      const list = workspacesByProject.get(workspace.projectId) ?? [];
      list.push(workspace);
      workspacesByProject.set(workspace.projectId, list);
    }

    // 1. Archive workspaces whose directories no longer exist
    const missingWorkspaces = activeWorkspaces.filter((workspace) => !existsSync(workspace.cwd));
    await Promise.all(
      missingWorkspaces.map(async (workspace) => {
        const timestamp = new Date().toISOString();
        await this.workspaceRegistry.archive(workspace.workspaceId, timestamp);
        changes.push({
          kind: "workspace_archived",
          workspaceId: workspace.workspaceId,
          directory: workspace.cwd,
          reason: "directory_missing",
        });

        // Update the in-memory list for the project orphan check below
        const siblings = workspacesByProject.get(workspace.projectId);
        if (siblings) {
          const updated = siblings.filter((w) => w.workspaceId !== workspace.workspaceId);
          workspacesByProject.set(workspace.projectId, updated);
        }
      }),
    );

    // 2. Archive orphaned projects (all workspaces archived/removed)
    const orphanedProjects = activeProjects.filter((project) => {
      const siblings = workspacesByProject.get(project.projectId) ?? [];
      return siblings.length === 0;
    });
    await Promise.all(
      orphanedProjects.map(async (project) => {
        const latestWorkspaces = await this.workspaceRegistry.list();
        const stillHasActiveWorkspace = latestWorkspaces.some(
          (workspace) => !workspace.archivedAt && workspace.projectId === project.projectId,
        );
        if (stillHasActiveWorkspace) {
          return;
        }
        const timestamp = new Date().toISOString();
        await this.projectRegistry.archive(project.projectId, timestamp);
        changes.push({
          kind: "project_archived",
          projectId: project.projectId,
          directory: project.rootPath,
          reason: "no_active_workspaces",
        });
      }),
    );

    // 3. Reconcile git metadata for active projects whose directories still exist
    const projectsToReconcile = activeProjects.filter((project) => {
      if (project.archivedAt) return false;
      const siblings = workspacesByProject.get(project.projectId) ?? [];
      if (siblings.length === 0) return false;
      if (!existsSync(project.rootPath)) return false;
      return true;
    });
    await Promise.all(
      projectsToReconcile.map((project) =>
        this.reconcileProject(project, workspacesByProject.get(project.projectId) ?? [], changes),
      ),
    );

    if (changes.length > 0 && this.onChanges) {
      this.onChanges(changes);
    }

    return { changesApplied: changes, durationMs: Date.now() - start };
  }

  private async reconcileProject(
    project: PersistedProjectRecord,
    siblings: PersistedWorkspaceRecord[],
    changes: ReconciliationChange[],
  ): Promise<void> {
    const latestProject = (await this.projectRegistry.get(project.projectId)) ?? project;
    if (latestProject.archivedAt) {
      return;
    }

    const projectRootPath = latestProject.rootPath;
    const directoryName = projectRootPath.split(/[\\/]/).findLast(Boolean) ?? projectRootPath;
    const currentGit = await this.readWorkspaceGitMetadata(projectRootPath, directoryName);

    const projectUpdates: Partial<
      Pick<PersistedProjectRecord, "kind" | "displayName" | "rootPath">
    > = {};

    const mappedKind = currentGit.projectKind === "git" ? "git" : "non_git";

    if (latestProject.kind !== mappedKind) {
      projectUpdates.kind = mappedKind;
      projectUpdates.displayName = currentGit.projectDisplayName;
    }

    if (
      currentGit.projectKind === "git" &&
      currentGit.repoRoot &&
      latestProject.rootPath !== currentGit.repoRoot
    ) {
      projectUpdates.rootPath = currentGit.repoRoot;
    }

    if (
      latestProject.kind === "git" &&
      currentGit.projectKind === "git" &&
      latestProject.displayName !== currentGit.projectDisplayName
    ) {
      projectUpdates.displayName = currentGit.projectDisplayName;
    }

    if (Object.keys(projectUpdates).length > 0) {
      const timestamp = new Date().toISOString();
      await this.projectRegistry.upsert({
        ...latestProject,
        ...projectUpdates,
        updatedAt: timestamp,
      });
      changes.push({
        kind: "project_updated",
        projectId: latestProject.projectId,
        directory: latestProject.rootPath,
        fields: projectUpdates,
      });
    }

    await Promise.all(
      siblings.map(async (workspace) => {
        const latestWorkspace = await this.workspaceRegistry.get(workspace.workspaceId);
        if (!latestWorkspace || latestWorkspace.archivedAt || !existsSync(latestWorkspace.cwd)) {
          return;
        }

        const wsDirName =
          latestWorkspace.cwd.split(/[\\/]/).findLast(Boolean) ?? latestWorkspace.cwd;
        const wsGit = await this.readWorkspaceGitMetadata(latestWorkspace.cwd, wsDirName);
        let nextWorkspaceKind: PersistedWorkspaceRecord["kind"] = "directory";
        if (wsGit.projectKind === "git") {
          nextWorkspaceKind = wsGit.isWorktree ? "worktree" : "local_checkout";
        }

        if (
          (wsGit.projectKind === "git" &&
            latestWorkspace.displayName !== wsGit.workspaceDisplayName) ||
          latestWorkspace.kind !== nextWorkspaceKind
        ) {
          const timestamp = new Date().toISOString();
          await this.workspaceRegistry.upsert({
            ...latestWorkspace,
            kind: nextWorkspaceKind,
            displayName: wsGit.workspaceDisplayName,
            updatedAt: timestamp,
          });
          changes.push({
            kind: "workspace_updated",
            workspaceId: latestWorkspace.workspaceId,
            directory: latestWorkspace.cwd,
            fields: {
              displayName: wsGit.workspaceDisplayName,
              kind: nextWorkspaceKind,
            },
          });
        }
      }),
    );
  }

  private async readWorkspaceGitMetadata(cwd: string, directoryName: string) {
    if (!this.workspaceGitService) {
      return {
        projectKind: "directory" as const,
        projectDisplayName: directoryName,
        workspaceDisplayName: directoryName,
        gitRemote: null,
        isWorktree: false,
        projectSlug: "untitled",
        repoRoot: null,
        currentBranch: null,
        remoteUrl: null,
      };
    }
    return this.workspaceGitService.getWorkspaceGitMetadata(cwd, { directoryName });
  }
}
