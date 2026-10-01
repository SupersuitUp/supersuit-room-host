import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scan, fingerprint, addForbidden } from '../private-words.mjs'
import { tmp, makeRepo, commit, read, cleanup } from './helpers.mjs'

const repoWith = (files) => {
  const base = tmp('words')
  const { work } = makeRepo(base, 'r', { 'tailor/README.md': 'x\n', ...files })
  return { base, work }
}

test('a fingerprinted word outside tailor/ is a hit, matched case-insensitively', () => {
  const { base, work } = repoWith({
    'tailor/forbidden.sha256': fingerprint('Zebulon') + '\n',
    'src/a.js': "const who = 'zebulon'\n",
  })
  try {
    assert.deepEqual(scan(work).map((h) => [h.file, h.line]), [['src/a.js', 1]])
  } finally { cleanup(base) }
})

test('a fingerprinted domain is a hit', () => {
  const { base, work } = repoWith({
    'tailor/forbidden.sha256': fingerprint('us.example.com') + '\n',
    'src/site.ts': "export const SITE = 'https://us.example.com'\n",
  })
  try {
    assert.equal(scan(work).length, 1)
  } finally { cleanup(base) }
})

test('a plain phrase listed in private-words.txt is a hit', () => {
  const { base, work } = repoWith({
    'tailor/private-words.txt': 'Ana Lovelace\n',
    'docs/x.md': 'written by ana  lovelace\n\nnothing here\n',
  })
  try {
    assert.deepEqual(scan(work).map((h) => [h.file, h.line]), [['docs/x.md', 1]])
  } finally { cleanup(base) }
})

test('the same words inside tailor/ are fine, and untracked files are not scanned', () => {
  const { base, work } = repoWith({
    'tailor/forbidden.sha256': fingerprint('zebulon') + '\n',
    'tailor/private-words.txt': 'zebulon\n',
    'tailor/couple.config.ts': "names: ['Zebulon']\n",
    'src/a.js': 'const nobody = 1\n',
  })
  try {
    assert.deepEqual(scan(work), [])
  } finally { cleanup(base) }
})

test('a copy may name itself in its own README, but never someone the template forbids', () => {
  const { base, work } = repoWith({
    'tailor/private-words.txt': 'zebulon\n',
    'tailor/forbidden.sha256': fingerprint('quillon') + '\n',
    'README.md': 'Zebulon and friends run this copy.\nNot Quillon.\n',
  })
  try {
    assert.deepEqual(scan(work).map((h) => [h.file, h.line]), [['README.md', 2]])
  } finally { cleanup(base) }
})

test('a word that merely contains a forbidden word is not a hit', () => {
  const { base, work } = repoWith({
    'tailor/forbidden.sha256': fingerprint('ben') + '\n',
    'src/a.js': 'const benefit = 1\n',
  })
  try {
    assert.deepEqual(scan(work), [])
  } finally { cleanup(base) }
})

test('addForbidden appends fingerprints, deduplicated and sorted, and never the word', () => {
  const { base, work } = repoWith({ 'tailor/forbidden.sha256': '' })
  try {
    addForbidden(work, ['Zebulon', 'zebulon', 'Ana'])
    const body = read(work, 'tailor/forbidden.sha256')
    assert.deepEqual(body.trim().split('\n'), [fingerprint('ana'), fingerprint('zebulon')].sort())
    assert.ok(!/zebulon|ana/i.test(body))
  } finally { cleanup(base) }
})
