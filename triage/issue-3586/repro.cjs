const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const base = process.env.FA || 'http://localhost:9013';
  assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
  assert(process.env.API_KEY && process.env.TEST_PASSWORD);
  const appId = '35860000-0000-4000-8000-000000000001';
  const userId = '35860000-0000-4000-8000-000000000002';
  const offset = Number(process.env.SCREENSHOT_OFFSET || 0);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const updated = await context.request.patch(`${base}/api/user/${userId}`, {
      headers: { Authorization: process.env.API_KEY },
      data: { user: { password: process.env.TEST_PASSWORD } }
    });
    assert.equal(updated.status(), 200, 'Reset disposable test-user password');
    const page = await context.newPage();
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === new URL(base).origin) return route.continue();
      return route.abort();
    });
    page.on('console', message => console.log(JSON.stringify({
      consoleType: message.type(), text: message.text()
    })));
    page.on('response', response => {
      if (response.request().isNavigationRequest()) {
        console.log(JSON.stringify({ method: response.request().method(),
          path: new URL(response.url()).pathname, status: response.status() }));
      }
    });
    const params = new URLSearchParams({
      client_id: appId, response_type: 'code', redirect_uri: `${base}/callback`, scope: 'openid'
    });
    const authorize = `${base}/oauth2/authorize?${params}`;
    const screenshot = async (number, label) => {
      const filename = `${String(offset + number).padStart(2, '0')}-${label}.png`;
      await page.screenshot({ path: path.join(__dirname, filename), fullPage: true });
      console.log(JSON.stringify({ screenshot: filename }));
    };
    await page.goto(authorize);
    await page.locator('input[name="loginId"]').fill('user@example.com ');
    await page.locator('input[name="password"]').fill(process.env.TEST_PASSWORD);
    console.log(JSON.stringify({ loginId: await page.locator('input[name="loginId"]').inputValue() }));
    await screenshot(1, 'login-before');
    await Promise.all([
      page.waitForNavigation(),
      page.getByRole('button', { name: 'Submit', exact: true }).click()
    ]);
    assert((await page.locator('body').innerText()).includes('An unexpected exception occurred.'));
    console.log(JSON.stringify({ flow: 'login', error: 'An unexpected exception occurred.' }));
    await screenshot(2, 'login-after');
    await page.goto(authorize);
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await page.locator('input[name="loginId"]').fill('user@example.com ');
    console.log(JSON.stringify({ loginId: await page.locator('input[name="loginId"]').inputValue() }));
    await screenshot(3, 'forgot-before');
    await Promise.all([
      page.waitForNavigation(),
      page.getByRole('button', { name: 'Submit', exact: true }).click()
    ]);
    assert((await page.locator('body').innerText()).includes('An unexpected exception occurred.'));
    console.log(JSON.stringify({ flow: 'forgot-password', error: 'An unexpected exception occurred.' }));
    await screenshot(4, 'forgot-after');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
