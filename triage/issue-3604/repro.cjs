const { chromium } = require('playwright');
const path = require('path');
const { randomUUID } = require('crypto');

const port = process.argv[2];
const apiKey = process.env.API_KEY;
const password = process.env.TEST_PASSWORD;
if (!['9011', '9012'].includes(port) || !apiKey || !password) {
  throw new Error('Usage: API_KEY=... TEST_PASSWORD=... node repro.cjs 9012|9011');
}
const base = `http://localhost:${port}`;

async function api(method, endpoint, body) {
  const response = await fetch(base + endpoint, {
    method,
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${method} ${endpoint}: ${response.status} ${text}`);
  return json;
}

(async () => {
  const version = (await api('GET', '/api/system/version')).version;
  const field = (await api('GET', '/api/form/field')).fields.find(
    f => f.name === '[Self Service User] password'
  );
  const form = (await api('POST', '/api/form', {
    form: { name: `Triage 3604 ${randomUUID()}`, type: 'selfServiceUser',
      steps: [{ type: 'collectData', fields: [field.id] }] }
  })).form;
  const config = {
    name: `Triage 3604 ${randomUUID()}`,
    formConfiguration: {
      selfServiceFormId: form.id,
      selfServiceFormConfiguration: { requireCurrentPasswordOnPasswordChange: true }
    },
    oauthConfiguration: {
      authorizedRedirectURLs: [`${base}/account/login`],
      enabledGrants: ['authorization_code', 'refresh_token'],
      generateRefreshTokens: true,
      debug: true
    },
    roles: [{ name: 'user' }]
  };
  try {
    await api('POST', '/api/application', { application: config });
    throw new Error('Custom form unexpectedly accepted; rerun with a licensed reproduction plan');
  } catch (error) {
    if (!error.message.includes('[notLicensed]application.formConfiguration.selfServiceFormId')) throw error;
    console.log('Custom form assignment: 400 [notLicensed]application.formConfiguration.selfServiceFormId');
  }
  delete config.formConfiguration.selfServiceFormId;
  const app = (await api('POST', '/api/application', { application: config })).application;
  const email = `triage-3604-${randomUUID()}@example.com`;
  await api('POST', '/api/user/registration', {
    user: { email, password, verified: true },
    registration: { applicationId: app.id, roles: ['user'] }
  });
  console.log(`Version ${version}; application ${app.id}; local test user ${email}`);

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.pathname === '/account/login' || url.pathname === '/oauth2/consent') {
        console.log(`${response.request().method()} ${url.pathname}: ${response.status()}`);
      }
    });
    page.on('console', message => console.log(`Console ${message.type()}: ${message.text()}`));
    await page.goto(`${base}/account/?client_id=${app.id}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(__dirname, `01-before-${version}.png`) });
    console.log('Initial path:', new URL(page.url()).pathname);
    await page.locator('input[name="loginId"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.waitForLoadState('networkidle');
    console.log('Final path:', new URL(page.url()).pathname);
    console.log('Page text:', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 500));
    await page.screenshot({ path: path.join(__dirname, `02-after-${version}.png`) });
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
