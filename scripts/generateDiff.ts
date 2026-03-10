/**
 * scripts/generateDiff.ts
 *
 * Cross-platform git summary generator for AI-assisted commits.
 * Mirrors the PowerShell workflow while staying shell-agnostic.
 *
 * Usage:
 *   npm run diff:log
 *   npm run diff:log -- --output-root logs/git-summary --include-tracked-snapshots
 */

import { spawnSync } from "child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { fileURLToPath } from "url"
import path from "path"

type GitResult = {
  exitCode: number
  outputLines: string[]
}

type RuntimeInfo = {
  os: string
  shell: string
  commandStrategy: string
}

type NumStat = {
  added: string
  deleted: string
}

type FileRecord = {
  path: string
  indexStatus: string
  workTreeStatus: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  directoryGroup: string
  filenameGroup: string
  fileKind: string
  stagedAdded: string
  stagedDeleted: string
  unstagedAdded: string
  unstagedDeleted: string
  stagedDiffFile: string
  unstagedDiffFile: string
  snapshotFile: string
}

type Options = {
  outputRoot: string
  includeTrackedSnapshots: boolean
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "..")
const gitBaseArgs = ["-c", "safe.directory=*"]

function writeStep(message: string): void {
  console.log(`[git-summary] ${message}`)
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    outputRoot: "logs/git-summary",
    includeTrackedSnapshots: false
  }

  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx]
    if (arg === "--include-tracked-snapshots") {
      options.includeTrackedSnapshots = true
      continue
    }

    if (arg === "--output-root") {
      const next = argv[idx + 1]
      if (!next) {
        throw new Error("Missing value for --output-root")
      }
      options.outputRoot = next
      idx += 1
      continue
    }

    if (arg.startsWith("--output-root=")) {
      options.outputRoot = arg.slice("--output-root=".length)
      continue
    }
  }

  return options
}

function toPosixPath(input: string): string {
  return input.replace(/\\/g, "/")
}

function detectRuntime(): RuntimeInfo {
  const platform = process.platform
  const shellEnv = process.env.SHELL ?? process.env.ComSpec ?? process.env.TERM_PROGRAM ?? "unknown"
  const shellLower = shellEnv.toLowerCase()

  let shell = "UnknownShell"
  if (process.env.PSModulePath && platform === "win32") shell = "PowerShell"
  else if (shellLower.includes("zsh")) shell = "zsh"
  else if (shellLower.includes("bash")) shell = "bash"
  else if (shellLower.includes("fish")) shell = "fish"
  else if (shellLower.includes("pwsh") || shellLower.includes("powershell")) shell = "PowerShell"
  else if (shellLower.includes("cmd.exe")) shell = "cmd.exe"

  const os = platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : platform
  const commandStrategy = platform === "win32"
    ? "spawn git.exe with args (no shell wrapping)"
    : "spawn git with args (no shell wrapping)"

  return { os, shell, commandStrategy }
}

