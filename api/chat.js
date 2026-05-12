const https = require('https');

// Your Google Sheet ID
const SHEET_ID = '196K2RgOA-LnEziBkcR6hPKzZwJsmIKTDPLpV9hZWFuI';

// Professional build knowledge baked in from expert checklists
const REFERENCE_KNOWLEDGE = `
=== PROFESSIONAL BUILD KNOWLEDGE BASE (BuildWithEmil + Industry Best Practices) ===

CONTRACTOR HIRING RULES:
- NEVER pay more than 10% upfront — red flag if demanded
- Quality contractors booked 4-8 weeks out — if immediately available, ask why
- Always verify TX licenses at tdlr.texas.gov before work starts
- Get Certificate of Insurance naming owner as additional insured — call insurer to verify
- Check Harris County court records for mechanic liens against contractors
- Require itemized bids (labor + materials separate) — lump sum hides markups
- All change orders in writing with pricing BEFORE work begins — no exceptions
- Hold 10-15% retention until punch list complete and final inspection passed
- Get lien waivers from ALL subcontractors before releasing final payment
- Negotiate $100-500/day penalty clauses for missed completion dates

FRAMING PHASE (Starting April 6 — next major milestone):
- Verify foundation square with 3-4-5 triangle method before framers arrive
- Demand moisture content testing on all lumber — must be under 19%
- Pressure-treated lumber required for all sill plates touching concrete
- Check stud spacing consistency — 16" or 24" centers for drywall alignment
- Fire blocking required every 10 feet vertically — COH inspection item
- Hurricane straps and seismic connectors required — Houston high-wind zone
- Verify window/door rough opening sizes BEFORE ordering windows
- Install backing/blocking now for TV mounts, grab bars, heavy cabinets
- PHOTOGRAPH ALL framing before insulation or drywall covers it
- Call for framing inspection BEFORE any MEP starts

ROUGH MEP SEQUENCE (After framing inspection passes):
- ORDER: Plumbing first, Electrical second, HVAC last
- Plumbing needs most penetrations; electrical routes around pipes; HVAC fills remaining space
- Run pressure test on supply lines before walls close
- Add EV charger circuit to garage rough-in now ($200 now vs $1,500 after drywall)
- HVAC: Require Manual J load calculation — square footage sizing creates problems
- HVAC: Use mastic sealant on duct joints — NOT duct tape (fails within 5 years)
- HVAC: Install turning vanes in all duct elbows
- HVAC: Demand duct blaster testing before final inspection
- Electrical: Verify AFCI circuits in all living areas (2020 NEC requirement)
- Electrical: GFCI required in bathrooms, kitchen, garage, outdoor, within 6ft of water

INSULATION (After ALL 3 MEP inspections pass):
- R-38 minimum attic (R-49 recommended for Houston — reduces cooling 15%)
- R-13 or R-15 exterior walls minimum
- Install radiant barrier — Houston hot climate reduces cooling costs 10%
- Seal rim joist with spray foam — major energy loss if skipped
- Air seal ALL electrical boxes on exterior walls before drywall
- REQUIRE thermal camera inspection after installation — reveals hidden gaps
- Photograph every wall cavity before drywall

HOUSTON-SPECIFIC RULES:
- Post-tension cables stressed at 7 days after pour — VERIFY THIS HAPPENED MARCH 13
- Houston black clay expands 30-40% when wet — post-tension slab is essential
- High-wind zone — hurricane straps required and inspected by COH
- FEMA flood zone — verify lot designation, may need elevation certificate
- HVAC must control humidity AND temperature in Houston climate
- Spray foam on roof deck creates conditioned attic — reduces HVAC load significantly

LONG LEAD ITEMS — URGENT:
- WINDOWS: 4-10 week lead — MUST ORDER THIS WEEK for April 6 framing start
- KITCHEN CABINETS: 8-12 week lead — ORDER BY APRIL 1 AT LATEST
- BATH VANITIES: 6-10 week lead — order with kitchen cabinets
- ENGINEERED FLOORING: 3-6 week lead — order by June 1
- PLUMBING FIXTURES: 4-8 week lead — order by May 1
- GARAGE DOORS: 3-6 week lead — order by late April

BLUE TAPE WALKTHROUGH — WHAT BUILDERS HOPE YOU MISS:
- Test every GFCI outlet with reset button
- Check all 3-way switches in every position — often wired wrong
- Verify smoke detector interconnection — trigger one, all should activate
- Test water pressure running 3 faucets + toilet flush simultaneously
- Walk full property perimeter checking foundation drainage slopes away from house
- Check all exterior caulking around windows, doors, penetrations
- Test all doors — ones that don't close signal foundation movement
- Verify all specified upgrades are actually installed (not substituted)
- Video document everything before accepting — video beats photos in disputes
- Get all warranty items in writing with completion dates — verbal = unenforceable
`;

