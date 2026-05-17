const https = require('https');
const crypto = require('crypto');

const SHEET_ID = '196K2RgOA-LnEziBkcR6hPKzZwJsmIKTDPLpV9hZWFuI';

// ── Google Auth ───────────────────────────────────────────────────────────────
function getServiceAccount() {
  try {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('No service account');
    return JSON.parse(raw);
  } catch (e) { console.error('SA error:', e.message); return null; }
}

function base64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}

async function getGoogleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header  = base64url(JSON.stringify({ alg:'RS256', typ:'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  }));
  const sigInput = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(sigInput);
  const sig = sign.sign(sa.private_key,'base64')
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const jwt = `${sigInput}.${sig}`;

  return new Promise((resolve, reject) => {
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const opts = {
      hostname:'oauth2.googleapis.com', path:'/token', method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}
    };
    const req = https.request(opts, (res) => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ try{ const p=JSON.parse(d); p.access_token?resolve(p.access_token):reject(new Error(d)); }catch(e){reject(e);} });
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

// ── Sheet Read ────────────────────────────────────────────────────────────────
function readTab(tab, token) {
  return new Promise((resolve) => {
    const path = `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tab)}`;
    const req = https.request(
      { hostname:'sheets.googleapis.com', path, method:'GET', headers:{Authorization:`Bearer ${token}`} },
      (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d).values||[]);}catch{resolve([]);} }); }
    );
    req.on('error',()=>resolve([])); req.end();
  });
}

// ── Sheet Write ───────────────────────────────────────────────────────────────
function writeCell(tab, range, value, token) {
  return new Promise((resolve, reject) => {
    const fullRange = `${tab}!${range}`;
    const body = JSON.stringify({ range: fullRange, majorDimension:'ROWS', values:[[value]] });
    const path = `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(fullRange)}?valueInputOption=USER_ENTERED`;
    const opts = {
      hostname:'sheets.googleapis.com', path, method:'PUT',
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    };
    const req = https.request(opts,(res)=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve(d));});
    req.on('error',reject); req.write(body); req.end();
  });
}

