// Helpers shared by the unit tests (tests/*.test.cjs).

/** A localStorage-like store that keeps its values in memory. */
function storage() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}

/** Words whose display is each text and whose input is the text in lower case. */
const words = (...texts) => texts.map(text => ({ display: text, input: text.toLowerCase(), annotation: '' }))

module.exports = { storage, words }
