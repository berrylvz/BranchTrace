import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  assertConsistentVersions,
  buildUpdaterManifest,
  findDebArtifact,
  parseCargoPackageVersion,
  replaceCargoPackageVersion,
  validateUpdaterSignature,
} from '../scripts/release-manifest.mjs'

function makeSampleSignature(version) {
  const raw = [
    'untrusted comment: signature from tauri secret key',
    'RUTX5qZvdPSepPF2zsjvP/L/TQtBLRnWRvaq+4omK1UEugtQp/USrGiI1v762sDy3id3aor7bRC9ETyeot6lMHHrWoZ5hjUM1Qc=',
    `trusted comment: timestamp:1791649051\tfile:BranchTrace_${version}_amd64.deb\tversion:${version}`,
    'DDq2CLOEl5cQmC2eJRHlnZPVViOZsu1CjpPKQoei4A/XBfkDqGO0B+QMrcrHgEQ5qV3mne75tdFWhJpqUXh9AA==',
  ].join('\n')
  return Buffer.from(raw, 'utf8').toString('base64')
}

test('parseCargoPackageVersion and replaceCargoPackageVersion only touch [package] version', () => {
  const sample = `[package]
name = "branchtrace"
version = "1.0.0"

[dependencies]
tauri = { version = "2.12.4" }
`
  assert.equal(parseCargoPackageVersion(sample), '1.0.0')
  const updated = replaceCargoPackageVersion(sample, '1.2.3')
  assert.equal(parseCargoPackageVersion(updated), '1.2.3')
  assert.match(updated, /tauri = \{ version = "2\.12\.4" \}/)
})

test('assertConsistentVersions validates synchronized versions and tags', () => {
  assert.equal(
    assertConsistentVersions({
      packageVersion: '1.1.0',
      tauriVersion: '1.1.0',
      cargoVersion: '1.1.0',
      tagName: 'v1.1.0',
    }),
    '1.1.0',
  )

  assert.throws(() => assertConsistentVersions({
    packageVersion: '1.1.0',
    tauriVersion: '1.0.0',
    cargoVersion: '1.1.0',
  }), /Version mismatch/)

  assert.throws(() => assertConsistentVersions({
    packageVersion: '1.1.0',
    tauriVersion: '1.1.0',
    cargoVersion: '1.1.0',
    tagName: 'v1.2.0',
  }), /does not match project version/)
})

test('validateUpdaterSignature checks minisign headers and signed version match', () => {
  const sig = makeSampleSignature('1.1.0')
  assert.equal(validateUpdaterSignature(sig, '1.1.0'), sig)

  assert.throws(() => validateUpdaterSignature(sig, '1.2.0'), /does not match release version/)
  assert.throws(
    () => validateUpdaterSignature(Buffer.from('untrusted comment: a\ntrusted comment: timestamp:1\tfile:x\nbbb').toString('base64'), '1.1.0'),
    /missing a signed version field/,
  )
  assert.throws(() => validateUpdaterSignature('not-a-minisign', '1.1.0'), /valid minisign headers/)
})

test('buildUpdaterManifest generates linux-x86_64-deb entry pointing to GitHub Releases', () => {
  const sig = makeSampleSignature('1.1.0')
  const manifest = buildUpdaterManifest({
    version: '1.1.0',
    notes: 'Added in-app dpkg updates',
    pubDate: '2026-11-24T20:00:00.000Z',
    repo: 'berrylvz/BranchTrace',
    tagName: 'v1.1.0',
    artifacts: [
      {
        platform: 'linux-x86_64-deb',
        fileName: 'BranchTrace_1.1.0_amd64.deb',
        signature: sig,
      },
    ],
  })

  assert.deepEqual(manifest, {
    version: '1.1.0',
    notes: 'Added in-app dpkg updates',
    pub_date: '2026-11-24T20:00:00.000Z',
    platforms: {
      'linux-x86_64-deb': {
        signature: sig,
        url: 'https://github.com/berrylvz/BranchTrace/releases/download/v1.1.0/BranchTrace_1.1.0_amd64.deb',
      },
    },
  })
})

test('findDebArtifact locates matching .deb and .deb.sig and fails when .sig is absent', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'branchtrace-deb-test-'))
  try {
    writeFileSync(path.join(dir, 'BranchTrace_1.0.0_amd64.deb'), 'old')
    writeFileSync(path.join(dir, 'BranchTrace_1.1.0_amd64.deb'), 'new')
    assert.throws(() => findDebArtifact(dir, '1.1.0'), /Missing signature file/)

    writeFileSync(path.join(dir, 'BranchTrace_1.1.0_amd64.deb.sig'), makeSampleSignature('1.1.0'))
    const found = findDebArtifact(dir, '1.1.0')
    assert.equal(found.fileName, 'BranchTrace_1.1.0_amd64.deb')
    assert.equal(found.sigFileName, 'BranchTrace_1.1.0_amd64.deb.sig')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