function appendRows(tab, rows, token) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ majorDimension:'ROWS', values: rows });
    const range = encodeURIComponent(`${tab}!A:F`);
    const path = `/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const opts = {
      hostname:'sheets.googleapis.com', path, method:'POST',
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    };
    const req = https.request(opts,(res)=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve(d));});
    req.on('error',()=>resolve(null)); req.write(body); req.end();
  });
}

// ── Smart row finder ──────────────────────────────────────────────────────────
async function smartWrite(token, tab, searchVal, writeCol, writeVal, log) {
  try {
    const rows = await readTab(tab, token);
    let rowNum = null;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i][0] && rows[i][0].toString().trim() === searchVal.toString().trim()) {
        rowNum = i + 1; break;
      }
    }
    if (!rowNum) { console.error(`Row not found: ${searchVal}`); return false; }
    const colLetter = String.fromCharCode(64 + writeCol);
    await writeCell(tab, `${colLetter}${rowNum}`, writeVal, token);
    if (log) await appendAgentLog(token, log.role, tab, log.field, log.old, log.new, log.summary);
    return true;
  } catch(e) { console.error('smartWrite error:', e.message); return false; }
}

// ── Agent Log ─────────────────────────────────────────────────────────────────
function appendAgentLog(token, role, tab, field, oldVal, newVal, summary) {
  const ts = new Date().toLocaleString('en-US',{timeZone:'America/Chicago'});
  return appendRows('🤖 Agent Log', [[ts, role||'BUILDER', tab, field, oldVal, newVal, summary]], token)
    .catch(e => console.error('AgentLog error:', e.message));
}

// ── Conversation Log ──────────────────────────────────────────────────────────
function logConversation(token, role, device, type, message, sessionId) {
  const ts = new Date().toLocaleString('en-US',{timeZone:'America/Chicago'});
  const truncated = message.length > 500 ? message.substring(0, 497) + '...' : message;
  return appendRows('💬 Conversation Log', [[ts, role, device, type, truncated, sessionId]], token)
    .catch(e => console.error('ConvLog error:', e.message));
}

// ── Parse config from sheet ───────────────────────────────────────────────────
function parseConfig(rows) {
  const config = {};
  for (const row of rows) {
    if (row && row[0] && row[1]) {
      config[row[0].trim()] = row[1].trim();
    }
  }
  return config;
}

// ── Format sheet data ─────────────────────────────────────────────────────────
function fmt(rows, name, maxRows = 999) {
  if (!rows || rows.length === 0) return `${name}: No data yet.\n`;
  return `--- ${name} ---\n${rows.slice(0,maxRows).map(r=>r.join(' | ')).join('\n')}\n\n`;
}

// ── Weather ───────────────────────────────────────────────────────────────────
function fetchWeather() {
  return new Promise((resolve) => {
    const path = '/v1/forecast?latitude=29.7604&longitude=-95.3698&daily=temperature_2m_max,precipitation_probability_max,windspeed_10m_max,weathercode&timezone=America%2FChicago&forecast_days=7&temperature_unit=fahrenheit&windspeed_unit=mph';
    const req = https.request({hostname:'api.open-meteo.com', path, method:'GET'}, (res) => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{
        try {
          const data = JSON.parse(d).daily;
          const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
          let out = '--- LIVE HOUSTON WEATHER ---\n';
          for (let i = 0; i < data.time.length; i++) {
            const date = new Date(data.time[i]+'T12:00:00');
            const day = i===0?'Today':i===1?'Tomorrow':days[date.getDay()];
            const rain = data.precipitation_probability_max[i];
            const wind = data.windspeed_10m_max[i];
            const high = Math.round(data.temperature_2m_max[i]);
            const code = data.weathercode[i];
            const cond = code>=95?'Thunderstorms':code>=80?'Rain showers':code>=61?'Rainy':code>=3?'Cloudy':'Clear';
            const risk = (rain>=70||code>=80)?'HIGH RISK ❌':(rain>=40||wind>=25)?'MODERATE ⚠️':wind>=35?'HIGH WIND ❌':'LOW RISK ✅';
            out += `${day}: ${high}°F ${cond} ${rain}% rain ${wind}mph — ${risk}\n`;
          }
          resolve(out);
        } catch { resolve('Weather unavailable.\n'); }
      });
    });
    req.on('error',()=>resolve('Weather unavailable.\n')); req.end();
  });
}

// ── Build system prompt from config + sheet data ──────────────────────────────
function buildSystemPrompt(config, phases, contractors, inspections, budget, longLead, knowledge, convLog, weather, today, sessionId) {

  // Parse recent conversation for context
  const recentConv = convLog.slice(-40)
    .filter(r => r && r[4] && r[3] !== 'SESSION_START')
    .map(r => `[${r[1]||'?'} — ${r[0]||''}]: ${r[4]||''}`)
    .join('\n');

  // Parse handoff notes
  const handoff = config['handoff_notes'] || 'No prior session summary available.';
  const lastSession = config['last_session_date'] || 'Unknown';

  // Build role definitions from config
  const dadName = config['dad_name'] || 'Dad';
  const momName = config['mom_name'] || 'Mom';
  const commandName = config['command_name'] || 'Command';

  // Build custom rules
  const customRules = [1,2,3,4,5]
    .map(i => config[`custom_rule_${i}`])
    .filter(r => r && !r.includes('[Add your'))
    .join('\n- ');

  return `You are BUILDER — an AI Project Manager for a family building a custom home in Houston, Texas.

SESSION ID: ${sessionId}
TODAY: ${today} (Houston TX time)
LAST SESSION: ${lastSession}
LAST SESSION SUMMARY: ${handoff}

PROJECT: ${config['project_name'] || 'Houston Custom Home'}
Address: ${config['project_address'] || '[Not set]'}
Jurisdiction: ${config['jurisdiction'] || 'City of Houston (COH)'}
Flood Zone: ${config['flood_zone'] || '[Not verified — check hcfcd.org]'}
Size: ${config['square_footage'] || '2,500-3,500 sqft'}, ${config['stories'] || '2'} stories
Concrete poured: ${config['concrete_pour_date'] || 'March 6, 2026'}
Framing earliest: ${config['framing_earliest'] || 'April 6, 2026'}
Budget: ${config['total_budget'] || '[Not set]'}

