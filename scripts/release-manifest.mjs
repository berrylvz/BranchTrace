#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export function normalizeVersionTag(tagOrVersion) {
  return String(tagOrVersion ?? '').trim().replace(/^v/, '')
}

export function assertValidSemver(version, label = 'version') {
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`Invalid ${label} "${version}". Expected semantic version such as 1.1.0.`)
  }
}

export function parseCargoPackageVersion(cargoToml) {
  const sectionMatch = cargoToml.match(/(?:^|\n)\[package\][\s\S]*?(?=\n\[|$)/)
  const block = sectionMatch ? sectionMatch[0] : cargoToml
  const versionMatch = block.match(/^version\s*=\s*"([^"]+)"/m)
  if (!versionMatch) {
    throw new Error('Could not find package version in src-tauri/Cargo.toml')
  }
  return versionMatch[1]
}

export function replaceCargoPackageVersion(cargoToml, nextVersion) {
  assertValidSemver(nextVersion, 'nextVersion')
  const sectionMatch = cargoToml.match(/(?:^|\n)\[package\][\s\S]*?(?=\n\[|$)/)
  if (!sectionMatch) {
    throw new Error('Could not find [package] section in src-tauri/Cargo.toml')
  }
  const block = sectionMatch[0]
  const replacedBlock = block.replace(/^(version\s*=\s*")([^"]+)(")/m, `$1${nextVersion}$3`)
  if (replacedBlock === block && parseCargoPackageVersion(cargoToml) !== nextVersion) {
    throw new Error('Could not replace package version in src-tauri/Cargo.toml')
  }
  return cargoToml.replace(block, replacedBlock)
}

export function assertConsistentVersions({ packageVersion, tauriVersion, cargoVersion, tagName = null }) {
  assertValidSemver(packageVersion, 'package.json version')
  assertValidSemver(tauriVersion, 'src-tauri/tauri.conf.json version')
  assertValidSemver(cargoVersion, 'src-tauri/Cargo.toml version')

  if (packageVersion !== tauriVersion || packageVersion !== cargoVersion) {
    throw new Error(
      `Version mismatch across manifests: package.json=${packageVersion}, tauri.conf.json=${tauriVersion}, Cargo.toml=${cargoVersion}`,
    )
  }

  if (tagName) {
    const normalizedTag = normalizeVersionTag(tagName)
    assertValidSemver(normalizedTag, 'Git tag version')
    if (normalizedTag !== packageVersion) {
      throw new Error(
        `Git tag "${tagName}" (version ${normalizedTag}) does not match project version ${packageVersion}`,
      )
    }
  }

  return packageVersion
}

export function validateUpdaterSignature(signatureBase64, expectedVersion) {
  const trimmed = String(signatureBase64 ?? '').trim()
  if (!trimmed) {
    throw new Error('Updater signature is empty')
  }

  let decoded
  try {
    decoded = Buffer.from(trimmed, 'base64').toString('utf8')
  } catch (error) {
    throw new Error(`Updater signature is not valid base64: ${error}`)
  }

  if (!decoded.includes('untrusted comment:') || !decoded.includes('trusted comment:')) {
    throw new Error('Updater signature does not contain valid minisign headers')
  }

  const trustedLine = decoded
    .split(/\r?\n/)
    .find((line) => line.startsWith('trusted comment:'))
  const signedVersion = trustedLine
    ?.slice('trusted comment:'.length)
    .trim()
    .split('\t')
    .map((field) => field.trim())
    .find((field) => field.startsWith('version:'))
    ?.slice('version:'.length)

  if (!signedVersion) {
    throw new Error('Updater signature is missing a signed version field in its trusted comment')
  }

  if (normalizeVersionTag(signedVersion) !== normalizeVersionTag(expectedVersion)) {
    throw new Error(
      `Updater signature version (${signedVersion}) does not match release version (${expectedVersion})`,
    )
  }

  return trimmed
}

export function buildUpdaterManifest({ version, notes, pubDate, repo, tagName, artifacts }) {
  const cleanVersion = normalizeVersionTag(version)
  assertValidSemver(cleanVersion, 'release version')

  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error(`Invalid GitHub repository "${repo}". Expected "owner/repo".`)
  }
  if (!tagName) {
    throw new Error('Release tagName is required')
  }
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error('At least one signed artifact is required to build latest.json')
  }

  const platforms = {}
  for (const artifact of artifacts) {
    if (!artifact.platform || !artifact.fileName) {
      throw new Error('Each artifact must specify platform and fileName')
    }
    const validSignature = validateUpdaterSignature(artifact.signature, cleanVersion)
    const encodedTag = encodeURIComponent(tagName)
    const encodedFile = encodeURIComponent(artifact.fileName)
    platforms[artifact.platform] = {
      signature: validSignature,
      url: `https://github.com/${repo}/releases/download/${encodedTag}/${encodedFile}`,
    }
  }

  return {
    version: cleanVersion,
    notes: notes?.trim() || `BranchTrace v${cleanVersion}`,
    pub_date: pubDate || new Date().toISOString(),
    platforms,
  }
}

