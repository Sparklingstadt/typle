require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { SHELL_NAMESPACES, clientMessages } = require('../src/i18n/messages.ts')

const root = path.join(__dirname, '..')
const src = path.join(root, 'src')
const app = path.join(src, 'app')

// A route's client components get the messages of the frame and of the areas its nearest <ClientMessages> names (see
// src/i18n/ClientMessages.tsx). These tests read the source: they follow the imports of every page and layout, collect
// the areas the client components among them read with useTranslations, and compare them with what is named.

function resolve(from, spec) {
  const base = spec.startsWith('@/') ? path.join(src, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null
  if (!base) return null
  return ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map(ext => base + ext).find(file => /\.tsx?$/.test(file) && fs.existsSync(file)) ?? null
}

const read = new Map()
function source(file) {
  if (!read.has(file)) {
    const text = fs.readFileSync(file, 'utf8')
    const typeOnly = new Set([...text.matchAll(/^import type [^\n]*from\s+["']([^"']+)["']/gm)].map(match => match[1]))
    read.set(file, {
      client: /^\s*["']use client["']/.test(text),
      // Static imports, re-exports and import() alike (a component loaded with next/dynamic reads messages too).
      imports: [...text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map(match => match[1])
        .filter(spec => !typeOnly.has(spec)).map(spec => resolve(file, spec)).filter(Boolean),
      namespaces: [...text.matchAll(/useTranslations\(\s*["']([A-Za-z]+)/g)].map(match => match[1]),
      // A namespace that is not a literal, or none, cannot be checked here.
      unchecked: /useTranslations\(\s*(?!["'])|useMessages\(/.test(text),
      named: [...text.matchAll(/<ClientMessages(?:\s+namespaces=\{\[([^\]]*)\]\})?\s*>/g)].map(match => (match[1] ?? '').split(',').map(item => item.trim().replace(/["']/g, '')).filter(Boolean)),
    })
  }
  return read.get(file)
}

/** The areas the client components reachable from `entry` read, and those of them that cannot be checked. */
function clientUse(entry) {
  const namespaces = new Set(), unchecked = new Set(), seen = new Set()
  const walk = (file, client) => {
    const { client: marked, imports, namespaces: used, unchecked: odd } = source(file)
    client ||= marked
    if (seen.has(`${file}:${client}`)) return
    seen.add(`${file}:${client}`)
    if (client) { used.forEach(name => namespaces.add(name)); if (odd) unchecked.add(path.relative(root, file)) }
    imports.forEach(next => walk(next, client))
  }
  walk(entry, false)
  return { namespaces: [...namespaces].sort(), unchecked: [...unchecked] }
}

const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
const entries = files(app).filter(file => /\/(page|layout|not-found|error|loading|template)\.tsx$/.test(file))

/** What the nearest <ClientMessages> around `entry` names: its own, or that of the closest layout above it. */
function provided(entry) {
  const own = source(entry).named
  if (own.length) return own.flat()
  for (let dir = path.dirname(entry); dir.startsWith(app); dir = path.dirname(dir)) {
    const layout = path.join(dir, 'layout.tsx')
    if (layout !== entry && fs.existsSync(layout) && source(layout).named.length) return source(layout).named.flat()
  }
  return null
}

test('every page and layout names each area its client components read', () => {
  assert.ok(entries.length > 30)
  for (const entry of entries) {
    const name = path.relative(root, entry)
    const { namespaces, unchecked } = clientUse(entry)
    assert.deepEqual(unchecked, [], `${name}: useTranslations needs a literal namespace`)
    const named = provided(entry)
    assert.ok(named, `${name}: no <ClientMessages> around it`)
    const available = new Set([...SHELL_NAMESPACES, ...named])
    assert.deepEqual(namespaces.filter(item => !available.has(item)), [], `${name}: add these areas to its <ClientMessages namespaces>`)
  }
})

test('a route names no area that its client components do not read, so none travels for nothing', () => {
  for (const entry of entries.filter(file => source(file).named.length)) {
    const name = path.relative(root, entry)
    const named = source(entry).named.flat()
    // What is inside it: the pages and layouts below a layout, or the file itself.
    const inside = path.basename(entry) === 'layout.tsx' ? entries.filter(file => file.startsWith(path.dirname(entry) + path.sep)) : [entry]
    const used = new Set(inside.flatMap(file => clientUse(file).namespaces))
    assert.deepEqual(named.filter(item => !used.has(item)), [], `${name}: these areas are named but not read`)
    assert.deepEqual(named.filter(item => SHELL_NAMESPACES.includes(item)), [], `${name}: the frame's areas need no naming`)
  }
})

test('the root layout gives the frame its areas only, and the frame reads no other', () => {
  const layout = path.join(app, 'layout.tsx')
  assert.deepEqual(source(layout).named, [[]])
  assert.deepEqual(clientUse(layout).namespaces.filter(item => !SHELL_NAMESPACES.includes(item)), [])
})

test('clientMessages gives the frame and the named areas, and of the landing page only the word to try', () => {
  const messages = Object.fromEntries(fs.readdirSync(path.join(src, 'messages/ja')).map(file => [path.basename(file, '.json'), require(path.join(src, 'messages/ja', file))]))
  assert.deepEqual(Object.keys(clientMessages(messages)).sort(), [...SHELL_NAMESPACES].sort())
  const play = clientMessages(messages, ['practice', 'wordLists'])
  assert.deepEqual(Object.keys(play).sort(), [...SHELL_NAMESPACES, 'practice', 'wordLists'].sort())
  assert.equal(play.practice, messages.practice)
  assert.deepEqual(clientMessages(messages, ['landing']).landing, { try: messages.landing.try })
})