FAMILY ROLES:
- ${dadName} (Dad): ${config['dad_tone'] || 'Short sentences. Action items. No theory.'}
- ${momName} (Mom): ${config['mom_tone'] || 'Lead with dollar impact. No jargon.'}
- ${commandName} (Command): ${config['command_tone'] || 'Full strategic picture.'}
- General: ${config['general_tone'] || 'Warm, clear, encouraging. Coach and teach.'}

KEY CONTACTS:
${Object.entries(config).filter(([k])=>k.startsWith('contact_')).map(([k,v])=>`- ${k.replace('contact_','')}: ${v}`).join('\n')}

${customRules ? `CUSTOM RULES (always follow these):\n- ${customRules}` : ''}

HOUSTON COH INSPECTION SEQUENCE (real-world confirmed):
1. Windstorm inspection (clips + strapping) — BEFORE any sheathing
2. Sheathing installation
3. Nail Pattern inspection — SEPARATE from windstorm
   → Flood plain properties: elevation cert required at nail pattern
4. Dry-in (siding + roof)
5. MEP Roughs: Plumbing FIRST, Electrical SECOND, HVAC LAST
6. All 3 MEP inspections pass individually
7. Full Frame inspection — windows and doors MUST be poly-sealed
8. Insulation inspection
9. Drywall begins

COH: ${config['coh_phone']||'832-394-8800'} | ${config['coh_website']||'houstonpermittingcenter.org'} | ${config['inspection_notice_hours']||'24-48'}hr notice
Retention: Hold ${config['retention_percentage']||'10%'} on all contractor payments
No verbal change orders. Verify TX licenses at tdlr.texas.gov.

BEHAVIOR:
- Check weather: ${config['always_check_weather']||'YES'}
- Auto log changes: ${config['auto_log_changes']||'YES'}
- Show ripple on delay: ${config['show_ripple_on_delay']||'YES'}
- Draft messages on delay: ${config['draft_messages_on_delay']||'YES'}
- Ask before saving lesson: ${config['ask_before_saving_lesson']||'YES'}
- Response length: ${config['max_response_length']||'MEDIUM'}

SHEET WRITE INSTRUCTIONS:
When something changes, add SHEET_UPDATE blocks at END of response.
Use stepId to find rows — never guess cell addresses.

For Detailed Phase Plan (columns: 4=PlanStart 5=PlanEnd 6=ActStart 7=ActEnd 8=Duration 9=Status 10=COH 12=Notes):
<SHEET_UPDATE>
{"tab": "📋 Detailed Phase Plan", "stepId": "2.6", "column": 9, "value": "✅ COMPLETE", "log": {"role": "Dad", "tab": "📋 Detailed Phase Plan", "field": "Step 2.6 Status", "old": "⚠️ VERIFY", "new": "✅ COMPLETE", "summary": "Post-tension stressing confirmed"}}
</SHEET_UPDATE>

For Inspections (columns: 5=SchedDate 6=Result 7=Inspector 8=Badge 9=Corrections):
<SHEET_UPDATE>
{"tab": "🔍 All Inspections", "stepId": "Foundation Pre-Pour", "column": 6, "value": "✅ PASSED", "log": {"role": "Dad", "tab": "🔍 All Inspections", "field": "Result", "old": "⏳ PENDING", "new": "✅ PASSED", "summary": "Inspection passed"}}
</SHEET_UPDATE>

For Knowledge Base (new lesson):
<SHEET_UPDATE>
{"tab": "📚 Knowledge Base", "appendRow": true, "values": ["[auto]", "Category", "Lesson in one sentence", "Why it matters", "Dad — Home 1", "May 2026", "1", "⬜ Pending"], "log": {"role": "Dad", "tab": "📚 Knowledge Base", "field": "New Lesson", "old": "—", "new": "lesson", "summary": "Lesson added"}}
</SHEET_UPDATE>

