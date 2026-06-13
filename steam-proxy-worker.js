addEventListener('fetch', event => {
  event.respondWith(handle(event.request))
})

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Allow-Headers': '*',
}

async function handle(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  const url = new URL(req.url)

  // Image proxy: GET /img?url=https://steamuserimages...
  if (req.method === 'GET' && url.searchParams.has('url')) {
    const imgUrl = url.searchParams.get('url')
    try {
      const r = await fetch(imgUrl, {
        headers: {
          'Referer': 'https://steamcommunity.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        }
      })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const blob = await r.arrayBuffer()
      return new Response(blob, {
        headers: {
          'Content-Type': r.headers.get('Content-Type') || 'image/jpeg',
          'Cache-Control': 'public, max-age=604800', // cache 7 days
          ...CORS
        }
      })
    } catch (e) {
      // Return a 1x1 transparent pixel as fallback
      const pixel = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      const buf = Uint8Array.from(atob(pixel), c => c.charCodeAt(0))
      return new Response(buf, {
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'public, max-age=60', ...CORS }
      })
    }
  }

  // Steam API proxy: POST with skin IDs
  if (req.method !== 'POST') {
    return new Response('Steam proxy is running OK', { status: 200, headers: CORS })
  }

  try {
    const body = await req.text()
    const r = await fetch(
      'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
      {
        method: 'POST',
        body: body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin': 'https://steamcommunity.com',
          'Referer': 'https://steamcommunity.com/',
        }
      }
    )
    const text = await r.text()
    try {
      const data = JSON.parse(text)
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json', ...CORS }
      })
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Steam returned non-JSON', body: text.substring(0, 200) }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...CORS }
      })
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS }
    })
  }
}