// Weather API - using Open-Meteo (completely free, no key needed)
function fetchHoustonWeather() {
  return new Promise((resolve) => {
    // Houston coordinates
    const path = '/v1/forecast?latitude=29.7604&longitude=-95.3698&daily=temperature_2m_max,precipitation_probability_max,windspeed_10m_max,weathercode&timezone=America%2FChicago&forecast_days=7&temperature_unit=fahrenheit&windspeed_unit=mph';

    const options = {
      hostname: 'api.open-meteo.com',
      path,
      method: 'GET',
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const daily = data.daily;
          const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
          
          let forecast = '--- LIVE HOUSTON WEATHER FORECAST (Next 7 Days) ---\n';
          for (let i = 0; i < daily.time.length; i++) {
            const date = new Date(daily.time[i] + 'T12:00:00');
            const dayName = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : days[date.getDay()];
            const rain = daily.precipitation_probability_max[i];
            const wind = daily.windspeed_10m_max[i];
            const high = Math.round(daily.temperature_2m_max[i]);
            const code = daily.weathercode[i];
            
            // Translate weather code to description
            let condition = 'Clear';
            if (code >= 95) condition = 'Thunderstorms';
            else if (code >= 80) condition = 'Rain showers';
            else if (code >= 61) condition = 'Rainy';
            else if (code >= 51) condition = 'Drizzle';
            else if (code >= 45) condition = 'Foggy';
            else if (code >= 3) condition = 'Overcast';
            else if (code >= 1) condition = 'Partly cloudy';

            // Risk assessment for construction
            let risk = 'LOW RISK ✅';
            if (rain >= 70 || code >= 80) risk = 'HIGH RISK ❌ — avoid outdoor work';
            else if (rain >= 40 || wind >= 25) risk = 'MODERATE RISK ⚠️ — plan accordingly';
            else if (wind >= 35) risk = 'HIGH WIND RISK ❌ — no roof/truss work';

            forecast += `${dayName} (${daily.time[i]}): ${high}°F, ${condition}, ${rain}% rain, ${wind}mph wind — BUILD RISK: ${risk}\n`;
          }
          forecast += '\nWeather Risk Guide: Rain>70% or thunderstorms = no framing/roofing/concrete. Wind>35mph = no truss/roof work. Rain>40% = delay inspections, protect materials.\n';
          resolve(forecast);
        } catch (e) {
          resolve('Weather data temporarily unavailable.\n');
        }
      });
    });
    req.on('error', () => resolve('Weather data temporarily unavailable.\n'));
    req.end();
  });
}

// Fetch data from a specific sheet tab
function fetchSheetData(tabName) {
  return new Promise((resolve) => {
    const encodedTab = encodeURIComponent(tabName);
    const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
    const path = `/v4/spreadsheets/${SHEET_ID}/values/${encodedTab}?key=${apiKey}`;

    const options = {
      hostname: 'sheets.googleapis.com',
      path,
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.values || []);
        } catch (e) {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

// Format sheet rows into readable text for Claude
function formatSheetData(rows, tabName) {
  if (!rows || rows.length === 0) return `${tabName}: No data yet.\n`;
  const lines = rows.map(row => row.join(' | ')).join('\n');
  return `--- ${tabName} ---\n${lines}\n\n`;
}

// Build full project context from live sheet + weather
async function getProjectContext() {
  try {
    const [dashboard, phases, contractors, inspections, budget, longLead, weather] = await Promise.all([
      fetchSheetData('📊 Dashboard'),
      fetchSheetData('📅 Phase Schedule'),
      fetchSheetData('👷 Contractors'),
      fetchSheetData('🔍 Inspections'),
      fetchSheetData('💰 Budget'),
      fetchSheetData('📦 Long Lead Orders'),
      fetchHoustonWeather(),
    ]);

    let context = '=== LIVE PROJECT DATA ===\n\n';
    context += formatSheetData(dashboard.slice(0, 20), 'Dashboard');
    context += formatSheetData(phases, 'Phase Schedule');
    context += formatSheetData(contractors, 'Contractors');
    context += formatSheetData(inspections, 'Inspections');
    context += formatSheetData(budget, 'Budget');
    context += formatSheetData(longLead, 'Long Lead Orders');
    context += '\n=== LIVE WEATHER ===\n' + weather;
    context += '\n=== END LIVE DATA ===\n\n';
    context += 'Use this live data to answer questions. Cross-reference weather risks with the current build phase. If a field says [ENTER] it means the family has not filled it in yet — flag this as a gap if relevant to the question.';

    return context;
  } catch (e) {
    return 'Note: Could not read live data. Using built-in project knowledge only.\n';
  }
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messages, system } = req.body;

    // Today's date in Houston time
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'America/Chicago'
    });

    // Get live project + weather data
    const projectContext = await getProjectContext();

    // Build enhanced system prompt
    const enhancedSystem = system + `

` + REFERENCE_KNOWLEDGE + `

IMPORTANT — TODAY'S DATE: ${today} (Houston, TX). Always use this as the current date in all responses, timeline calculations, and urgency assessments.

You are not limited to project management topics. Dad, Mom, and the family can ask you ANYTHING related to:
- Construction methods, materials, and best practices
- Building codes and Houston COH requirements
- Contractor negotiations and management
- Weather impacts on the build
- General home building questions
- Cost estimates and budget guidance
- Tool and equipment questions
- Any other construction or home building topic

You have full knowledge of construction, architecture, engineering principles, Houston building codes, Texas contractor licensing, and home building best practices. Always answer general building questions thoroughly — you are the family's expert advisor on everything construction related, not just this specific project.

When weather data shows rain or wind risks, proactively flag which scheduled activities are at risk and suggest alternatives.

` + projectContext;

    const payload = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: enhancedSystem,
      messages,
    });

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

    const data = await new Promise((resolve, reject) => {
      const request = https.request(options, (response) => {
        let body = '';
        response.on('data', (chunk) => body += chunk);
        response.on('end', () => {
          try {
            resolve({ status: response.statusCode, body: JSON.parse(body) });
          } catch (e) {
            reject(new Error('Failed to parse response'));
          }
        });
      });
      request.on('error', reject);
      request.write(payload);
      request.end();
    });

    return res.status(data.status).json(data.body);

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
