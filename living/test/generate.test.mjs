import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './helpers.mjs'

const CMD = join(ROOT, '.claude/commands/generate.md')

test('/generate exists where Claude Code finds a project command', () => {
  assert.ok(existsSync(CMD))
  assert.match(readFileSync(CMD, 'utf8'), /^---\ndescription: /)
})

test('every living/ file /generate names exists in the meta-template', () => {
  const body = readFileSync(CMD, 'utf8')
  const named = [...new Set([...body.matchAll(/living\/[\w.-]+\.(?:mjs|md)/g)].map((m) => m[0]))]
  assert.ok(named.length >= 4, named.join(', '))
  for (const f of named) assert.ok(existsSync(join(ROOT, f)), `${f} is named by /generate but missing`)
})

test('/generate never asks for a secret in the chat, and stops the template\'s setup at "Prove it"', () => {
  const body = readFileSync(CMD, 'utf8')
  assert.match(body, /Never ask\s+for a secret in the chat/)
  assert.match(body, /every section before "Prove it"/)
})

test('/generate relies on a template section every template must have', () => {
  // A template's own tests check its TAILORING.md has this heading (us-template: tailoring.test.ts).
  const body = readFileSync(CMD, 'utf8')
  assert.match(body, /"What you need before you start"/)
  assert.match(body, /"Prove it"/)
})
