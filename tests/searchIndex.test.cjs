require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { INDEXED_PATHS, DISALLOWED_PATHS, ACCOUNT_PATHS, sitemapEntries, robotsRules } = require('../src/lib/searchIndex.ts')

const site = 'https://typle-r-six.vercel.app'

test('the sitemap lists the public pages under the site origin', () => {
  const urls = sitemapEntries(site).map(entry => entry.url)
  assert.deepEqual(urls, [
    `${site}/`, `${site}/play`, `${site}/packs/catalog`, `${site}/guide`, `${site}/about`,
  ])
})

test('a path or trailing slash on the site URL does not leak into the entries', () => {
  assert.equal(sitemapEntries(`${site}/`).at(0).url, `${site}/`)
  assert.equal(sitemapEntries(`${site}/api/auth`).at(1).url, `${site}/play`)
  assert.equal(robotsRules(`${site}/`).sitemap, `${site}/sitemap.xml`)
})

test('robots.txt keeps crawlers out of the development login and the backend', () => {
  const robots = robotsRules(site)
  assert.equal(robots.rules.userAgent, '*')
  assert.equal(robots.rules.allow, '/')
  assert.deepEqual(robots.rules.disallow, ['/local-login', '/api/'])
  assert.equal(robots.sitemap, `${site}/sitemap.xml`)
  assert.equal(robots.host, site)
})

test('no listed page is also disallowed', () => {
  for (const { path: page } of INDEXED_PATHS) {
    for (const blocked of DISALLOWED_PATHS) assert.ok(!page.startsWith(blocked), `${page} is under ${blocked}`)
  }
})

test('every listed page exists in the app', () => {
  const app = path.join(__dirname, '..', 'src', 'app')
  const pages = new Set()
  const walk = (dir, route) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        if (entry.name === 'page.tsx') pages.add(route || '/')
        continue
      }
      // Route groups like (workspace) do not add a path segment.
      const segment = /^\(.*\)$/.test(entry.name) ? '' : `/${entry.name}`
      walk(path.join(dir, entry.name), route + segment)
    }
  }
  walk(app, '')
  for (const { path: page } of INDEXED_PATHS) assert.ok(pages.has(page), `${page} has no page.tsx`)
})

test('the account pages exist, are noindex, and stay out of the sitemap and out of robots.txt', () => {
  const urls = sitemapEntries(site, ['/packs/x']).map(entry => entry.url)
  for (const page of ACCOUNT_PATHS) {
    assert.ok(!urls.includes(`${site}${page}`), `${page} is in the sitemap`)
    // A crawler that may not read the page cannot see its noindex.
    assert.ok(!robotsRules(site).rules.disallow.some(blocked => page.startsWith(blocked)), `${page} is disallowed`)
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', page.slice(1), 'page.tsx'), 'utf8')
    assert.match(source, /robots: \{ index: false/, `${page} is not noindex`)
  }
})