For Agent Config (update handoff notes at END of every session):
<SHEET_UPDATE>
{"tab": "⚙️ Agent Config", "stepId": "handoff_notes", "column": 2, "value": "2-3 sentence summary of this conversation", "log": {"role": "BUILDER", "tab": "⚙️ Agent Config", "field": "handoff_notes", "old": "prior", "new": "new summary", "summary": "Session summary updated"}}
</SHEET_UPDATE>

IMPORTANT: At the END of every response that contains meaningful information, update handoff_notes with a 2-3 sentence summary of what was discussed. This is how you remember between sessions.

WHEN TO ADD KNOWLEDGE BASE LESSONS:
When Dad shares a mistake, a tip, or a lesson — ask "Should I save this as a lesson for future builds?" If yes, append to Knowledge Base.

WHEN A DELAY IS REPORTED:
1. Acknowledge clearly
2. Show ripple impact with specific dates
3. Suggest 2-3 recovery options
4. Identify who is affected
5. Offer to draft stakeholder message
6. Note budget impact
7. Update sheet

You have FULL construction knowledge. Answer ANY building question — materials, methods, codes, costs, tools, everything. You are the family's expert on everything construction related.

RECENT CONVERSATION HISTORY (last 40 exchanges):
${recentConv || 'No prior conversation history. This appears to be the first session.'}

LIVE PROJECT DATA:
${fmt(phases.slice(0,80), '📋 Detailed Phase Plan')}
${fmt(contractors, '👷 Contractors')}
${fmt(inspections, '🔍 All Inspections')}
${fmt(budget, '💰 Budget')}
${fmt(longLead, '📦 Long Lead Orders')}
${fmt(knowledge.slice(0,36), '📚 Knowledge Base')}

