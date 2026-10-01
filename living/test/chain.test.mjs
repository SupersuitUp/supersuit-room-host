import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { newTemplate } from '../new-template.mjs'
import { newApp } from '../new-app.mjs'
import { update } from '../update.mjs'
import { fingerprint } from '../private-words.mjs'
import { tmp, makeRepo, metaFiles, commit, sh, read, cleanup, checkScript } from './helpers.mjs'

const giveOrigin = (base, name, work) => {
  const bare = join(base, `${name}.git`)
  sh(base, 'init', '-q', '--bare', '-b', 'main', bare)
  sh(work, 'remote', 'add', 'origin', bare)
  sh(work, 'push', '-q', '-u', 'origin', 'main')
  return bare
}

test('a fix in the meta-template reaches a template and then an app, and no tailor/ moves', async () => {
  const base = tmp('chain3')
  try {
    const meta = makeRepo(base, 'meta', metaFiles({ 'living/version.txt': '1\n' }))

    const tplWork = join(base, 'template')
    newTemplate({ from: meta.bare, dir: tplWork })
    assert.equal(sh(tplWork, 'remote', 'get-url', 'template'), meta.bare)
    commit(tplWork, { 'package.json': checkScript(true), 'app.txt': 'a couples app\n', 'tailor/settings.txt': 'name=Ana and Ben\n' }, 'template: the app')
    const tplBare = giveOrigin(base, 'template', tplWork)

    const appWork = join(base, 'app')
    const made = newApp({ from: tplBare, dir: appWork, privateWords: ['Zebulon Quill'], templateCheckout: tplWork })
    assert.equal(sh(appWork, 'remote', 'get-url', 'template'), tplBare)
    assert.equal(read(appWork, 'tailor/private-words.txt'), 'Zebulon Quill\n')
    assert.ok(read(tplWork, 'tailor/forbidden.sha256').includes(fingerprint('Zebulon Quill')))
    assert.deepEqual(made.templateHits, [])
    commit(appWork, { 'tailor/settings.txt': 'name=Zebulon Quill\n' }, 'app: tailored')
    giveOrigin(base, 'app', appWork)
    sh(tplWork, 'push', '-q', 'origin', 'main')

    commit(meta.work, { 'living/version.txt': '2\n', 'tailor/settings.txt': 'name=meta sample\n' }, 'meta: v2')
    sh(meta.work, 'push', '-q', 'origin', 'main')

    assert.equal((await update({ repo: tplWork })).status, 'updated')
    assert.equal((await update({ repo: appWork })).status, 'updated')

    assert.equal(read(appWork, 'living/version.txt'), '2\n')
    assert.equal(read(tplWork, 'tailor/settings.txt'), 'name=Ana and Ben\n')
    assert.equal(read(appWork, 'tailor/settings.txt'), 'name=Zebulon Quill\n')
  } finally { cleanup(base) }
})

test('newApp reports when the template already contains the new app\'s private words', () => {
  const base = tmp('leak')
  try {
    const tpl = makeRepo(base, 'template', metaFiles({ 'src/hello.txt': 'hello zebulon\n' }))
    const made = newApp({ from: tpl.bare, dir: join(base, 'app'), privateWords: ['Zebulon'], templateCheckout: tpl.work })
    assert.deepEqual(made.templateHits.map((h) => h.file), ['src/hello.txt'])
  } finally { cleanup(base) }
})

test('newTemplate and newApp refuse a directory that already exists', () => {
  const base = tmp('exists')
  try {
    const meta = makeRepo(base, 'meta', metaFiles())
    assert.throws(() => newTemplate({ from: meta.bare, dir: meta.work }), /already exists/)
    assert.throws(() => newApp({ from: meta.bare, dir: meta.work }), /already exists/)
  } finally { cleanup(base) }
})
