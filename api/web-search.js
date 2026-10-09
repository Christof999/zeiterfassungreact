/**
 * Internetsuche für Mörgel: Preise, Händler oder eine freie Frage.
 *
 * Gesucht wird über Gemini mit Google-Suche. Ein mitgeschicktes Foto
 * (z. B. eine Fliese) geht mit in die Anfrage, damit „wo finde ich das“
 * das Produkt auf dem Bild meint. Zurück kommen nur gelesene Treffer.
 * Nichts wird im Programm gespeichert.
 *
 * Groq kann nicht im Web suchen – dafür braucht es den Gemini-Schlüssel.
 */
const TIMEOUT_MS = 35_000
const MAX_QUERY = 400
const MAX_IMAGE_CHARS = 1_800_000

function geminiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null
}

function candidateModels() {
  const configured = process.env.AI_MODEL
  return Array.from(
    new Set(
      [configured, 'gemini-2.5-flash', 'gemini-2.0-flash'].filter(
        (model) => !!model && !model.startsWith('llama')
      )
    )
  )
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function asText(value, max = 180) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

function asPrice(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 100_000) {
    return Math.round(value * 100) / 100
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')
    const n = Number(normalized)
    if (Number.isFinite(n) && n > 0 && n < 100_000) return Math.round(n * 100) / 100
  }
  return null
}

function asUrl(value) {
  const url = asText(value, 500)
  if (!/^https?:\/\//i.test(url)) return ''
  return url
}

function searchKind(value) {
  if (value === 'prices' || value === 'suppliers' || value === 'general') return value
  return 'general'
}

function normalizeOffers(raw) {
  if (!Array.isArray(raw)) return []
  const offers = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry
    const supplier = asText(row.supplier, 80)
    const product = asText(row.product, 140)
    const url = asUrl(row.url)
    if (!supplier && !product && !url) continue
    offers.push({
      supplier: supplier || 'Unbekannt',
      product,
      price: asPrice(row.price),
      unit: asText(row.unit, 40),
      url,
      note: asText(row.note, 180),
    })
    if (offers.length >= 6) break
  }
  return offers
}

function normalizePlaces(raw) {
  if (!Array.isArray(raw)) return []
  const places = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry
    const name = asText(row.name, 120)
    const url = asUrl(row.url)
    const address = asText(row.address, 180)
    if (!name && !url && !address) continue
    places.push({
      name: name || 'Unbekannt',
      kind: asText(row.kind, 40),
      city: asText(row.city, 80),
      address,
      phone: asText(row.phone, 40),
      url,
      note: asText(row.note, 180),
    })
    if (places.length >= 6) break
  }
  return places
}

function sourcesFromGrounding(candidate) {
  const meta = candidate?.groundingMetadata || candidate?.grounding_metadata
  const chunks = meta?.groundingChunks || meta?.grounding_chunks
  if (!Array.isArray(chunks)) return []
  const sources = []
  const seen = new Set()
  for (const chunk of chunks) {
    const web = chunk?.web
    const url = asUrl(web?.uri)
    if (!url || seen.has(url)) continue
    seen.add(url)
    sources.push({ title: asText(web?.title, 140) || url, url })
    if (sources.length >= 8) break
  }
  return sources
}

function imagePart(image) {
  const match = image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([a-zA-Z0-9+/=\s]+)$/)
  if (!match) return null
  const data = match[2].replace(/\s/g, '')
  if (data.length < 32 || data.length > MAX_IMAGE_CHARS) return null
  return { inlineData: { mimeType: match[1], data } }
}

