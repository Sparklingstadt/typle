require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { newSession, typeInput } = require('../src/lib/typing.ts')
const { kanaCandidates, romajiGuide, isRomajiTarget } = require('../src/lib/romaji.ts')

// Types `keys` one at a time, as the practice field sends them: the value is always the committed text plus the new key.
function typeKeys(words, keys, session = newSession()) {
  let s = session
  for (const key of keys) s = typeInput(s, words, s.input + key, 100)
  return s
}

const finishes = (word, keys) => {
  const s = typeKeys([{ input: word }], keys)
  assert.equal(s.finishedAt, 100, `${word}: ${keys} (typed ${s.input}, pending ${s.pendingKana})`)
  assert.equal(s.mistakes, 0, `${word}: ${keys}`)
  assert.equal(s.attempts, keys.length, `${word}: ${keys}`)
}

test('every common spelling of a kana is accepted', () => {
  for (const [word, spellings] of [
    ['し', ['shi', 'si', 'ci']],
    ['ち', ['chi', 'ti']],
    ['つ', ['tsu', 'tu']],
    ['ふ', ['fu', 'hu']],
    ['じ', ['ji', 'zi']],
    ['か', ['ka', 'ca']],
    ['を', ['wo']],
    ['しゃ', ['sha', 'sya', 'shilya', 'sixya']],
    ['ちょ', ['cho', 'tyo', 'cyo', 'chixyo']],
    ['じゅ', ['ju', 'zyu', 'jyu']],
    ['ふぁ', ['fa', 'fula', 'huxa']],
    ['てぃ', ['thi', 'texi']],
    ['でゅ', ['dhu']],
    ['うぃ', ['wi', 'uli']],
    ['ゔ', ['vu']],
  ]) for (const keys of spellings) finishes(word, keys)
})

test('katakana and the long vowel mark are typed like hiragana', () => {
  finishes('コーヒー', 'ko-hi-')
  finishes('ヴァイオリン', 'vaiorinn')
  finishes('ティッシュ', 'thisshu')
  finishes('ウェブ', 'webu')
})

test('ん takes a single n only before a consonant that cannot follow n', () => {
  finishes('かんじ', 'kanji')
  finishes('かんじ', 'kannji')
  finishes('かんじ', 'kaxnji')
  finishes('ほんや', "hon'ya")
  finishes('ほんや', 'honnya')
  finishes('きんえん', 'kinnenn')
  finishes('みかん', 'mikann')
  // Before a vowel, y or n a single n would read as a different kana.
  const s = typeKeys([{ input: 'きんえん' }], 'kine')
  assert.equal(s.input, 'き')
  assert.equal(s.mistakes, 1)
  // At the end of a word the second n is still needed.
  assert.equal(typeKeys([{ input: 'みかん' }], 'mikan').finishedAt, null)
})

test('っ is typed by doubling the next consonant or on its own', () => {
  finishes('きって', 'kitte')
  finishes('きって', 'kiltute')
  finishes('きって', 'kixtsute')
  finishes('まっちゃ', 'maccha')
  finishes('まっちゃ', 'mattya')
  finishes('ずっと', 'zutto')
  // Before a vowel or at the end there is no consonant to double.
  finishes('あっ', 'axtu')
  assert.equal(typeKeys([{ input: 'あっ' }], 'att').mistakes, 2)
})

test('punctuation, spaces and Latin letters in a kana word are typed as they are', () => {
  finishes('はい、そうです。', 'hai,soudesu.')
  finishes('Tシャツ', 'Tshatsu')
  finishes('えっ！？', 'extu!?')
  finishes('ねこ　いぬ', 'neko inu')
})

test('kana committed through an input method still count, and mixing with romaji works', () => {
  const words = [{ input: 'かんじ' }]
  assert.equal(typeInput(newSession(), words, 'かんじ', 100).finishedAt, 100)
  let s = typeKeys(words, 'ka')
  s = typeInput(s, words, 'かんじ', 200)
  assert.equal(s.finishedAt, 200)
  assert.equal(s.mistakes, 0)
})

test('a wrong key is a mistake and keeps the keys accepted so far', () => {
  const words = [{ input: 'しゃ' }]
  let s = typeKeys(words, 'sh')
  assert.equal(s.input, '')
  assert.equal(s.pendingKana, 'sh')
  s = typeKeys(words, 'x', s)
  assert.equal(s.missed, true)
  assert.equal(s.mistakes, 1)
  assert.equal(s.pendingKana, 'sh')
  assert.equal(s.wordMistakes[0].position, 0)
  assert.equal(s.wordMistakes[0].typed, 'x')
  s = typeKeys(words, 'a', s)
  assert.equal(s.finishedAt, 100)
  assert.equal(s.missed, false)
})

test('a pending single n is committed when the next kana starts, also across a mistake', () => {
  const words = [{ input: 'かんじ' }]
  let s = typeKeys(words, 'kan')
  assert.equal(s.input, 'か')
  assert.equal(s.pendingKana, 'n')
  s = typeKeys(words, 'q', s)
  assert.equal(s.input, 'かん')
  assert.equal(s.mistakes, 1)
  s = typeKeys(words, 'ji', s)
  assert.equal(s.finishedAt, 100)
})

test('upper-case keys are accepted for kana', () => {
  finishes('かんじ', 'KANJI')
})

test('words carry on without leaking pending keys', () => {
  const words = [{ input: 'ねこ' }, { input: 'いぬ' }]
  const s = typeInput(newSession(), words, 'nekoinu', 100)
  assert.equal(s.finishedAt, 100)
  assert.equal(s.mistakes, 0)
  const next = typeKeys(words, 'nek')
  assert.equal(next.index, 0)
  assert.equal(typeKeys(words, 'o', next).romajiTyped, '')
})

test('kanaCandidates is null for characters without a romaji spelling', () => {
  assert.equal(kanaCandidates(Array.from('漢'), 0), null)
  assert.deepEqual(kanaCandidates(Array.from('きゃ'), 0).map(item => item.romaji).slice(0, 2), ['kya', 'ki'])
})

test('isRomajiTarget needs kana and only typeable characters', () => {
  assert.equal(isRomajiTarget('かんじ'), true)
  assert.equal(isRomajiTarget('Tシャツ'), true)
  assert.equal(isRomajiTarget('hello'), false)
  assert.equal(isRomajiTarget('漢字かな'), false)
})

test('romajiGuide shows the keys typed and a spelling for the rest that follows them', () => {
  assert.deepEqual(romajiGuide('かんじ', 0, '', ''), { typed: '', rest: 'kanji' })
  assert.deepEqual(romajiGuide('しゃしん', 0, 's', 's'), { typed: 's', rest: 'hashinn' })
  assert.deepEqual(romajiGuide('しゃしん', 0, 'sy', 'sy'), { typed: 'sy', rest: 'ashinn' })
  assert.deepEqual(romajiGuide('きって', 1, 'ki', ''), { typed: 'ki', rest: 'tte' })
  assert.deepEqual(romajiGuide('かんじ', 1, 'kan', 'n'), { typed: 'kan', rest: 'ji' })
  assert.deepEqual(romajiGuide('かんな', 1, 'ka', ''), { typed: 'ka', rest: 'nnna' })
  assert.deepEqual(romajiGuide('コーヒー', 0, '', ''), { typed: '', rest: 'ko-hi-' })
  assert.equal(romajiGuide('漢字', 0, '', ''), null)
})
