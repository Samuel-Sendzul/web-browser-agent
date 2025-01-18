import { chromium, Page } from "playwright";
import fs from "fs";
import path from "path";

async function markPageUsingScript(page: Page) {
  const scriptPath = path.resolve(__dirname, "mark-page.js");
  const scriptContent = fs.readFileSync(scriptPath, "utf8");

  // Evaluate the script content directly
  await page.evaluate(scriptContent);

  let bboxes;
  for (let i = 0; i < 10; i++) {
    try {
      // Call the markPage function defined in the script
      bboxes = await page.evaluate("markPage()");
      break;
    } catch (error) {
      // May be loading...
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  const screenshot = await page.screenshot();
  // Ensure the bboxes don't follow us around
  //await page.evaluate("unmarkPage()");
  return {
    img: screenshot.toString("base64"),
    bboxes: bboxes,
  };
}

(async () => {
  const browser = await chromium.launch({
    args: [
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-setuid-sandbox",
      "--no-first-run",
      "--no-sandbox",
      "--no-zygote",
      "--ignore-certificate-errors",
      "--disable-extensions",
      "--disable-infobars",
      "--disable-notifications",
      "--disable-popup-blocking",
      "--disable-blink-features=AutomationControlled",
    ],
    headless: false,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://www.google.com");
  await markPageUsingScript(page);
  await page.waitForTimeout(2000);

  await browser.close();
})();
