#!/usr/bin/env node
/**
 * Download the pinned GPU-less libkrun bundle (libkrun + libkrunfw dylibs, licenses,
 * manifest) from intent-hq/intentd GitHub Releases, verify its sha256, and stage it at
 * resources/microvm/ for the macOS arm64 package. electron-builder ships that directory
 * into Contents/Resources/intentd/ (mac.extraResources), next to the intentd sidecar
 * and intentd-microvm-helper — the helper resolves the dylibs from its own directory
 * (crates/intentd-microvm-helper/src/krun.rs), so no Homebrew libkrun is needed.
 *
 * Pin: libkrun-bundle.version at the repo root (see README "libkrun bundle pin").
 * Release tag: libkrun-bundle-v<pin>; the tarball's same-directory symlinks
 * (libkrun.dylib -> libkrun.<ver>.dylib, ...) are recreated as symlinks in the staging
 * dir and preserved by electron-builder's extraResources copy. The bundle's LICENSES/
 * and MANIFEST.json are staged as libkrun-bundle.LICENSES/ and
 * libkrun-bundle.MANIFEST.json so they are attributable inside the shared intentd dir.
 *
 * Env:
 *   INTENTD_READ_PAT / GH_TOKEN / GITHUB_TOKEN  optional auth token (rate limits)
 *   LIBKRUN_BUNDLE_VERSION   override the pin (<libkrun>+<libkrunfw>)
 *   LIBKRUN_BUNDLE_REPO      override the source repo (default intent-hq/intentd)
 *   LIBKRUN_BUNDLE_SKIP=1    skip staging AND remove previously staged files (the
 *                            package then ships without microVM support)
 *
 * Flags: --force re-fetches even when the staged bundle already matches the pin.
 * Off darwin-arm64 the script is a no-op (the bundle only exists for that target).
 *
 * Idempotent: a stamp file (resources/microvm/.libkrun-bundle-fetch-stamp.json)
 * records what was staged; a matching pin + staged-file hashes skips the download.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as lib from './fetch-libkrun-bundle-lib.mjs';

const FE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIN_FILE = path.join(FE_DIR, 'libkrun-bundle.version');
const DEST_DIR = path.join(FE_DIR, 'resources/microvm');
const STAMP_FILE = path.join(DEST_DIR, '.libkrun-bundle-fetch-stamp.json');
const REPO = process.env.LIBKRUN_BUNDLE_REPO?.trim() || 'intent-hq/intentd';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const STAGED_LICENSES_DIR = 'libkrun-bundle.LICENSES';
const STAGED_MANIFEST = 'libkrun-bundle.MANIFEST.json';

function authToken() {
  for (const name of ['INTENTD_READ_PAT', 'GH_TOKEN', 'GITHUB_TOKEN']) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

async function githubGet(url, accept) {
  const headers = {
    accept,
    'user-agent': 'cloudlands-fe fetch-libkrun-bundle',
    'x-github-api-version': '2022-11-28',
  };
  const token = authToken();
  if (token) headers.authorization = `Bearer ${token}`;
  // Manual redirects: asset downloads redirect to storage hosts that reject the
  // GitHub Authorization header, so drop auth when following the redirect.
  let res = await fetch(url, { headers, redirect: 'manual' });
  for (let i = 0; REDIRECT_STATUSES.has(res.status) && i < 5; i++) {
    const location = res.headers.get('location');
    if (!location) break;
    res = await fetch(location, { headers: { accept: 'application/octet-stream' } });
  }
  return res;
}

async function downloadAsset(asset) {
  const res = await githubGet(asset.url, 'application/octet-stream');
  if (!res.ok) {
    throw new Error(`Failed to download asset ${asset.name}: HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function execTar(archivePath, args) {
  return execFileSync('tar', args, { encoding: 'utf8', cwd: path.dirname(archivePath) });
}

function extractArchive(archivePath, extractDir) {
  const listing = execTar(archivePath, ['-tvf', path.basename(archivePath)]);
  const problems = lib.archiveProblems(listing);
  if (problems.length > 0) {
    throw new Error(
      `Refusing to extract ${path.basename(archivePath)}: ${problems.slice(0, 5).join('; ')}`,
    );
  }
  execTar(archivePath, [
    '-xf',
    path.basename(archivePath),
    '-C',
    path.relative(path.dirname(archivePath), extractDir),
  ]);
}

/** Directory (at any depth) that holds libkrunfw.5.dylib — the bundle root. */
function findBundleRoot(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  if (entries.some((e) => e.isFile() && e.name === 'libkrunfw.5.dylib')) return dir;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = findBundleRoot(path.join(dir, entry.name));
    if (found) return found;
  }
  return null;
}