function promptFor(kind, query, location, hasImage) {
  const where = location ? `Region: ${location}.` : 'In Deutschland, wenn nichts anderes gesagt ist.'
  const seen = hasImage
    ? 'Ein Foto ist beigefügt. Das gesuchte Produkt ist das, was darauf zu sehen ist. Erkenne Hersteller, Serie, Format oder Farbe, soweit das Bild hergibt, und such genau danach.\n'
    : ''

  if (kind === 'prices') {
    return `${seen}Suche aktuelle Verkaufspreise. ${where}
Gesucht wird: ${query}

Antworte ausschließlich mit JSON:
{"offers":[{"supplier":"Händler","product":"genaue Bezeichnung","price":12.34,"unit":"25-kg-Sack","url":"https://...","note":""}],"note":""}

Regeln:
- Nur Preise, die in den Suchergebnissen stehen. Steht keiner, setze price auf null.
- Die URL muss aus den Suchergebnissen stammen. Erfinde keinen Link und keinen Preis.
- Höchstens 6 Treffer. Einheit immer dazuschreiben (Sack, m², Stück, Eimer, Karton).
- Fachhandelspreise hinter einem Login nicht erfinden.`
  }

  if (kind === 'suppliers') {
    return `${seen}Suche Händler und Bezugsquellen. ${where}
Gesucht wird: ${query}

Antworte ausschließlich mit JSON:
{"places":[{"name":"Firma","kind":"Fachhandel oder Baumarkt oder Online","city":"","address":"","phone":"","url":"https://...","note":""}],"note":""}

Regeln:
- Nur echte Treffer aus der Suche. Erfinde keine Adresse, keine Telefonnummer und keinen Link.
- Höchstens 6 Treffer. Lieber ein Fachhändler in der Nähe als eine lange Liste ohne Beleg.
- Online-Shops sind erlaubt, wenn sie das Produkt führen.`
  }

  return `${seen}Beantworte die Frage anhand einer Websuche. ${where}
Frage: ${query}

Antworte ausschließlich mit JSON:
{"answer":"kurze belegte Antwort auf Deutsch","places":[{"name":"","kind":"","city":"","address":"","phone":"","url":"https://...","note":""}],"offers":[{"supplier":"","product":"","price":null,"unit":"","url":"https://...","note":""}],"note":""}

Regeln:
- Nur Aussagen, die die Suche hergibt. Erfinde keine Fakten, Preise oder Links.
- places für Händler und Orte, offers nur wenn ein Preis wirklich dasteht, sonst leeres Array.
- Höchstens 6 Einträge je Liste.`
}

async function searchWithModel(apiKey, model, kind, query, location, image) {
  const picture = image ? imagePart(image) : null
  const parts = []
  if (picture) parts.push(picture)
  parts.push({ text: promptFor(kind, query, location, !!picture) })

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1 },
      }),
    }
  )

  const raw = await response.text()
  if (!response.ok) {
    return { ok: false, status: response.status, error: raw.slice(0, 400) }
  }

  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, status: 502, error: 'Antwort war kein JSON' }
  }

  const candidate = data.candidates?.[0]
  const text = (candidate?.content?.parts || [])
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('\n')
    .trim()
  const parsed = extractJson(text)
  return {
    ok: true,
    answer: asText(parsed?.answer, 1200),
    offers: normalizeOffers(parsed?.offers),
    places: normalizePlaces(parsed?.places),
    note: asText(parsed?.note, 280),
    sources: sourcesFromGrounding(candidate),
    sawImage: !!picture,
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const apiKey = geminiKey()
  if (!apiKey) {
    return res.status(503).json({
      error:
        'Die Internetsuche braucht den Gemini-Schlüssel (GEMINI_API_KEY). Über Groq kann nicht im Internet gesucht werden.',
    })
  }

  const query = asText(req.body?.query, MAX_QUERY)
  const location = asText(req.body?.location, 80)
  const kind = searchKind(req.body?.kind)
  const image = typeof req.body?.image === 'string' ? req.body.image : ''
  if (!query && !image) return res.status(400).json({ error: 'Wonach soll gesucht werden?' })

  const effectiveQuery = query || 'Was ist auf dem Foto zu sehen, und wo bekommt man es?'

  let lastError = 'Suche fehlgeschlagen'
  for (const model of candidateModels()) {
    try {
      const result = await searchWithModel(apiKey, model, kind, effectiveQuery, location, image)
      if (!result.ok) {
        lastError = result.error
        console.error('Internetsuche:', model, result.status, result.error)
        const toolUnsupported =
          result.status === 400 && /google_search|not supported|unsupported/i.test(result.error)
        if (result.status !== 404 && !toolUnsupported) break
        continue
      }
      return res.status(200).json({
        kind,
        query: effectiveQuery,
        searchedAt: new Date().toISOString(),
        answer: result.answer,
        offers: result.offers,
        places: result.places,
        sources: result.sources,
        note: result.note,
        sawImage: result.sawImage,
        readOnly: true,
      })
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unbekannter Fehler'
      console.error('Internetsuche:', model, error)
    }
  }

  return res.status(502).json({ error: `Internetsuche fehlgeschlagen: ${lastError.slice(0, 300)}` })
}
