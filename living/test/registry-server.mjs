// A throwaway npm registry for the bump tests. Serves every tarball listed in <dir>/index.json
// ({ "<name>": { "<version>": "<file>.tgz" } }), read fresh on each request so a test can publish
// a newer version mid-run. Run as its own process: the code under test blocks the test's process
// in spawnSync while npm or pnpm talks to this server. Prints its port on stdout when listening.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { compare } from '../semver.mjs'

const dir = process.argv[2]
const server = createServer((req, res) => {
  const base = `http://127.0.0.1:${server.address().port}`
  const path = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '')
  if (path.startsWith('-/tarballs/')) {
    try {
      const body = readFileSync(join(dir, path.slice('-/tarballs/'.length)))
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      return res.end(body)
    } catch { res.writeHead(404); return res.end() }
  }
  const pkg = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'))[path]
  if (!pkg) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"not found"}') }
  const versions = {}
  for (const [version, file] of Object.entries(pkg)) {
    const buf = readFileSync(join(dir, file))
    versions[version] = {
      name: path, version,
      dist: {
        tarball: `${base}/-/tarballs/${file}`,
        shasum: createHash('sha1').update(buf).digest('hex'),
        integrity: `sha512-${createHash('sha512').update(buf).digest('base64')}`,
      },
    }
  }
  const latest = Object.keys(versions).sort(compare).at(-1)
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ name: path, 'dist-tags': { latest }, versions }))
})
server.listen(0, '127.0.0.1', () => console.log(String(server.address().port)))