/** Remove everything previously staged (files, symlinks, license dir, stamp). */
function clearStagingDir() {
  if (!fs.existsSync(DEST_DIR)) return;
  for (const entry of fs.readdirSync(DEST_DIR)) {
    fs.rmSync(path.join(DEST_DIR, entry), { recursive: true, force: true });
  }
}

/**
 * Copy the bundle root into DEST_DIR: regular files keep their mode, symlinks are
 * recreated with their (already validated) bare sibling target, LICENSES/ and
 * MANIFEST.json get the libkrun-bundle.* names. Returns { files, symlinks }.
 */
function stageBundle(bundleRoot) {
  const files = {};
  const symlinks = {};
  const copyTree = (srcDir, destDir, relPrefix) => {
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const src = path.join(srcDir, entry.name);
      let destName = entry.name;
      if (relPrefix === '' && entry.name === 'LICENSES') destName = STAGED_LICENSES_DIR;
      if (relPrefix === '' && entry.name === 'MANIFEST.json') destName = STAGED_MANIFEST;
      const dest = path.join(destDir, destName);
      const rel = relPrefix === '' ? destName : `${relPrefix}/${destName}`;
      const stat = fs.lstatSync(src);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(src);
        if (!lib.isSafeSymlinkTarget(target)) {
          throw new Error(`Refusing to stage symlink ${rel} -> ${target}`);
        }
        fs.symlinkSync(target, dest);
        symlinks[rel] = target;
      } else if (stat.isDirectory()) {
        copyTree(src, dest, rel);
      } else if (stat.isFile()) {
        fs.copyFileSync(src, dest);
        fs.chmodSync(dest, stat.mode & 0o777);
        files[rel] = lib.sha256Hex(fs.readFileSync(dest));
      }
    }
  };
  copyTree(bundleRoot, DEST_DIR, '');
  return { files, symlinks };
}

/** True when the stamp matches the pin and every staged file/symlink is intact. */
function stagedMatches(pin) {
  let stamp = null;
  try {
    stamp = JSON.parse(fs.readFileSync(STAMP_FILE, 'utf8'));
  } catch {
    return false;
  }
  if (stamp?.pin !== pin || !stamp.files || !stamp.symlinks) return false;
  try {
    for (const [rel, hash] of Object.entries(stamp.files)) {
      const p = path.join(DEST_DIR, rel);
      if (!fs.lstatSync(p).isFile() || lib.sha256Hex(fs.readFileSync(p)) !== hash) return false;
    }
    for (const [rel, target] of Object.entries(stamp.symlinks)) {
      const p = path.join(DEST_DIR, rel);
      if (!fs.lstatSync(p).isSymbolicLink() || fs.readlinkSync(p) !== target) return false;
    }
  } catch {
    return false;
  }
  return (
    lib.missingRequiredFiles([...Object.keys(stamp.files), ...Object.keys(stamp.symlinks)])
      .length === 0
  );
}

