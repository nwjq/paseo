import path from "node:path";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import { expect, test, type Page } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import {
  archiveLocalWorkspaceFromDaemon,
  archiveWorkspaceFromDaemon,
  clickNewWorkspaceButton,
  connectNewWorkspaceDaemonClient,
  openProjectViaDaemon,
} from "./helpers/new-workspace";
import { createTempGitRepo } from "./helpers/workspace";
import { waitForSidebarHydration } from "./helpers/workspace-ui";

const SIDEBAR_WORKSPACE_ROW_PREFIX = "sidebar-workspace-row-";

function normalizePathForCompare(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function candidateWorkspaceIds(workspaceId: string): string[] {
  const trimmed = normalizePathForCompare(workspaceId);
  const candidates = new Set<string>([trimmed]);
  if (trimmed.startsWith("/var/")) {
    candidates.add(`/private${trimmed}`);
  }
  if (trimmed.startsWith("/private/var/")) {
    candidates.add(trimmed.replace(/^\/private/, ""));
  }
  return Array.from(candidates);
}

function workspaceRowLocator(page: Page, serverId: string, workspaceId: string) {
  const selector = candidateWorkspaceIds(workspaceId)
    .map((id) => `[data-testid="sidebar-workspace-row-${serverId}:${id}"]`)
    .join(",");
  return page.locator(selector).first();
}

function resolveWorkspaceKeyFromRowTestId(rowTestId: string): string {
  if (!rowTestId.startsWith(SIDEBAR_WORKSPACE_ROW_PREFIX)) {
    throw new Error(`Unexpected workspace row test id: ${rowTestId}`);
  }
  return rowTestId.slice(SIDEBAR_WORKSPACE_ROW_PREFIX.length);
}

async function readClipboardText(page: Page): Promise<string> {
  return page.evaluate(async () => navigator.clipboard.readText());
}

async function waitForNewWorkspaceId(input: {
  page: Page;
  serverId: string;
  previousWorkspaceId: string;
}): Promise<string> {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const parsed = parseHostWorkspaceRouteFromPathname(new URL(input.page.url()).pathname);
    if (
      parsed &&
      parsed.serverId === input.serverId &&
      parsed.workspaceId !== input.previousWorkspaceId
    ) {
      return parsed.workspaceId;
    }
    await input.page.waitForTimeout(250);
  }

  throw new Error(`Expected URL to redirect to a new workspace. Current URL: ${input.page.url()}`);
}

test.describe("Workspace subdirectory cwd", () => {
  test.describe.configure({ timeout: 240_000 });

  test("keeps subdirectory cwd stable and preserves it in worktree copy path", async ({ page }) => {
    const serverId = process.env.E2E_SERVER_ID;
    if (!serverId) {
      throw new Error("E2E_SERVER_ID is not set.");
    }

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    const client = await connectNewWorkspaceDaemonClient();
    const localWorkspaceIds = new Set<string>();
    const worktreeWorkspaceIds = new Set<string>();
    const repo = await createTempGitRepo("workspace-subdir-cwd-", {
      files: [{ path: "fitnexa2/README.md", content: "# Fitnexa2\n" }],
    });
    const subdirectory = path.join(repo.path, "fitnexa2");
    const subdirectoryName = path.basename(subdirectory);
    const relativeSubdirectory = normalizePathForCompare(path.relative(repo.path, subdirectory));

    try {
      const opened = await openProjectViaDaemon(client, subdirectory);
      localWorkspaceIds.add(opened.workspaceId);

      await gotoAppShell(page);
      await waitForSidebarHydration(page);

      const sourceRow = workspaceRowLocator(page, serverId, opened.workspaceId);
      await expect(sourceRow).toBeVisible({ timeout: 30_000 });
      await expect(sourceRow).toContainText(`cwd: subdir: ${relativeSubdirectory}`);

      // Repro window from user report: ~10s after add, cwd display drifted to repo root.
      await page.waitForTimeout(12_000);
      await expect(sourceRow).toContainText(`cwd: subdir: ${relativeSubdirectory}`);

      await clickNewWorkspaceButton(page, {
        projectKey: opened.projectKey,
        projectDisplayName: opened.projectDisplayName,
        prompt: `subdir-worktree-${Date.now()}`,
      });

      const createdWorkspaceId = await waitForNewWorkspaceId({
        page,
        serverId,
        previousWorkspaceId: opened.workspaceId,
      });
      worktreeWorkspaceIds.add(createdWorkspaceId);

      const createdRow = workspaceRowLocator(page, serverId, createdWorkspaceId);
      await expect(createdRow).toBeVisible({ timeout: 30_000 });
      await expect(createdRow).toContainText("cwd:");
      await expect(createdRow).toContainText(subdirectoryName);

      const normalizedCreatedWorkspacePath = normalizePathForCompare(createdWorkspaceId);
      expect(path.posix.basename(normalizedCreatedWorkspacePath)).toBe(subdirectoryName);

      await createdRow.hover();
      const createdRowTestId = await createdRow.getAttribute("data-testid");
      if (!createdRowTestId) {
        throw new Error("Missing data-testid on created workspace row");
      }
      const workspaceKey = resolveWorkspaceKeyFromRowTestId(createdRowTestId);

      const kebab = page.getByTestId(`sidebar-workspace-kebab-${workspaceKey}`).first();
      await expect(kebab).toBeVisible({ timeout: 30_000 });
      await kebab.click();

      const copyPathItem = page.getByTestId(`sidebar-workspace-menu-copy-path-${workspaceKey}`);
      await expect(copyPathItem).toBeVisible({ timeout: 30_000 });
      await copyPathItem.click();

      await expect
        .poll(async () => normalizePathForCompare(await readClipboardText(page)), {
          timeout: 10_000,
        })
        .toBe(normalizedCreatedWorkspacePath);
    } finally {
      for (const workspaceId of worktreeWorkspaceIds) {
        await archiveWorkspaceFromDaemon(client, workspaceId).catch(() => undefined);
      }
      for (const workspaceId of localWorkspaceIds) {
        await archiveLocalWorkspaceFromDaemon(client, workspaceId).catch(() => undefined);
      }
      await client.close().catch(() => undefined);
      await repo.cleanup();
    }
  });
});
