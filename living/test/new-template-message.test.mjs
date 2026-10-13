import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextSteps } from '../new-template.mjs'

// The feedback contract is only real for a new template if making one says how to start. The
// command is the module's, never a file in this folder (living/FEEDBACK.md, "What satisfies this contract").
test('a new template is told to run the suggest-a-change init command', () => {
  const said = nextSteps({ dir: '/tmp/x', template: 'meta.git' })
  assert.match(said, /npx @supersuit\/suggest-a-change init/)
  assert.match(said, /living\/FEEDBACK\.md/)
  assert.match(said, /define living:check/)
})
