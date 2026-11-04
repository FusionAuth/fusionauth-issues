// Destructive: run only against disposable local FusionAuth instances.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const base = process.env.BASE_URL;
  assert(['http://localhost:9012', 'http://localhost:9011'].includes(base),
    'BASE_URL must identify a disposable local triage instance');
  assert.equal(process.env.RESET_SYSTEM, '1', 'Set RESET_SYSTEM=1 to allow destructive reset');
  const apiKey = process.env.API_KEY;
  const password = process.env.ADMIN_PASSWORD;
  assert(apiKey && password, 'API_KEY and ADMIN_PASSWORD are required');
  const reported = base.endsWith(':9012');
  const prefix = reported ? 'reported' : 'latest';
  const output = __dirname;
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-3554-'));
  let browser;
  try {
    async function get(endpoint) {
      const response = await fetch(`${base}${endpoint}`, {
        headers: { Authorization: apiKey },
        signal: AbortSignal.timeout(10000)
      });
      assert.equal(response.status, 200, `GET ${endpoint}: ${response.status}`);
      return response.json();
    }

    async function snapshot() {
      const status = await get('/api/status');
      const { tenants } = await get('/api/tenant');
      const { applications } = await get('/api/application');
      const tenant = tenants.find(t => t.name === 'Default');
      const manager = applications.find(a => a.name.toLowerCase() === 'tenant manager');
      assert(tenant && manager, 'Default tenant and Tenant Manager must exist');
      return {
        version: status.version,
        defaultTenantId: tenant.id,
        defaultAccessTokenKeyId: tenant.jwtConfiguration.accessTokenKeyId,
        tenantManagerApplicationId: manager.id,
        tenantManagerAccessTokenKeyId: manager.jwtConfiguration.accessTokenKeyId,
        tenantManagerIdTokenKeyId: manager.jwtConfiguration.idTokenKeyId,
        tenantManagerJwtEnabled: manager.jwtConfiguration.enabled,
        sharesDefaultAccessTokenKey:
          tenant.jwtConfiguration.accessTokenKeyId === manager.jwtConfiguration.accessTokenKeyId
      };
    }

    const before = await snapshot();
    console.log(JSON.stringify({ phase: 'before', ...before }));
    assert.equal(before.sharesDefaultAccessTokenKey, false,
      'Use a fresh instance: keys must be distinct before reset');
    const kickstartPath = path.join(temporary, 'kickstart.json');
    await fs.writeFile(kickstartPath, JSON.stringify({
      variables: {
        apiKey,
        adminEmail: 'admin@example.com',
        adminPassword: password
      },
      apiKeys: [{
        key: '#{apiKey}',
        description: 'Disposable issue 3554 triage'
      }],
      requests: [{
        method: 'POST',
        url: '/api/user/registration',
        body: {
          user: { email: '#{adminEmail}', password: '#{adminPassword}' },
          registration: {
            applicationId: '#{FUSIONAUTH_APPLICATION_ID}',
            roles: ['admin']
          }
        }
      }]
    }), { mode: 0o600 });

    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const resetResponses = [];
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/admin/system/reset')) {
        resetResponses.push({
          method: response.request().method(),
          path: url.pathname,
          status: response.status()
        });
      }
    });
    await page.goto(`${base}/admin`);
    await page.getByRole('textbox', { name: 'Login', exact: true }).fill('admin@example.com');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await page.waitForURL(`${base}/admin/`);
    await page.goto(`${base}/admin/system/reset/`);
    await page.locator('input[type=file]').setInputFiles(kickstartPath);
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await page.getByRole('combobox', { name: 'Select a kickstart*', exact: true })
      .selectOption({ label: 'kickstart.json' });
    await page.getByRole('textbox', { name: 'Confirm*', exact: true }).fill('RESET');
    await page.screenshot({
      path: path.join(output, reported ? '01-reported-before.png' : '03-latest-before.png'),
      fullPage: true
    });
    await Promise.all([
      page.waitForResponse(response =>
        new URL(response.url()).pathname.startsWith('/admin/system/reset') &&
        response.request().method() === 'POST', { timeout: 120000 }),
      page.getByRole('button', { name: 'Save', exact: true }).click()
    ]);
    let after;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        after = await snapshot();
        if (after.defaultAccessTokenKeyId !== before.defaultAccessTokenKeyId) break;
      } catch {
        // Reset temporarily removes the API key while kickstart is applied.
      }
      after = undefined;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    assert(after, 'Reset did not finish and restore API access within the wait period');
    assert.notEqual(after.defaultAccessTokenKeyId, before.defaultAccessTokenKeyId,
      'Reset must regenerate the Default signing key');
    const afterPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await afterPage.goto(`${base}/admin`);
    await afterPage.getByRole('heading', { name: 'Login', exact: true }).waitFor();
    await afterPage.screenshot({
      path: path.join(output, reported ? '02-reported-after.png' : '04-latest-after.png'),
      fullPage: true
    });
    const evidence = {
      base, before, after, resetResponses,
      finalPath: new URL(afterPage.url()).pathname
    };
    await fs.writeFile(path.join(output, `${prefix}-results.json`),
      `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify({ phase: 'after', ...after }));
    console.log(`OBSERVATION: ${after.sharesDefaultAccessTokenKey
      ? 'Tenant Manager now uses the Default tenant access-token key'
      : 'Tenant Manager still uses a separate access-token key'}`);
  } finally {
    if (browser) await browser.close();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
