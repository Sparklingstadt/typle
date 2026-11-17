// Makes src/lib/packs/commands/index.ts, which imports the official lists in order for the app, from its one source,
// commands/manifest.json (the lists in order).
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

/** The files to make, by path, with their contents. */
function outputs() {
  const names = JSON.parse(fs.readFileSync(path.join(source, 'commands/manifest.json'), 'utf8'))
  if (new Set(names).size !== names.length) throw new Error('manifest.json names a list twice')
  return new Map([[path.join(source, 'commands/index.ts'), index(names)]])
}

function check() {
  const files = outputs()
  const differing = [...files].filter(([file, text]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text)
    .map(([file]) => file)
  return differing.map(file => path.relative(root, file))
}

function generate() {
  const files = outputs()
  for (const [file, text] of files) fs.writeFileSync(file, text)
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
