const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const apiKey = process.env.API_KEY;
if (!apiKey) throw new Error('Set API_KEY to the local superuser API key.');
const output = __dirname;
const targets = ['http://localhost:9012', 'http://localhost:9011'];

async function api(base, route) {
  const response = await fetch(base + route, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  return response.json();
}

async function logs(base) {
  return (await api(base,
    '/api/system/event-log/search?numberOfResults=1000&startRow=0&orderBy=insertInstant%20DESC'
  )).eventLogs || [];
}

function summarizeEvents(events) {
  return events.map(({ id, type, message }) => ({
    id,
    type,
    message: message.slice(0, 1800),
    relevantLines: message.split('\n').filter(line =>
      /RegistrationState|getStepIndex|BaseRegisterAction|clientId|alternativeLogins/.test(line)
    ).slice(0, 12)
  }));
}

async function measure(base, operation) {
  const before = new Set((await logs(base)).map(event => event.id));
  const result = await operation();
  const added = (await logs(base)).filter(event => !before.has(event.id));
  return {
    ...result,
    newEventCount: added.length,
    freeMarkerErrorCount: added.filter(event =>
      event.type === 'Error' && event.message.includes('A FreeMarker exception occurred')
    ).length,
    events: summarizeEvents(added)
  };
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const results = [];
  let screenshotIndex = 0;
  try {
    for (const base of targets) {
      const { version } = await api(base, '/api/system/version');
      const result = { base, version, http: [], browser: [] };
      for (const endpoint of ['register', 'authorize']) {
        for (const query of ['', '?resource%5B-1%5D=x']) {
          const route = `/oauth2/${endpoint}${query}`;
          result.http.push(await measure(base, async () => {
            const response = await fetch(base + route, {
              redirect: 'manual',
              signal: AbortSignal.timeout(30000)
            });
            const body = await response.text();
            return {
              route,
              status: response.status,
              location: response.headers.get('location'),
              title: body.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim(),
              bodyBytes: Buffer.byteLength(body),
              hasForm: /<form\b/i.test(body),
              hasNegativeIndexMessage: /negative|index.*-1/i.test(body)
            };
          }));
        }
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        const consoleErrors = [];
        page.on('pageerror', error => consoleErrors.push(error.message));
        page.on('console', message => {
          if (message.type() === 'error') consoleErrors.push(message.text());
        });
        const route = `/oauth2/${endpoint}?resource%5B-1%5D=x`;
        const screenshot = `${String(++screenshotIndex).padStart(2, '0')}-${version}-${endpoint}.png`;
        result.browser.push(await measure(base, async () => {
          const response = await page.goto(base + route, { waitUntil: 'networkidle' });
          await page.screenshot({ path: path.join(output, screenshot), fullPage: true });
          return {
            route, status: response.status(), url: page.url(),
            title: await page.title(), text: await page.locator('body').innerText(),
            formCount: await page.locator('form').count(), consoleErrors, screenshot
          };
        }));
        await page.close();
      }
      results.push(result);
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
      console.log(JSON.stringify({
        version,
        http: result.http.map(({ events, ...rest }) => rest),
        browser: result.browser.map(({ events, ...rest }) => rest)
      }, null, 2));
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
