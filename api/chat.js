const https = require('https');

// Your Google Sheet ID
const SHEET_ID = '196K2RgOA-LnEziBkcR6hPKzZwJsmIKTDPLpV9hZWFuI';

// Fetch data from a specific sheet tab
function fetchSheetData(tabName) {
  return new Promise((resolve, reject) => {
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

// Build project context from live sheet data
async function getProjectContext() {
  try {
    const [dashboard, phases, contractors, inspections, budget, longLead] = await Promise.all([
      fetchSheetData('📊 Dashboard'),
      fetchSheetData('📅 Phase Schedule'),
      fetchSheetData('👷 Contractors'),
      fetchSheetData('🔍 Inspections'),
      fetchSheetData('💰 Budget'),
      fetchSheetData('📦 Long Lead Orders'),
    ]);

    let context = '=== LIVE PROJECT DATA FROM GOOGLE SHEET ===\n\n';
    context += formatSheetData(dashboard.slice(0, 20), 'Dashboard');
    context += formatSheetData(phases, 'Phase Schedule');
    context += formatSheetData(contractors, 'Contractors');
    context += formatSheetData(inspections, 'Inspections');
    context += formatSheetData(budget, 'Budget');
    context += formatSheetData(longLead, 'Long Lead Orders');
    context += '=== END OF LIVE PROJECT DATA ===\n\n';
    context += 'Use this live data to answer questions. If a field says [ENTER] it means the family has not filled it in yet.';

    return context;
  } catch (e) {
    return 'Note: Could not read live sheet data. Using built-in project knowledge only.\n';
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

    // Read live sheet data and prepend to system prompt
    const projectContext = await getProjectContext();
    // Add today's date so BUILDER always knows the current date
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Chicago' });
    const dateContext = `IMPORTANT: Today's date is ${today} (Houston, TX local time). Always use this as the current date in all your responses and calculations.\n\n`;
    const enhancedSystem = system + '\n\n' + dateContext + projectContext;

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
