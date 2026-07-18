// ═══════════════════════════════════════════════════════════════
// SkinBox Steam Proxy + Discord OAuth Worker
// Secrets stored via: wrangler secret put <NAME> --name steam-proxy
//   - DISCORD_CLIENT_SECRET
//   - DISCORD_BOT_TOKEN
// ═══════════════════════════════════════════════════════════════

const DISCORD_CLIENT_ID =  + DISCORD_CLIENT_ID + ;
const REDIRECT_URI      =  + REDIRECT_URI + ;
const VOTE_PAGE_URL     =  + VOTE_PAGE_URL + ;
const SERVER_ID         =  + SERVER_ID + ;

// Allowed roles — add more here anytime
const ALLOWED_ROLES = ["1370555709170909194", "1333576432550674512", "992199594228338768", "924545738137026560", "1068410678194470962", "1068408267002363975"];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Allow-Headers': '*',
};

addEventListener('fetch', event => {
  event.respondWith(handle(event.request));
});

async function handle(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(req.url);

  // ── DISCORD LOGIN ──────────────────────────────────────────────────────────
  if (url.pathname === '/discord-login') {
    const params = new URLSearchParams({
      client_id:     DISCORD_CLIENT_ID,
      redirect_uri:  REDIRECT_URI,
      response_type: 'code',
      scope:         'identify guilds.members.read',
    });
    return Response.redirect('https://discord.com/oauth2/authorize?' + params.toString(), 302);
  }

  // ── DISCORD CALLBACK ───────────────────────────────────────────────────────
  if (url.pathname === '/discord-callback') {
    const code = url.searchParams.get('code');
    if (!code) return Response.redirect(VOTE_PAGE_URL + '?auth_error=no_code', 302);

    try {
      // 1. Exchange code for token
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type:    'authorization_code',
          code,
          redirect_uri:  REDIRECT_URI,
        }).toString(),
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) throw new Error('Token exchange failed: ' + JSON.stringify(tokenData));

      // 2. Get user info
      const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { 'Authorization': 'Bearer ' + tokenData.access_token },
      });
      const user = await userRes.json();
      const discordName = user.discriminator && user.discriminator !== '0'
        ? user.username + '#' + user.discriminator
        : user.username;
      const avatar = user.avatar
        ? 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png'
        : '';

      // 3. Check server membership + roles using bot token
      const memberRes = await fetch(
        'https://discord.com/api/guilds/' + SERVER_ID + '/members/' + user.id,
        { headers: { 'Authorization': 'Bot ' + DISCORD_BOT_TOKEN } }
      );

      if (memberRes.status === 404) {
        // Not in server
        return Response.redirect(VOTE_PAGE_URL + '?auth_error=not_in_server', 302);
      }

      const member = await memberRes.json();
      const memberRoles = member.roles || [];

      // 4. Check if they have any allowed role
      const hasRole = ALLOWED_ROLES.some(r => memberRoles.includes(r));
      if (!hasRole) {
        return Response.redirect(VOTE_PAGE_URL + '?auth_error=no_role', 302);
      }

      // 5. Pass user info + their roles back to the page
      const params = new URLSearchParams({
        discord_name:   discordName,
        discord_id:     user.id,
        discord_avatar: avatar,
        member_roles:   memberRoles.join(','),
      });
      return Response.redirect(VOTE_PAGE_URL + '?' + params.toString(), 302);

    } catch(e) {
      return Response.redirect(VOTE_PAGE_URL + '?auth_error=' + encodeURIComponent(e.message), 302);
    }
  }

  // ── STEAM COLLECTION DETAILS ───────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/collection') {
    try {
      const body = await req.text();
      const r = await fetch(
        'https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/',
        {
          method: 'POST', body,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0',
            'Origin': 'https://steamcommunity.com',
            'Referer': 'https://steamcommunity.com/',
          }
        }
      );
      return new Response(await r.text(), {
        headers: { 'Content-Type': 'application/json', ...CORS }
      });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...CORS }
      });
    }
  }

  // ── IMAGE PROXY ────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.searchParams.has('url')) {
    const imgUrl = url.searchParams.get('url');
    try {
      const r = await fetch(imgUrl, {
        headers: {
          'Referer': 'https://steamcommunity.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.arrayBuffer();
      return new Response(blob, {
        headers: {
          'Content-Type': r.headers.get('Content-Type') || 'image/jpeg',
          'Cache-Control': 'public, max-age=604800',
          ...CORS
        }
      });
    } catch(e) {
      const pixel = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      const buf = Uint8Array.from(atob(pixel), c => c.charCodeAt(0));
      return new Response(buf, { headers: { 'Content-Type': 'image/gif', ...CORS } });
    }
  }

  // ── STEAM API PROXY ────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return new Response('Steam proxy is running OK', { status: 200, headers: CORS });
  }

  try {
    const body = await req.text();
    const r = await fetch(
      'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
      {
        method: 'POST', body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin': 'https://steamcommunity.com',
          'Referer': 'https://steamcommunity.com/',
        }
      }
    );
    const text = await r.text();
    try {
      JSON.parse(text);
      return new Response(text, { headers: { 'Content-Type': 'application/json', ...CORS } });
    } catch(e) {
      return new Response(JSON.stringify({ error: 'Steam returned non-JSON', body: text.substring(0, 200) }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...CORS }
      });
    }
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS }
    });
  }
}
