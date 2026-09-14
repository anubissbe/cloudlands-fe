import { describe, expect, it } from 'vitest';
import {
  LIBKRUN_BUNDLE_TARGET,
  REQUIRED_BUNDLE_FILES,
  archiveProblems,
  bundleAssetName,
  bundleChecksumAssetName,
  bundleReleaseTag,
  classifyListingLine,
  isBundleTarget,
  isSafeSymlinkTarget,
  missingRequiredFiles,
  parseBundlePin,
  parseChecksumFile,
  sha256Hex,
} from './fetch-libkrun-bundle-lib.mjs';

const HASH = 'a'.repeat(64);

describe('parseBundlePin', () => {
  it('parses the pin, ignoring comments and blank lines', () => {
    expect(parseBundlePin('# comment\n\n1.19.4+5.5.0\n')).toEqual({
      pin: '1.19.4+5.5.0',
      libkrun: '1.19.4',
      libkrunfw: '5.5.0',
    });
  });

  it('rejects a leading v, a missing libkrunfw half, and multiple version lines', () => {
    expect(() => parseBundlePin('v1.19.4+5.5.0')).toThrow(/Invalid libkrun bundle pin/);
    expect(() => parseBundlePin('1.19.4')).toThrow(/expected <libkrun>\+<libkrunfw>/);
    expect(() => parseBundlePin('1.19.4+5.5.0\n1.19.5+5.5.0')).toThrow(/exactly one version line/);
    expect(() => parseBundlePin('# only comments\n')).toThrow(/found 0/);
  });
});

describe('release naming', () => {
  it('derives the tag and asset names the libkrun-bundle workflow publishes', () => {
    expect(bundleReleaseTag('1.19.4+5.5.0')).toBe('libkrun-bundle-v1.19.4+5.5.0');
    expect(bundleAssetName()).toBe('libkrun-bundle-aarch64-apple-darwin.tar.gz');
    expect(bundleAssetName('x86_64-apple-darwin')).toBe(
      'libkrun-bundle-x86_64-apple-darwin.tar.gz',
    );
    expect(bundleChecksumAssetName(bundleAssetName())).toBe(
      'libkrun-bundle-aarch64-apple-darwin.tar.gz.sha256',
    );
    expect(LIBKRUN_BUNDLE_TARGET).toBe('aarch64-apple-darwin');
  });

  it('only applies to darwin-arm64 hosts', () => {
    expect(isBundleTarget('darwin', 'arm64')).toBe(true);
    expect(isBundleTarget('darwin', 'x64')).toBe(false);
    expect(isBundleTarget('linux', 'arm64')).toBe(false);
    expect(isBundleTarget('win32', 'x64')).toBe(false);
  });
});

describe('checksum verification', () => {
  it('accepts the sha256sum-style checksum file the workflow publishes', () => {
    const asset = bundleAssetName();
    expect(parseChecksumFile(`${HASH} *${asset}\n`, asset)).toBe(HASH);
    expect(parseChecksumFile(`${HASH}  ${asset}\n`, asset)).toBe(HASH);
  });

  it('returns null for a checksum file naming a different asset, so the fetch fails closed', () => {
    expect(parseChecksumFile(`${HASH} *other.tar.gz\n`, bundleAssetName())).toBeNull();
  });

  it('detects a tampered archive by digest mismatch', () => {
    const good = Buffer.from('bundle bytes');
    const expected = sha256Hex(good);
    expect(sha256Hex(Buffer.from('bundle bytes!'))).not.toBe(expected);
    expect(sha256Hex(good)).toBe(expected);
  });
});