async function main() {
  const force = process.argv.includes('--force');

  if (process.env.LIBKRUN_BUNDLE_SKIP === '1') {
    clearStagingDir();
    fs.mkdirSync(DEST_DIR, { recursive: true });
    console.log(
      'LIBKRUN_BUNDLE_SKIP=1 — libkrun bundle not staged (package ships without microVM)',
    );
    return;
  }
  if (!lib.isBundleTarget(process.platform, process.arch)) {
    fs.mkdirSync(DEST_DIR, { recursive: true });
    console.log(
      `libkrun bundle only applies to darwin-arm64 (host is ${process.platform}-${process.arch}) — skipping`,
    );
    return;
  }

  const { pin } = process.env.LIBKRUN_BUNDLE_VERSION?.trim()
    ? lib.parseBundlePin(process.env.LIBKRUN_BUNDLE_VERSION)
    : lib.parseBundlePin(fs.readFileSync(PIN_FILE, 'utf8'));
  const tag = lib.bundleReleaseTag(pin);
  const assetName = lib.bundleAssetName();

  if (!force && stagedMatches(pin)) {
    console.log(
      `libkrun bundle ${pin} already staged at ${DEST_DIR} — skipping (use --force to re-fetch)`,
    );
    return;
  }

  console.log(`Fetching libkrun bundle ${tag} from ${REPO}...`);
  const releaseRes = await githubGet(
    `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`,
    'application/vnd.github+json',
  );
  if (releaseRes.status === 404) {
    throw new Error(
      `Release ${tag} not found in ${REPO}. Check the libkrun-bundle.version pin (and set INTENTD_READ_PAT/GH_TOKEN/GITHUB_TOKEN if the repo requires auth).`,
    );
  }
  if (!releaseRes.ok) {
    throw new Error(`GitHub API error fetching release ${tag}: HTTP ${releaseRes.status}`);
  }
  const release = await releaseRes.json();
  const assetsByName = new Map(release.assets.map((a) => [a.name, a]));
  const asset = assetsByName.get(assetName);
  if (!asset) {
    throw new Error(
      `Asset ${assetName} not found in release ${tag}. Available assets: ${release.assets.map((a) => a.name).join(', ') || '(none)'}`,
    );
  }
  const checksumName = lib.bundleChecksumAssetName(assetName);
  const checksumAsset = assetsByName.get(checksumName);
  if (!checksumAsset) {
    throw new Error(
      `Checksum asset ${checksumName} not found in release ${tag}; refusing to stage unverified dylibs`,
    );
  }

  const [archive, checksumBuf] = await Promise.all([
    downloadAsset(asset),
    downloadAsset(checksumAsset),
  ]);
  const expected = lib.parseChecksumFile(checksumBuf.toString('utf8'), assetName);
  if (!expected) {
    throw new Error(`Could not parse expected sha256 for ${assetName} from ${checksumName}`);
  }
  const actual = lib.sha256Hex(archive);
  if (actual !== expected) {
    throw new Error(`sha256 mismatch for ${assetName}: expected ${expected}, got ${actual}`);
  }
  console.log(`sha256 verified: ${actual}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'libkrun-bundle-'));
  try {
    const archivePath = path.join(tmpDir, assetName);
    fs.writeFileSync(archivePath, archive);
    const extractDir = path.join(tmpDir, 'extract');
    fs.mkdirSync(extractDir);
    extractArchive(archivePath, extractDir);
    const bundleRoot = findBundleRoot(extractDir);
    if (!bundleRoot) {
      throw new Error(`libkrunfw.5.dylib not found inside ${assetName}`);
    }
    clearStagingDir();
    const { files, symlinks } = stageBundle(bundleRoot);
    const missing = lib.missingRequiredFiles([...Object.keys(files), ...Object.keys(symlinks)]);
    if (missing.length > 0) {
      throw new Error(`Bundle ${assetName} is missing required files: ${missing.join(', ')}`);
    }
    fs.writeFileSync(
      STAMP_FILE,
      `${JSON.stringify(
        {
          pin,
          tag,
          target: lib.LIBKRUN_BUNDLE_TARGET,
          asset: assetName,
          sha256: actual,
          files,
          symlinks,
          fetchedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`Staged libkrun bundle ${pin} at ${DEST_DIR}`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
