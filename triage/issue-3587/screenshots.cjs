const { chromium } = require('playwright');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    let index = 0;
    for (const [port, version] of [[9012, '1.69.4'], [9011, '1.70.0']]) {
      for (const prefill of [false, true]) {
        // A fresh context prevents a normal page load from supplying state to the next request.
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        try {
          const page = await context.newPage();
          page.on('console', message => console.log(`console: ${message.type()}: ${message.text()}`));
          const query = new URLSearchParams({
            client_id: '35873587-3587-4587-8587-358735873587',
            redirect_uri: 'http://localhost:8080/callback',
            response_type: 'code',
            scope: 'openid',
            code_challenge: 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopq',
            code_challenge_method: 'S256',
            state: 'x'
          });
          if (prefill) query.set('user.email', 'prefill@example.com');
          const response = await page.goto(`http://localhost:${port}/oauth2/register?${query}`);
          const file = `${String(++index).padStart(2, '0')}-${version}-${prefill ? 'after' : 'before'}.png`;
          await page.screenshot({ path: path.join(__dirname, file), fullPage: true });
          console.log(JSON.stringify({
            version, status: response.status(), url: page.url(), file,
            text: (await page.locator('body').innerText()).trim()
          }));
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
