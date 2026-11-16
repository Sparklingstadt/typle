import type { Pool } from 'pg'

// Saves can be measured (TYPLE_MEASURE_SAVES=1, Issue #174, docs/save-metrics.md): how long each took, the status it was
// answered with, and the bytes of its request and of its answer, one row of typle_save_metrics each.

/** The longest a measurement may hold the answer of the save it measured. */
const MEASURE_TIMEOUT_MS = 2000

/**
 * The answer of save, measured as operation when env turns measuring on. The row is written before the answer is
 * returned, because a serverless instance may stop once a request is answered; so it holds the answer for one INSERT,
 * never longer than MEASURE_TIMEOUT_MS. A measurement that fails is only logged.
 */
export async function measureSave(request: Request, operation: string, open: () => Pool, save: () => Promise<Response>,
  env: Record<string, string | undefined> = process.env): Promise<Response> {
  if (env.TYPLE_MEASURE_SAVES !== '1') return save()
  const length = Number(request.headers.get('Content-Length'))
  const requestBytes = Number.isFinite(length) && length > 0 ? length : (await request.clone().arrayBuffer()).byteLength
  const started = Date.now()
  const response = await save()
  const durationMs = Date.now() - started
  const responseBytes = (await response.clone().arrayBuffer()).byteLength
  const write = (async () => {
    await open().query(`WITH old AS (DELETE FROM typle_save_metrics WHERE at < now() - interval '90 days')
      INSERT INTO typle_save_metrics (operation, status, duration_ms, request_bytes, response_bytes) VALUES ($1, $2, $3, $4, $5)`,
    [operation, response.status, durationMs, requestBytes, responseBytes])
  })()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([write, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), MEASURE_TIMEOUT_MS) })])
  } catch (error) {
    write.catch(() => {})
    console.error(`measure ${operation}:`, error)
  } finally {
    clearTimeout(timer)
  }
  return response
}