function newSlug(value: string): string {
  if (!value.trim()) return "unknown"
  const slug = value
    .replace(/[\\/:\*?"<>|]+/g, "__")
    .replace(/\s+/g, "-")
    .replace(/^\.+|\.+$/g, "")
  return slug.trim() || "unknown"
}

function runGit(argumentsList: string[], allowFailure = false): GitResult {
  const result = spawnSync("git", [...gitBaseArgs, ...argumentsList], {
    cwd: repoRoot,
    encoding: "utf-8",
    shell: false,
    maxBuffer: 20 * 1024 * 1024
  })

  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
  const lines = combined ? combined.split(/\r?\n/) : []
  const exitCode = result.status ?? 1

  if (exitCode !== 0 && !allowFailure) {
    throw new Error(`git ${argumentsList.join(" ")} failed:\n${combined}`)
  }

  return { exitCode, outputLines: lines }
}

function getTrackedDiffLines(mode: "staged" | "unstaged"): string[] {
  if (mode === "staged") {
    return runGit(["diff", "--cached", "--name-status", "--find-renames=90%"]).outputLines
  }
  return runGit(["diff", "--name-status", "--find-renames=90%"]).outputLines
}

function getNumStatMap(mode: "staged" | "unstaged"): Record<string, NumStat> {
  const map: Record<string, NumStat> = {}
  const args = mode === "staged"
    ? ["diff", "--cached", "--numstat", "--find-renames=90%"]
    : ["diff", "--numstat", "--find-renames=90%"]

  for (const line of runGit(args).outputLines) {
    if (!line.trim()) continue
    const parts = line.split("\t")
    if (parts.length < 3) continue

    const filePath = parts[parts.length - 1]
    map[filePath] = {
      added: parts[0],
      deleted: parts[1]
    }
  }

  return map
}

function getDirectoryGroup(filePath: string): string {
  const parts = toPosixPath(filePath).split("/")
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}`
  return parts[0]
}

function getFilenameGroup(filePath: string): string {
  const baseName = path.parse(filePath).name
  return baseName.replace(/\.(test|spec)$/i, "").replace(/\.(routes|route)$/i, "")
}

function getFileKind(filePath: string): string {
  const lower = toPosixPath(filePath).toLowerCase()
  if (lower.startsWith("src/")) return "source"
  if (lower.startsWith("tests/")) return "test"
  if (lower.startsWith("docs/")) return "docs"
  if (lower.startsWith("scripts/")) return "script"
  if (lower.startsWith("tools/")) return "tooling"
  return "other"
}

function ensureDirectory(targetPath: string): void {
  if (!existsSync(targetPath)) {
    mkdirSync(targetPath, { recursive: true })
  }
}

function writeUtf8File(targetPath: string, content: string): void {
  writeFileSync(targetPath, content, { encoding: "utf-8" })
}

function exportTrackedDiff(filePath: string, mode: "staged" | "unstaged", targetDirectory: string): string {
  const slug = newSlug(filePath)
  const fileName = mode === "staged" ? `staged__${slug}.diff.txt` : `unstaged__${slug}.diff.txt`
  const target = path.join(targetDirectory, fileName)

  const args = ["diff", "--unified=3", "--find-renames=90%"]
  if (mode === "staged") args.push("--cached")
  args.push("--", filePath)

  const content = runGit(args, true).outputLines.join("\n")
  writeUtf8File(target, content)
  return target
}

function exportSnapshot(filePath: string, targetDirectory: string): string {
  const absolutePath = path.join(repoRoot, filePath)
  const slug = newSlug(filePath)
  const target = path.join(targetDirectory, `untracked__${slug}.snapshot.txt`)

  if (!existsSync(absolutePath)) {
    writeUtf8File(target, `File not found: ${filePath}`)
    return target
  }

  try {
    const content = readFileSync(absolutePath, "utf-8")
    writeUtf8File(target, content)
  } catch {
    writeUtf8File(target, `Binary or unreadable file: ${filePath}`)
  }

  return target
}

function parseStatusRecord(line: string): { indexStatus: string; workTreeStatus: string; filePath: string } | null {
  if (!line.trim() || line.length < 4) return null

  const indexStatus = line.slice(0, 1)
  const workTreeStatus = line.slice(1, 2)
  let filePath = line.slice(3).trim()
  if (filePath.includes(" -> ")) {
    const parts = filePath.split(" -> ")
    filePath = parts[parts.length - 1].trim()
  }

  return { indexStatus, workTreeStatus, filePath }
}

function sortByCountThenName<T extends { name: string; count: number }>(a: T, b: T): number {
  if (b.count !== a.count) return b.count - a.count
  return a.name.localeCompare(b.name)
}

function collectRepoState(outputRootPosix: string): {
  branch: string
  head: string
  statusShort: string[]
  statusPorcelain: string[]
  diffStatUnstaged: string[]
  diffStatStaged: string[]
  changedUnstaged: string[]
  changedStaged: string[]
  untracked: string[]
  unstagedNumStats: Record<string, NumStat>
  stagedNumStats: Record<string, NumStat>
  unstagedNameStatus: string[]
  stagedNameStatus: string[]
  fullUnstagedDiff: string
  fullStagedDiff: string
} {
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]).outputLines.join("")
  const head = runGit(["rev-parse", "--short", "HEAD"]).outputLines.join("")
  const statusShortRaw = runGit(["status", "--short"]).outputLines
  const statusPorcelainRaw = runGit(["status", "--porcelain=v1"]).outputLines
  const diffStatUnstaged = runGit(["diff", "--stat", "--find-renames=90%"]).outputLines
  const diffStatStaged = runGit(["diff", "--cached", "--stat", "--find-renames=90%"]).outputLines
  const changedUnstaged = runGit(["diff", "--name-only", "--find-renames=90%"]).outputLines
  const changedStaged = runGit(["diff", "--cached", "--name-only", "--find-renames=90%"]).outputLines
  const untracked = runGit(["ls-files", "--others", "--exclude-standard"]).outputLines
  const unstagedNumStats = getNumStatMap("unstaged")
  const stagedNumStats = getNumStatMap("staged")
  const unstagedNameStatus = getTrackedDiffLines("unstaged")
  const stagedNameStatus = getTrackedDiffLines("staged")
  const fullUnstagedDiff = runGit(["diff", "--find-renames=90%"], true).outputLines.join("\n")
  const fullStagedDiff = runGit(["diff", "--cached", "--find-renames=90%"], true).outputLines.join("\n")

  const shouldExclude = (entry: string): boolean => {
    const normalized = toPosixPath(entry)
    return normalized.startsWith(`${outputRootPosix}/`) || normalized === outputRootPosix || normalized === "logs"
  }

  return {
    branch,
    head,
    statusShort: statusShortRaw.filter((line) => !shouldExclude(line.slice(3).trim())),
    statusPorcelain: statusPorcelainRaw.filter((line) => {
      const parsed = parseStatusRecord(line)
      if (!parsed) return false
      return !shouldExclude(parsed.filePath)
    }),
    diffStatUnstaged,
    diffStatStaged,
    changedUnstaged,
    changedStaged,
    untracked: untracked.filter((entry) => !shouldExclude(entry)),
    unstagedNumStats,
    stagedNumStats,
    unstagedNameStatus,
    stagedNameStatus,
    fullUnstagedDiff,
    fullStagedDiff
  }
}

function buildFileRecords(
  statusPorcelain: string[],
  stagedNumStats: Record<string, NumStat>,
  unstagedNumStats: Record<string, NumStat>
): Map<string, FileRecord> {
  const records = new Map<string, FileRecord>()

  for (const line of statusPorcelain) {
    const parsed = parseStatusRecord(line)
    if (!parsed) continue

    records.set(parsed.filePath, {
      path: parsed.filePath,
      indexStatus: parsed.indexStatus,
      workTreeStatus: parsed.workTreeStatus,
      staged: parsed.indexStatus !== " " && parsed.indexStatus !== "?",
      unstaged: parsed.workTreeStatus !== " ",
      untracked: parsed.indexStatus === "?" && parsed.workTreeStatus === "?",
      directoryGroup: getDirectoryGroup(parsed.filePath),
      filenameGroup: getFilenameGroup(parsed.filePath),
      fileKind: getFileKind(parsed.filePath),
      stagedAdded: "",
      stagedDeleted: "",
      unstagedAdded: "",
      unstagedDeleted: "",
      stagedDiffFile: "",
      unstagedDiffFile: "",
      snapshotFile: ""
    })
  }

  for (const [filePath, record] of records.entries()) {
    if (stagedNumStats[filePath]) {
      record.stagedAdded = stagedNumStats[filePath].added
      record.stagedDeleted = stagedNumStats[filePath].deleted
    }

    if (unstagedNumStats[filePath]) {
      record.unstagedAdded = unstagedNumStats[filePath].added
      record.unstagedDeleted = unstagedNumStats[filePath].deleted
    }
  }

  return records
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  const runtime = detectRuntime()
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "-")

  const outputRootPosix = toPosixPath(options.outputRoot).replace(/^\.?\//, "")
  const outputRootAbs = path.join(repoRoot, outputRootPosix)
  const sessionDir = path.join(outputRootAbs, timestamp)
  const filesDir = path.join(sessionDir, "files")

  writeStep(`Runtime detected: OS=${runtime.os}, Shell=${runtime.shell}`)
  writeStep(`Command strategy: ${runtime.commandStrategy}`)
  writeStep(`Repo root: ${repoRoot}`)

  const state = collectRepoState(outputRootPosix)
  const records = buildFileRecords(state.statusPorcelain, state.stagedNumStats, state.unstagedNumStats)

  ensureDirectory(sessionDir)
  ensureDirectory(filesDir)

  writeUtf8File(path.join(sessionDir, "status-short.txt"), state.statusShort.join("\n"))
  writeUtf8File(path.join(sessionDir, "status-porcelain.txt"), state.statusPorcelain.join("\n"))
  writeUtf8File(path.join(sessionDir, "diff-stat-unstaged.txt"), state.diffStatUnstaged.join("\n"))
  writeUtf8File(path.join(sessionDir, "diff-stat-staged.txt"), state.diffStatStaged.join("\n"))
  writeUtf8File(path.join(sessionDir, "changed-files-unstaged.txt"), state.changedUnstaged.join("\n"))
  writeUtf8File(path.join(sessionDir, "changed-files-staged.txt"), state.changedStaged.join("\n"))
  writeUtf8File(path.join(sessionDir, "name-status-unstaged.txt"), state.unstagedNameStatus.join("\n"))
  writeUtf8File(path.join(sessionDir, "name-status-staged.txt"), state.stagedNameStatus.join("\n"))

  for (const record of records.values()) {
    if (record.staged) {
      record.stagedDiffFile = exportTrackedDiff(record.path, "staged", filesDir)
    }

    if (record.unstaged && !record.untracked) {
      record.unstagedDiffFile = exportTrackedDiff(record.path, "unstaged", filesDir)
    }

    if (record.untracked || options.includeTrackedSnapshots) {
      record.snapshotFile = exportSnapshot(record.path, filesDir)
    }
  }

  writeUtf8File(path.join(sessionDir, "full-unstaged.diff.txt"), state.fullUnstagedDiff)
  writeUtf8File(path.join(sessionDir, "full-staged.diff.txt"), state.fullStagedDiff)

  const recordList = Array.from(records.values()).sort((a, b) => a.path.localeCompare(b.path))

  const directoryGroupMap = new Map<string, FileRecord[]>()
  for (const record of recordList) {
    if (!directoryGroupMap.has(record.directoryGroup)) {
      directoryGroupMap.set(record.directoryGroup, [])
    }
    directoryGroupMap.get(record.directoryGroup)?.push(record)
  }

  const directoryGroups = Array.from(directoryGroupMap.entries())
    .map(([name, items]) => ({ name, count: items.length, items }))
    .sort(sortByCountThenName)

  const filenameGroupMap = new Map<string, FileRecord[]>()
  for (const record of recordList) {
    if (!filenameGroupMap.has(record.filenameGroup)) {
      filenameGroupMap.set(record.filenameGroup, [])
    }
    filenameGroupMap.get(record.filenameGroup)?.push(record)
  }

  const filenameGroups = Array.from(filenameGroupMap.entries())
    .map(([name, items]) => ({ name, count: items.length, items }))
    .filter((group) => group.count > 1)
    .sort(sortByCountThenName)

  const now = new Date()
  const generatedAt = now.toISOString()
  const generatedAtHuman = `${generatedAt.slice(0, 10)} ${generatedAt.slice(11, 19)}`

  const summaryLines: string[] = []
  summaryLines.push("# Git Summary", "")
  summaryLines.push(`- GeneratedAt: ${generatedAtHuman}`)
  summaryLines.push(`- OS: ${runtime.os}`)
  summaryLines.push(`- Shell: ${runtime.shell}`)
  summaryLines.push(`- CommandStrategy: ${runtime.commandStrategy}`)
  summaryLines.push(`- RepoRoot: ${repoRoot}`)
  summaryLines.push(`- Branch: ${state.branch}`)
  summaryLines.push(`- HEAD: ${state.head}`)
  summaryLines.push(`- SessionDir: ${sessionDir}`)
  summaryLines.push(`- ChangedFiles: ${recordList.length}`)
  summaryLines.push(`- UntrackedFiles: ${recordList.filter((entry) => entry.untracked).length}`, "")
  summaryLines.push("## Status", "")

  if (state.statusShort.length === 0) {
    summaryLines.push("Working tree is clean.")
  } else {
    for (const line of state.statusShort) {
      summaryLines.push(`- ${line}`)
    }
  }

  summaryLines.push("", "## Files", "")
  for (const record of recordList) {
    summaryLines.push(`### ${record.path}`)
    summaryLines.push(`- Kind: ${record.fileKind}`)
    summaryLines.push(`- DirectoryGroup: ${record.directoryGroup}`)
    summaryLines.push(`- FilenameGroup: ${record.filenameGroup}`)
    summaryLines.push(`- IndexStatus: ${record.indexStatus}`)
    summaryLines.push(`- WorkTreeStatus: ${record.workTreeStatus}`)
    summaryLines.push(`- Staged: ${record.staged}`)
    summaryLines.push(`- Unstaged: ${record.unstaged}`)
    summaryLines.push(`- Untracked: ${record.untracked}`)
    if (record.stagedAdded || record.stagedDeleted) {
      summaryLines.push(`- StagedNumstat: +${record.stagedAdded} / -${record.stagedDeleted}`)
    }
    if (record.unstagedAdded || record.unstagedDeleted) {
      summaryLines.push(`- UnstagedNumstat: +${record.unstagedAdded} / -${record.unstagedDeleted}`)
    }
    if (record.stagedDiffFile) {
      summaryLines.push(`- StagedDiffFile: ${record.stagedDiffFile}`)
    }
    if (record.unstagedDiffFile) {
      summaryLines.push(`- UnstagedDiffFile: ${record.unstagedDiffFile}`)
    }
    if (record.snapshotFile) {
      summaryLines.push(`- SnapshotFile: ${record.snapshotFile}`)
    }
    summaryLines.push("")
  }
  writeUtf8File(path.join(sessionDir, "summary.md"), summaryLines.join("\n"))

  const directoryLines: string[] = ["# Directory Groups", ""]
  for (const group of directoryGroups) {
    directoryLines.push(`## ${group.name} (${group.count} files)`)
    for (const item of group.items.sort((a, b) => a.path.localeCompare(b.path))) {
      directoryLines.push(`- ${item.path}`)
    }
    directoryLines.push("")
  }
  writeUtf8File(path.join(sessionDir, "directory-groups.md"), directoryLines.join("\n"))

  const filenameLines: string[] = ["# Filename Groups", ""]
  if (filenameGroups.length === 0) {
    filenameLines.push("No repeated filename groups were detected.")
  } else {
    for (const group of filenameGroups) {
      filenameLines.push(`## ${group.name} (${group.count} files)`)
      for (const item of group.items.sort((a, b) => a.path.localeCompare(b.path))) {
        filenameLines.push(`- ${item.path}`)
      }
      filenameLines.push("")
    }
  }
  writeUtf8File(path.join(sessionDir, "filename-groups.md"), filenameLines.join("\n"))

  const summaryJson = {
    generatedAt,
    os: runtime.os,
    shell: runtime.shell,
    commandStrategy: runtime.commandStrategy,
    repoRoot,
    branch: state.branch,
    head: state.head,
    sessionDir,
    changedFiles: recordList
  }
  writeUtf8File(path.join(sessionDir, "summary.json"), JSON.stringify(summaryJson, null, 2))

  const aiBriefLines: string[] = [
    "# AI Brief",
    "",
    "Use the generated files in this folder to propose commit groupings and commit messages.",
    "",
    "Rules:",
    "- Prefer 3-4 files minimum per commit when reasonable.",
    "- Allow 1-file commits only when the change is critical or conceptually isolated.",
    "- Do not mix unrelated implementations.",
    "- Use conventional commits when they improve clarity.",
    "",
    "Read in this order:",
    "1. summary.md",
    "2. directory-groups.md",
    "3. filename-groups.md",
    "4. summary.json",
    "5. Individual diff files under ./files",
    "",
    "Deliver:",
    "1. Proposed commit groups with rationale.",
    "2. File list per commit, with no overlaps.",
    "3. Suggested commit messages.",
    "4. Explicit callout of any single-file commit that should remain isolated.",
    "",
    `SessionDir: ${sessionDir}`
  ]
  writeUtf8File(path.join(sessionDir, "ai-brief.md"), aiBriefLines.join("\n"))

  writeUtf8File(path.join(outputRootAbs, "latest.txt"), sessionDir)

  const previewLines: string[] = []
  previewLines.push(`OS: ${runtime.os}`)
  previewLines.push(`Shell: ${runtime.shell}`)
  previewLines.push(`Branch: ${state.branch}`)
  previewLines.push(`HEAD: ${state.head}`)
  previewLines.push(`Session: ${sessionDir}`)
  previewLines.push(`Changed files: ${recordList.length}`)
  previewLines.push(`Untracked files: ${recordList.filter((entry) => entry.untracked).length}`, "")
  previewLines.push("Top directory groups:")
  for (const group of directoryGroups.slice(0, 8)) {
    previewLines.push(`- ${group.name}: ${group.count}`)
  }
  previewLines.push("")
  previewLines.push(`Read next: ${path.join(sessionDir, "summary.md")}`)
  previewLines.push(`AI brief: ${path.join(sessionDir, "ai-brief.md")}`)

  writeStep("Summary generated.")
  for (const line of previewLines) {
    console.log(line)
  }
}

main()