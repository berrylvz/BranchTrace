import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateDownloadPercent,
  formatBundleLabel,
  formatByteSize,
  formatUpdateDate,
  formatUpdaterError,
  isUpdaterSupportedBundle,
} from '../src/updater.ts'

test('isUpdaterSupportedBundle accepts installed package bundle types and rejects unpackaged builds', () => {
  assert.equal(isUpdaterSupportedBundle('deb'), true)
  assert.equal(isUpdaterSupportedBundle('rpm'), true)
  assert.equal(isUpdaterSupportedBundle('appimage'), true)
  assert.equal(isUpdaterSupportedBundle('nsis'), true)
  assert.equal(isUpdaterSupportedBundle('msi'), true)
  assert.equal(isUpdaterSupportedBundle('app'), true)
  assert.equal(isUpdaterSupportedBundle(null), false)
  assert.equal(isUpdaterSupportedBundle('dev'), false)
})

test('calculateDownloadPercent computes clamped percentages and handles missing totals', () => {
  assert.equal(calculateDownloadPercent(0, 1000), 0)
  assert.equal(calculateDownloadPercent(500, 1000), 50)
  assert.equal(calculateDownloadPercent(1200, 1000), 100)
  assert.equal(calculateDownloadPercent(-10, 1000), 0)
  assert.equal(calculateDownloadPercent(500, null), null)
  assert.equal(calculateDownloadPercent(500, 0), null)
})

test('formatByteSize formats bytes, KB, MB, and GB cleanly', () => {
  assert.equal(formatByteSize(0), '0 B')
  assert.equal(formatByteSize(512), '512 B')
  assert.equal(formatByteSize(1536), '1.5 KB')
  assert.equal(formatByteSize(128 * 1024), '128 KB')
  assert.equal(formatByteSize(6.2 * 1024 * 1024), '6.2 MB')
})

test('formatBundleLabel and formatUpdateDate produce clear English labels', () => {
  assert.equal(formatBundleLabel('deb', true), 'deb package (dpkg)')
  assert.equal(formatBundleLabel(null, true), 'Unpackaged build')
  assert.equal(formatBundleLabel('deb', false), 'Web preview')
  assert.equal(formatUpdateDate(null), null)
  assert.equal(formatUpdateDate('2026-11-24T12:00:00Z'), 'Nov 24, 2026')
})

test('formatUpdaterError translates updater failures into actionable messages', () => {
  assert.match(formatUpdaterError('Authentication failed or was cancelled'), /authentication was cancelled/i)
  assert.match(formatUpdaterError('Failed to install .deb package'), /dpkg could not install/i)
  assert.match(
    formatUpdaterError('The update was signed for version 1.0.0 but the update endpoint announced version 2.0.0'),
    /signature verification failed/i,
  )
  assert.match(formatUpdaterError('Could not fetch a valid release JSON from the remote'), /No published update release/i)
  assert.match(
    formatUpdaterError('None of the fallback platforms `["linux-x86_64-deb", "linux-x86_64"]` were found in the response `platforms` object'),
    /No matching \.deb package/i,
  )
  assert.match(formatUpdaterError(new Error('error sending request for url')), /Unable to reach GitHub Releases/i)
})