describe('archive safety', () => {
  const ROOT = 'libkrun-bundle-aarch64-apple-darwin';
  const listing = [
    `drwxr-xr-x  0 runner staff       0 Sep 14 16:28 ${ROOT}/`,
    `-rwxr-xr-x  0 runner staff 5494240 Sep 14 16:28 ${ROOT}/libkrun.1.19.4.dylib`,
    `lrwxr-xr-x  0 runner staff       0 Sep 14 16:28 ${ROOT}/libkrun.dylib -> libkrun.1.19.4.dylib`,
    `lrwxr-xr-x  0 runner staff       0 Sep 14 16:28 ${ROOT}/libkrun.1.dylib -> libkrun.1.19.4.dylib`,
    `-rwxr-xr-x  0 runner staff 24357200 Sep 14 16:28 ${ROOT}/libkrunfw.5.dylib`,
    `-rw-r--r--  0 runner staff    1927 Sep 14 16:28 ${ROOT}/MANIFEST.json`,
    `-rw-r--r--  0 runner staff   11358 Sep 14 16:28 ${ROOT}/LICENSES/libkrun.LICENSE`,
  ].join('\n');

  it('classifies files, dirs and symlinks from a verbose tar listing', () => {
    expect(classifyListingLine(listing.split('\n')[0])).toEqual({ kind: 'dir', entry: `${ROOT}/` });
    expect(classifyListingLine(listing.split('\n')[1])).toEqual({
      kind: 'file',
      entry: `${ROOT}/libkrun.1.19.4.dylib`,
    });
    expect(classifyListingLine(listing.split('\n')[2])).toEqual({
      kind: 'symlink',
      entry: `${ROOT}/libkrun.dylib`,
      target: 'libkrun.1.19.4.dylib',
    });
    expect(classifyListingLine('')).toBeNull();
  });

  it('accepts the published bundle layout', () => {
    expect(archiveProblems(listing)).toEqual([]);
  });

  it('rejects symlinks that escape the bundle directory', () => {
    const bad = `${listing}\nlrwxr-xr-x  0 runner staff 0 Sep 14 16:28 ${ROOT}/evil.dylib -> ../../outside.dylib`;
    expect(archiveProblems(bad)).toEqual([
      `unsafe symlink target: ${ROOT}/evil.dylib -> ../../outside.dylib`,
    ]);
    const abs = `${listing}\nlrwxr-xr-x  0 runner staff 0 Sep 14 16:28 ${ROOT}/evil.dylib -> /usr/lib/libSystem.B.dylib`;
    expect(archiveProblems(abs)).toHaveLength(1);
  });

  it('rejects path traversal and hardlink entries', () => {
    const traversal = `-rw-r--r--  0 runner staff 1 Sep 14 16:28 ../escape`;
    expect(archiveProblems(traversal)).toEqual(['unsafe entry path: ../escape']);
    const hardlink = `hrw-r--r--  0 runner staff 0 Sep 14 16:28 ${ROOT}/dup link to ${ROOT}/libkrunfw.5.dylib`;
    expect(archiveProblems(hardlink)).toHaveLength(1);
    expect(archiveProblems(hardlink)[0]).toMatch(/^unsupported entry type/);
  });

  it('only allows bare sibling names as symlink targets', () => {
    expect(isSafeSymlinkTarget('libkrun.1.19.4.dylib')).toBe(true);
    expect(isSafeSymlinkTarget('..')).toBe(false);
    expect(isSafeSymlinkTarget('sub/lib.dylib')).toBe(false);
    expect(isSafeSymlinkTarget('/abs.dylib')).toBe(false);
    expect(isSafeSymlinkTarget('')).toBe(false);
  });
});

describe('missingRequiredFiles', () => {
  it('requires the names the helper dlopens, satisfied by symlinks too', () => {
    expect(REQUIRED_BUNDLE_FILES).toEqual(['libkrun.dylib', 'libkrunfw.5.dylib']);
    expect(
      missingRequiredFiles(['libkrun.1.19.4.dylib', 'libkrun.dylib', 'libkrunfw.5.dylib']),
    ).toEqual([]);
    expect(missingRequiredFiles(['libkrun.1.19.4.dylib', 'libkrunfw.5.dylib'])).toEqual([
      'libkrun.dylib',
    ]);
    expect(missingRequiredFiles([])).toEqual(REQUIRED_BUNDLE_FILES);
  });
});
