class GitHubApiError extends Error {
  constructor({ status, method, pathname, message }) {
    super(`${method} ${pathname} failed with ${status}: ${message}`);
    this.name = "GitHubApiError";
    this.status = status;
    this.method = method;
    this.pathname = pathname;
  }
}

function usageAndExit(code = 1) {
  process.stderr.write(
    "Usage: node scripts/prune-github-releases.mjs [--repo owner/repo] [--keep 10] [--dry-run]\n",
  );
  process.exit(code);
}

function parsePositiveInteger(rawValue, label) {
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}: ${rawValue}`);
  }
  return value;
}

function parseArgs(argv) {
  let repo = process.env.GITHUB_REPOSITORY ?? "";
  let keep = 10;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") {
      repo = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--keep") {
      keep = parsePositiveInteger(argv[index + 1] ?? "", "keep count");
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usageAndExit(0);
    }
    usageAndExit();
  }

  if (!repo || !repo.includes("/")) {
    throw new Error(`Invalid repo: "${repo}". Expected owner/repo.`);
  }

  return { repo, keep, dryRun };
}

async function githubApi(pathname, { method = "GET" } = {}) {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
  if (!token) {
    throw new Error("Missing GITHUB_TOKEN or GH_TOKEN.");
  }

  const response = await fetch(`https://api.github.com/${pathname}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2026-03-10",
    },
  });

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new GitHubApiError({
      status: response.status,
      method,
      pathname,
      message: payload?.message ?? response.statusText,
    });
  }

  return payload;
}

async function listReleases(owner, repo) {
  const releases = [];

  for (let page = 1; ; page += 1) {
    const batch = await githubApi(`repos/${owner}/${repo}/releases?per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }
    releases.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }

  return releases;
}

function sortByCreationDateDesc(releases) {
  return [...releases].sort((left, right) => {
    const leftTime = Date.parse(left.created_at ?? left.published_at ?? 0);
    const rightTime = Date.parse(right.created_at ?? right.published_at ?? 0);
    return rightTime - leftTime;
  });
}

function describeRelease(release) {
  const parts = [release.tag_name ?? `release-${release.id}`];
  if (release.name && release.name !== release.tag_name) {
    parts.push(`name="${release.name}"`);
  }
  if (release.created_at) {
    parts.push(`created=${release.created_at}`);
  }
  if (release.prerelease) {
    parts.push("prerelease");
  }
  return parts.join(" ");
}

async function deleteRelease(owner, repo, release) {
  await githubApi(`repos/${owner}/${repo}/releases/${release.id}`, { method: "DELETE" });
}

async function deleteTag(owner, repo, tagName) {
  if (!tagName) {
    return;
  }

  await githubApi(`repos/${owner}/${repo}/git/refs/tags/${encodeURIComponent(tagName)}`, {
    method: "DELETE",
  });
}

async function main() {
  const { repo, keep, dryRun } = parseArgs(process.argv.slice(2));
  const [owner, name] = repo.split("/", 2);
  const releases = await listReleases(owner, name);
  const candidates = sortByCreationDateDesc(
    releases.filter((release) => !release.draft && !release.immutable),
  );
  const preserved = candidates.slice(0, keep);
  const stale = candidates.slice(keep);
  const skipped = releases.filter((release) => release.draft || release.immutable);

  process.stdout.write(
    [
      `Repo: ${repo}`,
      `Published releases found: ${candidates.length}`,
      `Keeping newest: ${preserved.length}`,
      `Deleting: ${stale.length}`,
      `Skipped drafts/immutable: ${skipped.length}`,
      `Mode: ${dryRun ? "dry-run" : "delete"}`,
    ].join("\n") + "\n",
  );

  if (stale.length === 0) {
    process.stdout.write("Nothing to delete.\n");
    return;
  }

  for (const release of stale) {
    process.stdout.write(
      `${dryRun ? "[dry-run] Would delete" : "Deleting"} ${describeRelease(release)}\n`,
    );
    if (dryRun) {
      continue;
    }

    await deleteRelease(owner, name, release);

    try {
      await deleteTag(owner, name, release.tag_name);
      process.stdout.write(`Deleted tag ${release.tag_name}\n`);
    } catch (error) {
      if (error instanceof GitHubApiError && (error.status === 404 || error.status === 422)) {
        process.stdout.write(`Tag ${release.tag_name} was already missing, continuing.\n`);
        continue;
      }
      throw error;
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