LIVE WEATHER:
${weather}`;
}

// ── Main Handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, system, role: userRole, device: userDevice } = req.body;

    // Generate session ID (shared across a browser session)
    const sessionId = `S${Date.now().toString(36).toUpperCase()}`;

    // Get Google token
    const sa = getServiceAccount();
    let token = null;
    if (sa) {
      try { token = await getGoogleToken(sa); }
      catch(e) { console.error('Token error:', e.message); }
    }

    // Read all sheet data in parallel
    const [
      config_raw, phases, contractors, inspections,
      budget, longLead, knowledge, convLog, weather
    ] = await Promise.all([
      token ? readTab('⚙️ Agent Config', token) : Promise.resolve([]),
      token ? readTab('📋 Detailed Phase Plan', token) : Promise.resolve([]),
      token ? readTab('👷 Contractors', token) : Promise.resolve([]),
      token ? readTab('🔍 All Inspections', token) : Promise.resolve([]),
      token ? readTab('💰 Budget', token) : Promise.resolve([]),
      token ? readTab('📦 Long Lead Orders', token) : Promise.resolve([]),
      token ? readTab('📚 Knowledge Base', token) : Promise.resolve([]),
      token ? readTab('💬 Conversation Log', token) : Promise.resolve([]),
      fetchWeather(),
    ]);

    const config = parseConfig(config_raw);
    const today = new Date().toLocaleDateString('en-US',{
      weekday:'long', year:'numeric', month:'long', day:'numeric',
      timeZone:'America/Chicago'
    });

    // Build system prompt from config + live data
    const systemPrompt = buildSystemPrompt(
      config, phases, contractors, inspections,
      budget, longLead, knowledge, convLog, weather, today, sessionId
    );

    // Log user message
    const lastUserMsg = messages[messages.length - 1];
    const isFirstMsg = messages.length === 1;

    if (token && lastUserMsg?.role === 'user') {
      // Log session start on first message
      if (isFirstMsg) {
        const priorCount = convLog.filter(r => r && r[3] === 'MESSAGE').length;
        const handoff = config['handoff_notes'] || 'No prior history';
        await logConversation(token, 'SYSTEM', '—', 'SESSION_START',
          `New session ${sessionId}. Read ${priorCount} prior messages. Last summary: ${handoff.substring(0,150)}`,
          sessionId);

        // Update last session date
        await smartWrite(token, '⚙️ Agent Config', 'last_session_date', 2, today, null);
      }

      // Log user message
      await logConversation(token,
        userRole || 'User',
        userDevice || 'Browser',
        'MESSAGE',
        lastUserMsg.content,
        sessionId
      );
    }

    // Call Claude
    const payload = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      system: systemPrompt,
      messages,
    });

    const claudeData = await new Promise((resolve, reject) => {
      const opts = {
        hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
        headers:{
          'Content-Type':'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version':'2023-06-01',
          'Content-Length': Buffer.byteLength(payload)
        }
      };
      const req2 = https.request(opts, (r) => {
        let d=''; r.on('data',c=>d+=c);
        r.on('end',()=>{ try{resolve({status:r.statusCode,body:JSON.parse(d)});}catch(e){reject(e);} });
      });
      req2.on('error',reject); req2.write(payload); req2.end();
    });

    if (!claudeData.body.content) {
      return res.status(claudeData.status).json(claudeData.body);
    }

    let reply = claudeData.body.content.map(c=>c.text||'').join('');

    // Process all SHEET_UPDATE blocks
    const updateMatches = [...reply.matchAll(/<SHEET_UPDATE>([\s\S]*?)<\/SHEET_UPDATE>/g)];
    const updatesExecuted = [];

    if (updateMatches.length > 0 && token) {
      for (const match of updateMatches) {
        try {
          const update = JSON.parse(match[1].trim());

          if (update.appendRow && update.values) {
            // Append new row (Knowledge Base lessons etc)
            const range = encodeURIComponent(`${update.tab}!A:H`);
            const path = `/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
            const body = JSON.stringify({ majorDimension:'ROWS', values:[update.values] });
            await new Promise((resolve) => {
              const opts = {
                hostname:'sheets.googleapis.com', path, method:'POST',
                headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
              };
              const r = https.request(opts,(res2)=>{let d='';res2.on('data',c=>d+=c);res2.on('end',()=>resolve(d));});
              r.on('error',resolve); r.write(body); r.end();
            });
            if (update.log) await appendAgentLog(token, update.log.role, update.log.tab, update.log.field, update.log.old, update.log.new, update.log.summary);
            updatesExecuted.push(update.log?.summary || 'Row appended to ' + update.tab);

          } else if (update.stepId && update.column) {
            // Smart write by step ID
            const ok = await smartWrite(token, update.tab, update.stepId, update.column, update.value, update.log);
            if (ok) updatesExecuted.push(update.log?.summary || `Updated ${update.tab}`);

          } else if (update.range) {
            // Direct cell write
            await writeCell(update.tab, update.range, update.value, token);
            if (update.log) await appendAgentLog(token, update.log.role, update.log.tab, update.log.field, update.log.old, update.log.new, update.log.summary);
            updatesExecuted.push(update.log?.summary || `Updated ${update.tab}`);
          }

        } catch(e) { console.error('Update error:', e.message); }
      }

      // Remove all SHEET_UPDATE blocks from visible reply
      reply = reply.replace(/<SHEET_UPDATE>[\s\S]*?<\/SHEET_UPDATE>/g, '').trim();

      if (updatesExecuted.length > 0) {
        reply += `\n\n✅ **${updatesExecuted.length} sheet update${updatesExecuted.length>1?'s':''} logged** — check 🤖 Agent Log to verify.`;
      }
    } else {
      // Still remove any blocks even if no token
      reply = reply.replace(/<SHEET_UPDATE>[\s\S]*?<\/SHEET_UPDATE>/g, '').trim();
    }

    // Log BUILDER's response to conversation log
    if (token) {
      await logConversation(token, 'BUILDER', '—', 'RESPONSE',
        reply.replace(/\*\*/g,'').substring(0, 500),
        sessionId
      );
    }

    // Return response
    return res.status(200).json({
      ...claudeData.body,
      content: [{ type:'text', text: reply }]
    });

  } catch(error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
