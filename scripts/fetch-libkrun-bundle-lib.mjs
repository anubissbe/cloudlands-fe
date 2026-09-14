/**
 * Pure helpers for scripts/fetch-libkrun-bundle.mjs — side-effect free so they can be
 * unit-tested with vitest (scripts/fetch-libkrun-bundle-lib.test.ts).
 *
 * The bundle is published by intent-hq/intentd's libkrun-bundle.yml workflow as a
 * GitHub Release tagged `libkrun-bundle-v<libkrun>+<libkrunfw>` with the assets
 * `libkrun-bundle-<target>.tar.gz`, `<asset>.sha256` and `<asset-stem>.MANIFEST.json`.
 * The tarball holds one top-level directory with the real dylibs
 * (`libkrun.<ver>.dylib`, `libkrunfw.5.dylib`), same-directory symlinks for the names
 * the helper dlopens (`libkrun.dylib`, `libkrun.1.dylib`, `libkrunfw.dylib`),
 * `MANIFEST.json` and `LICENSES/`.
 */
import { isSafeArchiveEntry, parseChecksumFile, sha256Hex } from './fetch-sidecar-lib.mjs';

export { isSafeArchiveEntry, parseChecksumFile, sha256Hex };

export const LIBKRUN_BUNDLE_APP_NAME = 'libkrun-bundle';

/** The only target the bundle is built for (Hypervisor.framework on Apple Silicon). */
export const LIBKRUN_BUNDLE_TARGET = 'aarch64-apple-darwin';

/**
 * Files the helper needs at runtime: libkrun dlopens `libkrunfw.5.dylib` by bare leaf
 * name from its own directory, and the helper tries `libkrun.dylib` then
 * `libkrun.1.dylib` (crates/intentd-microvm-helper/src/krun.rs).
 */
export const REQUIRED_BUNDLE_FILES = ['libkrun.dylib', 'libkrunfw.5.dylib'];

/** True when the bundle applies to a Node platform/arch pair (darwin-arm64 only). */
export function isBundleTarget(platform, arch) {
  return platform === 'darwin' && arch === 'arm64';
}

/**
 * Parse the libkrun-bundle.version pin: `#`-comment and blank lines are ignored; the
 * remaining line must be `<libkrun semver>+<libkrunfw semver>` (no leading `v`).
 */
export function parseBundlePin(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (lines.length !== 1) {
    throw new Error(
      `libkrun-bundle.version must contain exactly one version line, found ${lines.length}`,
    );
  }
  const pin = lines[0];
  const match = pin.match(/^(\d+\.\d+\.\d+)\+(\d+\.\d+\.\d+)$/);
  if (!match) {
    throw new Error(
      `Invalid libkrun bundle pin "${pin}" (expected <libkrun>+<libkrunfw>, e.g. 1.19.4+5.5.0, no leading "v")`,
    );
  }
  return { pin, libkrun: match[1], libkrunfw: match[2] };
}

/** Release tag for a pin (`libkrun-bundle-v1.19.4+5.5.0`). */
export function bundleReleaseTag(pin) {
  return `${LIBKRUN_BUNDLE_APP_NAME}-v${pin}`;
}

/** Tarball asset name for a target. */
export function bundleAssetName(target = LIBKRUN_BUNDLE_TARGET) {
  return `${LIBKRUN_BUNDLE_APP_NAME}-${target}.tar.gz`;
}

/** The release publishes a per-asset checksum file named `<asset>.sha256`. */
export function bundleChecksumAssetName(assetName) {
  return `${assetName}.sha256`;
}

/**
 * Classify a verbose `tar -tvf` listing line. Symlinks are legitimate in this archive
 * (the helper dlopens the unversioned names), but only same-directory links to a
 * bare file name are accepted: anything with a path separator, `..`, or an absolute
 * target could redirect extraction writes outside the target directory.
 * Returns `{ kind: 'file' | 'dir' | 'symlink' | 'other', entry, target? }`.
 */
export function classifyListingLine(line) {
  const trimmed = line.trimEnd();
  if (trimmed.length === 0) return null;
  const type = trimmed[0];
  if (type === 'l') {
    const match = trimmed.match(/\s(\S+)\s->\s(.+)$/);
    if (!match) return { kind: 'other', entry: trimmed };
    return { kind: 'symlink', entry: match[1], target: match[2] };
  }
  const entry = trimmed.split(/\s+/).slice(8).join(' ') || trimmed;
  if (type === 'd') return { kind: 'dir', entry };
  if (type === '-') return { kind: 'file', entry };
  return { kind: 'other', entry };
}

/** True when a symlink target is a bare sibling file name (no separators, not `..`). */
export function isSafeSymlinkTarget(target) {
  if (typeof target !== 'string' || target.length === 0) return false;
  if (target === '.' || target === '..') return false;
  return !/[\\/]/.test(target);
}

/**
 * Validate every entry of a verbose listing. Returns a list of human-readable problems
 * (empty when the archive is safe to extract).
 */
export function archiveProblems(listing) {
  const problems = [];
  for (const line of listing.split('\n')) {
    const item = classifyListingLine(line);
    if (!item) continue;
    if (!isSafeArchiveEntry(item.entry)) {
      problems.push(`unsafe entry path: ${item.entry}`);
      continue;
    }
    if (item.kind === 'symlink' && !isSafeSymlinkTarget(item.target)) {
      problems.push(`unsafe symlink target: ${item.entry} -> ${item.target}`);
    } else if (item.kind === 'other') {
      problems.push(`unsupported entry type: ${item.entry}`);
    }
  }
  return problems;
}

/**
 * Names missing from a staged file set that the helper requires at runtime.
 * `names` may include symlink names (they resolve at dlopen time).
 */
export function missingRequiredFiles(names) {
  const present = new Set(names);
  return REQUIRED_BUNDLE_FILES.filter((name) => !present.has(name));
}
