// Makes, from their one source, commands/manifest.json (the lists in order):
// - src/lib/packs/commands/index.ts, which imports every official list in order (the server, and pages rendered there);
// - summary.json, the official packs without their words (names, labels, counts and a few sample words), and
//   loaders.ts, which imports the lists of one pack when asked: the browser reads the summary to show the
//   catalog and loads only the words of the packs someone follows (src/lib/packs/officialCatalog.ts).
// With --check it changes nothing and fails when any of them is not what it would make (tests/commands.test.cjs).
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const source = path.join(root, 'src/lib/packs')

function index(names) {
  const imports = names.map((name, i) => `import list${i} from './${name}'`).join('\n')
  const items = names.map((_, i) => `  list${i},`).join('\n')
  return `// Made by scripts/generate-packs.cjs from manifest.json: run \`npm run packs:generate\` after changing the lists.
import { isInputType, type SavedWordList } from '../../wordLists'
${imports}

const commands: SavedWordList[] = [
${items}
].map(list => ({
  ...list,
  words: list.words.map(word => {
    if (!isInputType(word.input_type)) throw new Error('Invalid official input_type')
    return { ...word, input_type: word.input_type }
  }),
}))

export default commands
`
}

const SAMPLE_WORDS = 3

/** The official packs as the app builds them (src/lib/packs/catalog.ts) from the index.ts that is on disk. */
function officialPacks() {
  const ts = require('typescript')
  const previous = require.extensions['.ts']
  require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename)
  try {
    // Read afresh: generate() has just written index.ts.
    for (const file of Object.keys(require.cache)) if (file.startsWith(path.join(root, 'src') + path.sep)) delete require.cache[file]
    return require(path.join(source, 'catalog.ts')).officialPacks()
  } finally {
    if (previous) require.extensions['.ts'] = previous
    else delete require.extensions['.ts']
  }
}

function summary(packs) {
  return JSON.stringify(packs.map(({ catalogId, version, pack, lists }) => ({
    catalogId, version, pack,
    lists: lists.map(({ words, ...list }) => ({ ...list, wordCount: words.length, sample: words.slice(0, SAMPLE_WORDS).map(word => word.display) })),
  })), null, 1) + '\n'
}

function loaders(packs, names) {
  const fileOf = new Map(names.map(name => [JSON.parse(fs.readFileSync(path.join(source, 'commands', name), 'utf8')).id, name]))
  const entries = packs.map(({ catalogId, lists }) => {
    const files = lists.map(list => {
      if (!fileOf.has(list.id)) throw new Error(`No file in manifest.json for list ${list.id}`)
      return `import('./commands/${fileOf.get(list.id)}')`
    })
    return `  ${JSON.stringify(catalogId)}: () => Promise.all([${files.join(', ')}]),`
  }).join('\n')
  return `// Made by scripts/generate-packs.cjs from manifest.json: run \`npm run packs:generate\` after changing the lists.
// The files of each official pack's lists, in the pack's order, loaded when asked (see officialCatalog.ts).
type ListFile = { id: string, words: { display: string, input: string, annotation: string, input_type?: string }[] }

export const packFiles: Record<string, () => Promise<{ default: ListFile }[]>> = {
${entries}
}
`
}

function manifest() {
  const names = JSON.parse(fs.readFileSync(path.join(source, 'commands/manifest.json'), 'utf8'))
  if (new Set(names).size !== names.length) throw new Error('manifest.json names a list twice')
  return names
}

/** The files made from the official packs, by path, with their contents. index.ts on disk must be up to date. */
function packOutputs(names) {
  const packs = officialPacks()
  return new Map([
    [path.join(source, 'summary.json'), summary(packs)],
    [path.join(source, 'loaders.ts'), loaders(packs, names)],
  ])
}

const differs = ([file, text]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text

function check() {
  const names = manifest()
  const first = [[path.join(source, 'commands/index.ts'), index(names)]].filter(differs)
  // The other files are made from index.ts: when it is out of date, only it is named.
  const differing = first.length ? first : [...packOutputs(names)].filter(differs)
  return differing.map(([file]) => path.relative(root, file))
}

function generate() {
  const names = manifest()
  fs.writeFileSync(path.join(source, 'commands/index.ts'), index(names))
  for (const [file, text] of packOutputs(names)) fs.writeFileSync(file, text)
}

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const differing = check()
    if (differing.length) {
      console.error(`Not up to date (run npm run packs:generate):\n${differing.join('\n')}`)
      process.exit(1)
    }
  } else {
    generate()
  }
}

module.exports = { check }
