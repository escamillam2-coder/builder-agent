const https = require('https');

// Your Google Sheet ID
const SHEET_ID = '196K2RgOA-LnEziBkcR6hPKzZwJsmIKTDPLpV9hZWFuI';

// ── Google Auth ───────────────────────────────────────────────────────────────
function getServiceAccount() {
  try {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('No service account found');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Service account parse error:', e.message);
    return null;
  }
}

function base64url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getGoogleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));

  const signingInput = `${header}.${payload}`;
  const crypto = require('crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(sa.private_key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signingInput}.${signature}`;

  return new Promise((resolve, reject) => {
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) resolve(parsed.access_token);
          else reject(new Error('No access token: ' + data));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Sheet Read ────────────────────────────────────────────────────────────────
function fetchSheetTab(tabName, token) {
  return new Promise((resolve) => {
    const path = `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tabName)}`;
    const options = {
      hostname: 'sheets.googleapis.com',
      path,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body).values || []); }
        catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

// ── Sheet Write ───────────────────────────────────────────────────────────────
function writeToSheet(tabName, range, values, token) {
  return new Promise((resolve, reject) => {
    const fullRange = `${tabName}!${range}`;
    const body = JSON.stringify({ range: fullRange, majorDimension: 'ROWS', values });
    const path = `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(fullRange)}?valueInputOption=USER_ENTERED`;
    const options = {
      hostname: 'sheets.googleapis.com',
      path,
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Append a row to Agent Log
function appendAgentLog(token, role, tab, field, oldVal, newVal, summary) {
  return new Promise((resolve) => {
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
    const row = [[timestamp, role, tab, field, oldVal, newVal, summary]];
    const body = JSON.stringify({ majorDimension: 'ROWS', values: row });
    const range = encodeURIComponent('🤖 Agent Log!A:G');
    const path = `/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const options = {
      hostname: 'sheets.googleapis.com',
      path,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

// ── Weather ───────────────────────────────────────────────────────────────────
function fetchHoustonWeather() {
  return new Promise((resolve) => {
    const path = '/v1/forecast?latitude=29.7604&longitude=-95.3698&daily=temperature_2m_max,precipitation_probability_max,windspeed_10m_max,weathercode&timezone=America%2FChicago&forecast_days=7&temperature_unit=fahrenheit&windspeed_unit=mph';
    const req = https.request({ hostname: 'api.open-meteo.com', path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const daily = data.daily;
          const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
          let forecast = '--- LIVE HOUSTON WEATHER (Next 7 Days) ---\n';
          for (let i = 0; i < daily.time.length; i++) {
            const date = new Date(daily.time[i] + 'T12:00:00');
            const dayName = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : days[date.getDay()];
            const rain = daily.precipitation_probability_max[i];
            const wind = daily.windspeed_10m_max[i];
            const high = Math.round(daily.temperature_2m_max[i]);
            const code = daily.weathercode[i];
            let condition = code >= 95 ? 'Thunderstorms' : code >= 80 ? 'Rain showers' : code >= 61 ? 'Rainy' : code >= 45 ? 'Foggy' : code >= 3 ? 'Cloudy' : 'Clear';
            let risk = rain >= 70 || code >= 80 ? 'HIGH RISK ❌ avoid outdoor work' : rain >= 40 || wind >= 25 ? 'MODERATE RISK ⚠️ plan carefully' : wind >= 35 ? 'HIGH WIND ❌ no roof/truss work' : 'LOW RISK ✅';
            forecast += `${dayName}: ${high}°F, ${condition}, ${rain}% rain, ${wind}mph wind — ${risk}\n`;
          }
          resolve(forecast);
        } catch { resolve('Weather temporarily unavailable.\n'); }
      });
    });
    req.on('error', () => resolve('Weather temporarily unavailable.\n'));
    req.end();
  });
}

// ── Format Sheet Data ─────────────────────────────────────────────────────────
function formatTab(rows, name) {
  if (!rows || rows.length === 0) return `${name}: No data yet.\n`;
  return `--- ${name} ---\n${rows.map(r => r.join(' | ')).join('\n')}\n\n`;
}

// ── Build System Prompt ───────────────────────────────────────────────────────
const BASE_SYSTEM = `You are BUILDER — an expert AI Project Manager for a family building a custom home in Houston, Texas. You are their GC advisor, schedule manager, dependency tracker, and subcontractor accountability coach.

PROJECT: Single family custom home, 2 stories, 2,500–3,500 sqft, City of Houston TX. Family acting as own GC. Concrete poured March 6, 2026.

FAMILY ROLES:
- DAD: On-site daily. Short sentences. Action items only. No theory.
- MOM: Manages budget and decisions. Lead with dollar impact. No jargon.
- COMMAND (Michael): Full oversight. Complete strategic picture.
- GENERAL: Learning mode. Warm, clear, encouraging.

HOUSTON COH REAL INSPECTION SEQUENCE:
1. Windstorm inspection (clips + strapping) — BEFORE any sheathing
2. Sheathing installation
3. Nail Pattern inspection — SEPARATE from windstorm. Flood plain = elevation cert required here
4. Dry-in (siding + roof)
5. MEP Roughs — Plumbing first, Electrical second, HVAC last
6. All 3 MEP inspections pass individually
7. Full Frame inspection — windows and doors MUST be poly-sealed for this
8. Insulation inspection
9. Drywall starts

CRITICAL RULES:
- No framing before 28-day cure (earliest April 3, 2026)
- No MEP before framing inspection
- No sheathing before windstorm inspection
- No drywall before insulation inspection
- No CO before all finals pass
- COH: 832-394-8800 | houstonpermittingcenter.org | 24-48hr notice

CONTRACTOR RULES: Hold 10% retention. No verbal change orders. Verify TX licenses at tdlr.texas.gov.

LONG LEAD URGENCY: Windows (4-10 wk), Cabinets (8-12 wk), Flooring (3-6 wk), Fixtures (4-8 wk).

SHEET WRITE CAPABILITY: You can update the Google Sheet directly. When someone reports something happened, update the relevant tab and log it.

WHEN UPDATING THE SHEET — add one <SHEET_UPDATE> block per change at the very END of your message. Each block must be valid JSON on a single line:

<SHEET_UPDATE>
{"tab": "📋 Detailed Phase Plan", "range": "I8", "value": "✅ COMPLETE", "log": {"role": "Dad", "tab": "📋 Detailed Phase Plan", "field": "Step 2.6 Status", "old": "⚠️ VERIFY", "new": "✅ COMPLETE", "summary": "Dad confirmed post-tension stressing happened March 13"}}
</SHEET_UPDATE>

IMPORTANT RULES FOR SHEET UPDATES:
- Only include SHEET_UPDATE when something actually changed — not for questions
- Each update block must contain valid JSON — no trailing commas, no line breaks inside JSON
- For the Detailed Phase Plan, status is in column I — use ranges like I8, I9, I10 etc.
- For Inspections tab, result is in column F — use ranges like F5, F6 etc.
- For Agent Log, always use appendAgentLog (handled automatically)
- You can include multiple SHEET_UPDATE blocks if multiple things changed
- After all updates, tell the user what you changed in plain language

WHEN A DELAY IS REPORTED: Show ripple impact, suggest recovery options, identify who's affected, offer to draft a message, note budget impact, and update the sheet.

You have full construction knowledge. Answer ANY building question Dad asks — materials, methods, codes, costs, everything. You are their expert on site.`;

const REFERENCE_KNOWLEDGE = `
CONTRACTOR HIRING: Never pay >10% upfront. Verify TX licenses. Get COI naming owner as additional insured. Itemized bids only. Hold 10-15% retention. Lien waivers before final payment.

FRAMING: Verify foundation square first. Lumber <19% moisture (KD stamp). PT lumber on sill plates. Fire blocking every 10ft vertically. Hurricane straps required. Photograph everything before MEP.

MEP ORDER: Plumbing first (most penetrations), Electrical second (routes around pipes), HVAC last (fills remaining space).

INSULATION: R-38 attic min (R-49 recommended Houston). R-13/15 walls. Radiant barrier in attic. Air seal all penetrations before drywall. Thermal camera inspection after install.

BLUE TAPE WALKTHROUGH: Test every GFCI. Check all 3-way switches. Verify smoke detector interconnection. Test water pressure with 3 faucets + toilet simultaneously. Check all doors square. Video everything before accepting.`;

// ── Main Handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, system } = req.body;

    // Get Google token
    const sa = getServiceAccount();
    let token = null;
    if (sa) {
      try { token = await getGoogleToken(sa); }
      catch (e) { console.error('Token error:', e.message); }
    }

    // Read sheet data + weather in parallel
    const [phases, contractors, inspections, budget, longLead, weather] = await Promise.all([
      token ? fetchSheetTab('📋 Detailed Phase Plan', token) : Promise.resolve([]),
      token ? fetchSheetTab('👷 Contractors', token) : Promise.resolve([]),
      token ? fetchSheetTab('🔍 All Inspections', token) : Promise.resolve([]),
      token ? fetchSheetTab('💰 Budget', token) : Promise.resolve([]),
      token ? fetchSheetTab('📦 Long Lead Orders', token) : Promise.resolve([]),
      fetchHoustonWeather(),
    ]);

    // Today's date
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'America/Chicago'
    });

    // Build enhanced system prompt
    const enhancedSystem = BASE_SYSTEM + '\n\n' + REFERENCE_KNOWLEDGE + `

TODAY'S DATE: ${today} (Houston TX). Always use this for all calculations and urgency.

LIVE PROJECT DATA:
${formatTab(phases.slice(0, 80), '📋 Detailed Phase Plan')}
${formatTab(contractors, '👷 Contractors')}
${formatTab(inspections, '🔍 All Inspections')}
${formatTab(budget, '💰 Budget')}
${formatTab(longLead, '📦 Long Lead Orders')}

LIVE WEATHER:
${weather}

Sheet write is ${token ? 'ENABLED — you can update the sheet' : 'read-only mode — token unavailable'}.`;

    // Call Claude
    const payload = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      system: enhancedSystem,
      messages,
    });

    const claudeResponse = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(payload),
        },
      };
      const request = https.request(options, (r) => {
        let body = '';
        r.on('data', chunk => body += chunk);
        r.on('end', () => {
          try { resolve({ status: r.statusCode, body: JSON.parse(body) }); }
          catch (e) { reject(e); }
        });
      });
      request.on('error', reject);
      request.write(payload);
      request.end();
    });

    if (!claudeResponse.body.content) {
      return res.status(claudeResponse.status).json(claudeResponse.body);
    }

    // Extract reply text
    let reply = claudeResponse.body.content.map(c => c.text || '').join('');

    // Parse and execute ALL sheet updates (handles multiple per response)
    const updateMatches = [...reply.matchAll(/<SHEET_UPDATE>([\s\S]*?)<\/SHEET_UPDATE>/g)];
    const updatesExecuted = [];

    if (updateMatches.length > 0 && token) {
      for (const match of updateMatches) {
        try {
          const update = JSON.parse(match[1].trim());

          // Write to the sheet
          await writeToSheet(update.tab, update.range, [[update.value]], token);

          // Log the change
          if (update.log) {
            await appendAgentLog(
              token,
              update.log.role || 'BUILDER',
              update.log.tab,
              update.log.field,
              update.log.old,
              update.log.new,
              update.log.summary
            );
          }

          updatesExecuted.push(update.log ? update.log.summary : update.tab);
        } catch (e) {
          console.error('Sheet write error:', e.message);
        }
      }

      // Remove ALL JSON blocks from reply shown to user
      reply = reply.replace(/<SHEET_UPDATE>[\s\S]*?<\/SHEET_UPDATE>/g, '').trim();

      if (updatesExecuted.length > 0) {
        reply += `\n\n✅ **Sheet updated (${updatesExecuted.length} change${updatesExecuted.length > 1 ? 's' : ''})** — check the 🤖 Agent Log tab to verify.`;
      }
    } else if (updateMatches.length > 0 && !token) {
      // Remove blocks even if no token
      reply = reply.replace(/<SHEET_UPDATE>[\s\S]*?<\/SHEET_UPDATE>/g, '').trim();
      reply += '\n\n⚠️ Sheet write unavailable — update manually.';
    }

    // Return modified response
    const responseBody = {
      ...claudeResponse.body,
      content: [{ type: 'text', text: reply }]
    };

    return res.status(200).json(responseBody);

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
