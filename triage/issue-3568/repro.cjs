const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const apiKey = process.env.API_KEY;
const password = process.env.ADMIN_PASSWORD || 'password';
const outputDirectory = __dirname;
const versions = [
  { name: '1.69.1', baseUrl: 'http://localhost:9012', screenshot: '01-reported-1.69.1.png' },
  { name: '1.70.0', baseUrl: 'http://localhost:9011', screenshot: '02-latest-1.70.0.png' }
];

if (!apiKey) {
  throw new Error('Set API_KEY to the local triage instance API key before running this script.');
}

fs.mkdirSync(outputDirectory, { recursive: true });

async function openTemplateSettings(page, baseUrl) {
  await page.goto(`${baseUrl}/admin`);
  const login = page.getByRole('textbox', { name: 'Login' });
  if (await login.count()) {
    await login.fill('admin@example.com');
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.waitForURL('**/admin/**');
  }
  await page.goto(`${baseUrl}/admin/tenant/`);
  await page.getByRole('link', { name: 'Add' }).click();
  await page.getByRole('tab', { name: 'Identities' }).click();
  return page.getByRole('group', { name: 'Template settings' });
}

async function capture(page, section, screenshot) {
  await section.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(500);
  const measurements = await section.evaluate((element) => {
    const text = element.innerText;
    const rect = element.getBoundingClientRect();
    return {
      section: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      noEmailTemplates: (text.match(/No email templates defined/g) || []).length,
      noMessageTemplates: (text.match(/No message templates defined/g) || []).length
    };
  });
  await page.screenshot({ path: screenshot, fullPage: false });
  return measurements;
}

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const pages = {};
  try {
    for (const version of versions) {
      const page = await browser.newPage({ viewport: { width: 2000, height: 1100 } });
      pages[version.name] = page;
      const section = await openTemplateSettings(page, version.baseUrl);
      const actualVersion = await page.locator('body').innerText();
      const measurements = await capture(
        page,
        section,
        path.join(outputDirectory, version.screenshot)
      );
      console.log(JSON.stringify({
        requestedVersion: version.name,
        actualVersion: actualVersion.match(/FusionAuth version [0-9.]+/)?.[0],
        ...measurements
      }));
    }

    const response = await fetch('http://localhost:9011/api/email/template', {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emailTemplate: {
          name: 'Triage issue 3568 test',
          defaultSubject: 'Triage',
          fromEmail: 'triage@example.com',
          defaultHtmlTemplate: '<p>Triage</p>',
          defaultTextTemplate: 'Triage'
        }
      })
    });
    if (!response.ok) {
      throw new Error(`Creating the test email template failed with HTTP ${response.status}`);
    }
    const { emailTemplate } = await response.json();

    try {
      const latest = pages['1.70.0'];
      const section = await openTemplateSettings(latest, 'http://localhost:9011');
      const afterTemplate = await capture(
        latest,
        section,
        path.join(outputDirectory, '03-latest-one-email.png')
      );
      console.log(JSON.stringify({
        setup: 'one email template created',
        availableTemplate: 'Triage issue 3568 test',
        ...afterTemplate
      }));
    } finally {
      const cleanup = await fetch(
        `http://localhost:9011/api/email/template/${emailTemplate.id}`,
        { method: 'DELETE', headers: { Authorization: apiKey } }
      );
      if (!cleanup.ok) {
        throw new Error(`Removing the test email template failed with HTTP ${cleanup.status}`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