export function findDebArtifact(debDir, version) {
  const entries = readdirSync(debDir).sort()
  const debFiles = entries.filter((name) => name.endsWith('.deb'))
  if (debFiles.length === 0) {
    throw new Error(`No .deb files found in ${debDir}`)
  }

  const versionMatches = debFiles.filter((name) => name.includes(`_${version}_`))
  const candidates = versionMatches.length > 0 ? versionMatches : debFiles
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one .deb artifact in ${debDir}, found: ${candidates.join(', ')}`)
  }

  const fileName = candidates[0]
  const sigFileName = `${fileName}.sig`
  if (!entries.includes(sigFileName)) {
    throw new Error(
      `Missing signature file "${sigFileName}" in ${debDir}. Ensure TAURI_SIGNING_PRIVATE_KEY is set and bundle.createUpdaterArtifacts is true.`,
    )
  }

  return {
    fileName,
    sigFileName,
    debPath: path.join(debDir, fileName),
    sigPath: path.join(debDir, sigFileName),
  }
}

function readRepoVersions(rootDir) {
  const packagePath = path.join(rootDir, 'package.json')
  const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json')
  const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml')

  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
  const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'))
  const cargoToml = readFileSync(cargoTomlPath, 'utf8')

  return {
    packagePath,
    tauriConfPath,
    cargoTomlPath,
    pkg,
    tauriConf,
    cargoToml,
    packageVersion: pkg.version,
    tauriVersion: tauriConf.version,
    cargoVersion: parseCargoPackageVersion(cargoToml),
  }
}

function parseFlags(argv) {
  const flags = {}
  const positionals = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        flags[key] = 'true'
      } else {
        flags[key] = next
        i += 1
      }
    } else {
      positionals.push(arg)
    }
  }
  return { flags, positionals }
}

function runCli() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const [command, ...rest] = process.argv.slice(2)
  const { flags, positionals } = parseFlags(rest)

  if (command === 'check-version') {
    const versions = readRepoVersions(rootDir)
    const verified = assertConsistentVersions({
      packageVersion: versions.packageVersion,
      tauriVersion: versions.tauriVersion,
      cargoVersion: versions.cargoVersion,
      tagName: flags.tag || null,
    })
    console.log(verified)
    return
  }

  if (command === 'bump') {
    const nextVersion = normalizeVersionTag(positionals[0] || flags.version)
    assertValidSemver(nextVersion, 'target version')
    const versions = readRepoVersions(rootDir)

    versions.pkg.version = nextVersion
    writeFileSync(versions.packagePath, `${JSON.stringify(versions.pkg, null, 2)}\n`, 'utf8')

    versions.tauriConf.version = nextVersion
    writeFileSync(versions.tauriConfPath, `${JSON.stringify(versions.tauriConf, null, 2)}\n`, 'utf8')

    const updatedCargo = replaceCargoPackageVersion(versions.cargoToml, nextVersion)
    writeFileSync(versions.cargoTomlPath, updatedCargo, 'utf8')

    console.log(`Updated BranchTrace version to ${nextVersion} in package.json, src-tauri/tauri.conf.json, and src-tauri/Cargo.toml.`)
    return
  }

  if (command === 'generate') {
    const versions = readRepoVersions(rootDir)
    const tagName = flags.tag || `v${versions.packageVersion}`
    const version = assertConsistentVersions({
      packageVersion: versions.packageVersion,
      tauriVersion: versions.tauriVersion,
      cargoVersion: versions.cargoVersion,
      tagName,
    })

    const repo = flags.repo || process.env.GITHUB_REPOSITORY
    const platform = flags.platform || 'linux-x86_64-deb'
    const debDir = path.resolve(rootDir, flags['deb-dir'] || 'src-tauri/target/release/bundle/deb')
    const outDir = path.resolve(rootDir, flags['out-dir'] || 'release-assets')

    const artifact = findDebArtifact(debDir, version)
    const signature = readFileSync(artifact.sigPath, 'utf8')
    const manifest = buildUpdaterManifest({
      version,
      notes: flags.notes || `BranchTrace v${version}`,
      pubDate: flags['pub-date'] || new Date().toISOString(),
      repo,
      tagName,
      artifacts: [
        {
          platform,
          fileName: artifact.fileName,
          signature,
        },
      ],
    })

    mkdirSync(outDir, { recursive: true })
    const outDebPath = path.join(outDir, artifact.fileName)
    const outSigPath = path.join(outDir, artifact.sigFileName)
    const outShaPath = path.join(outDir, `${artifact.fileName}.sha256`)
    const outManifestPath = path.join(outDir, 'latest.json')

    copyFileSync(artifact.debPath, outDebPath)
    copyFileSync(artifact.sigPath, outSigPath)

    const sha256 = createHash('sha256').update(readFileSync(artifact.debPath)).digest('hex')
    writeFileSync(outShaPath, `${sha256}  ${artifact.fileName}\n`, 'utf8')
    writeFileSync(outManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    console.log(JSON.stringify({
      version,
      tagName,
      platform,
      deb: outDebPath,
      sig: outSigPath,
      sha256: outShaPath,
      manifest: outManifestPath,
    }, null, 2))
    return
  }

  console.error('Usage: node scripts/release-manifest.mjs <check-version|bump|generate> [options]')
  process.exit(1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli()
}
