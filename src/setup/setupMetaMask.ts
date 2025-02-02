import { DappeteerBrowser } from "../browser";
import { getMetaMask } from "../metamask";
import { DappeteerPage } from "../page";
import { Dappeteer, MetaMaskOptions } from "../types";

import { retry, waitForOverlay } from "../helpers";
import {
  acceptTheRisks,
  closeNewModal,
  closePortfolioTooltip,
  closeWhatsNewModal,
  enableEthSign,
  importAccount,
  showTestNets
} from "./setupActions";

/**
 * Setup MetaMask with base account
 * */
type Step<Options> = (
  page: DappeteerPage,
  options?: Options
) => void | Promise<void>;

const defaultMetaMaskSteps: Step<MetaMaskOptions>[] = [
  importAccount,
  closeNewModal,
  showTestNets,
  enableEthSign,
  closeWhatsNewModal,
  closeWhatsNewModal
];

const flaskMetaMaskSteps: Step<MetaMaskOptions>[] = [
  acceptTheRisks,
  importAccount,
  showTestNets,
  enableEthSign,
  closePortfolioTooltip,
  closeWhatsNewModal,
  closeWhatsNewModal
];

const MM_HOME_REGEX = "chrome-extension://[a-z]+/home.html";

function getDefaultSteps(browser: DappeteerBrowser): Step<MetaMaskOptions>[] {
  if (browser.isMetaMaskFlask()) {
    return flaskMetaMaskSteps;
  }

  return defaultMetaMaskSteps;
}

export async function setupMetaMask<Options = MetaMaskOptions>(
  browser: DappeteerBrowser,
  options?: Options,
  steps?: Step<Options>[]
): Promise<Dappeteer> {
  const page = await getMetaMaskPage(browser);
  steps = steps ?? getDefaultSteps(browser);

  await page.setViewport({ width: 1920, height: 1080 });
  // goes through the installation steps required by MetaMask
  for (const step of steps) {
    await step(page, options);
  }

  return getMetaMask(page);
}

export function isUnlocked(page: DappeteerPage): boolean {
  return page.url().match(/home\.html#*$/) !== null;
}

export function isRestoreVault(page: DappeteerPage): boolean {
  return page.url().match(/#restore-vault#*$/) !== null;
}

export function isLockScreen(page: DappeteerPage): boolean {
  // `home.html#unlock`
  return page.url().match(/#unlock#*$/) !== null;
}

export function isSetupScreen(page: DappeteerPage): boolean {
  return page.url().match(/welcome#*$/) !== null;
}

export async function setupBootstrappedMetaMask(
  browser: DappeteerBrowser,
  password: string,
  skipLogin: boolean = false
): Promise<Dappeteer> {
  const page = await getMetaMaskPage(browser);
  const metaMask = await getMetaMask(page);

  await metaMask.page.evaluate(() => {
    (window as unknown as { signedIn: boolean }).signedIn = false;
  });

  if (!skipLogin) {
    await page.waitForTimeout(100);
    await waitForOverlay(page);
    if (browser.isMetaMaskFlask()) await waitForOverlay(page);
    await retry(() => metaMask.unlock(password), 3);
  }

  // Close eventual "what's new popups"
  const closeWhatsNew =
    '//section[contains(@class, "whats-new-popup")]//button[@data-testid="popover-close"]';
  for (let i = 0; i < 10; ++i) {
    try {
      // Close the what's new popup
      // https://community.metamask.io/t/can-i-disable-lavamoat/24845/4
      const closeBtn = await page.waitForXPath(closeWhatsNew, {
        timeout: 1000
      });
      await closeBtn.click();
    } catch (e) {
      // Not found -> break
      break;
    }
  }

  try {
    const gotItBtn = await page.waitForXPath("//button[text()=\"Got it\"]", { timeout: 500 });
    await gotItBtn.click();
  } catch (_) {}

  await waitForOverlay(page);
  return metaMask;
}

export async function getMetaMaskPage(
  browser: DappeteerBrowser
): Promise<DappeteerPage> {
  const pages = await browser.pages();
  for (const page of pages) {
    if (page.url().match(MM_HOME_REGEX)) {
      return page;
    }
  }
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    browser.on("targetcreated", async (target: any) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      if (target.url().match(MM_HOME_REGEX)) {
        try {
          const pages = await browser.pages();
          for (const page of pages) {
            if (page.url().match(MM_HOME_REGEX)) {
              resolve(page);
            }
          }
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}
