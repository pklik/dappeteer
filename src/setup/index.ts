import { DappeteerBrowser } from "../browser";
import { DappeteerPage } from "../page";
import { InstallSnapOptions } from "../snap/install";
import { Dappeteer, DappeteerLaunchOptions, MetaMaskOptions } from "../types";
import { launch } from "./launch";
import {
  getMetaMaskPage,
  setupBootstrappedMetaMask,
  setupMetaMask,
  isUnlocked,
  isLockScreen,
  isSetupScreen,
  isRestoreVault,
} from "./setupMetaMask";
import { connectPuppeteer } from "./puppeteer";

export * from "./launch";
export * from "./setupMetaMask";

/**
 * Launches browser and installs required metamask version along with setting up initial account
 */
export const bootstrap = async ({
  seed,
  password,
  showTestNets,
  ...launchOptions
}: DappeteerLaunchOptions & MetaMaskOptions): Promise<{
  metaMask: Dappeteer;
  browser: DappeteerBrowser;
  metaMaskPage: DappeteerPage;
}> => {
  const browser = await launch(launchOptions);
  const metaMask = await (launchOptions.userDataDir
    ? setupBootstrappedMetaMask(browser, password)
    : setupMetaMask(browser, {
        seed,
        password,
        showTestNets,
      }));

  return {
    metaMask,
    browser,
    metaMaskPage: metaMask.page,
  };
};

const getExtensionId = async (
  extensionName: string | RegExp = "MetaMask",
  browser: DappeteerBrowser
): Promise<string | null> => {
  // Try to get it from Chrome extension tab. A bit tricky, because this is
  // a protected page
  const page = await browser.newPage();
  await page.goto("chrome://extensions");

  // Enable Developer mode - Required to show the extension ID
  const devModeToggle = await page.$("pierce/#devMode");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const devModeEnabled = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-return
    (elem) => elem.checked,
    devModeToggle["element"]
  );
  if (!devModeEnabled) await devModeToggle.click();

  const extensionNames = await page.$$("pierce/#name-and-version div");
  const extensionIdStrings = await page.$$("pierce/#extension-id");

  if (extensionNames.length !== extensionIdStrings.length) {
    console.error(
      "Length mismatch on Extensions page. Is developer mode enabled?"
    );
    await page.close();
    return null;
  }

  for (let i = 0; i < extensionNames.length; ++i) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const text: string = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-return
      (elem) => elem.textContent,
      extensionNames[i]["element"]
    );
    if (!text.toString().match(extensionName)) continue;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
    const extensionString = await page.evaluate(
      (elem: Element) => elem.textContent,
      extensionIdStrings[i]["element"]
    );
    await page.close();
    return extensionString.split(" ")[1];
  }
  await page.close();
  return null;
};

export const getExtensionHomeUrl = async (
  extensionName: string,
  browser: DappeteerBrowser
): Promise<string> => {
  const extensionId = await getExtensionId(extensionName, browser);
  if (extensionId === null) return null;
  if (extensionName.match(/^metamask/i)) {
    return `chrome-extension://${extensionId}/home.html`;
  } else if (extensionName.match(/^braavos/i)) {
    return `chrome-extension://${extensionId}/index.html`;
  }
  return null;
};

export const connect = async ({
  seed,
  password,
  showTestNets,
  browserWSEndpoint,
  metaMaskUrl,
}: DappeteerLaunchOptions &
  MetaMaskOptions & {
    browserWSEndpoint: string;
    metaMaskUrl: string;
  }): Promise<{
  metaMask: Dappeteer;
  browser: DappeteerBrowser;
  metaMaskPage: DappeteerPage;
}> => {
  const browser = await connectPuppeteer(browserWSEndpoint);

  if (!metaMaskUrl) {
    metaMaskUrl = await getExtensionHomeUrl("MetaMask", browser);
  }

  // Make sure that there is exactly one metamask tab open
  const pages = (await browser.pages()).map((page) => {
    return {
      page,
      isMetamask: page.url().startsWith(metaMaskUrl),
    };
  });

  let numMetamaskPagesFound = 0;
  for (let i = 0; i < pages.length; ++i) {
    if (pages[i].isMetamask) numMetamaskPagesFound++;
    if (numMetamaskPagesFound > 1) await pages[i].page.close();
  }

  if (numMetamaskPagesFound === 0) {
    const metamaskPage = await browser.newPage();
    await metamaskPage.goto(metaMaskUrl);
  }

  const metaMaskPage = await getMetaMaskPage(browser);

  // Metamask is dumb
  await metaMaskPage.reload();

  let _isUnlocked, _isSetupScreen;
  const _isRestoreVault = isRestoreVault(metaMaskPage);
  if (_isRestoreVault) {
    await metaMaskPage.goto(
      metaMaskPage.url().replace("restore-vault", "unlock")
    );
  }

  const _isLockScreen = isLockScreen(metaMaskPage);
  if (!_isLockScreen) {
    _isUnlocked = isUnlocked(metaMaskPage);
  }
  if (!_isLockScreen && !_isUnlocked) {
    _isSetupScreen = isSetupScreen(metaMaskPage);
  }

  let metaMask: Dappeteer;
  if (_isSetupScreen) {
    metaMask = await setupMetaMask(browser, {
      seed,
      password,
      showTestNets,
    });
  } else if (_isLockScreen) {
    metaMask = await setupBootstrappedMetaMask(browser, password);
  } else if (_isUnlocked) {
    metaMask = await setupBootstrappedMetaMask(browser, password, true);
  } else {
    throw new Error("MetaMask not found in opened tabs");
  }

  return {
    metaMask,
    browser,
    metaMaskPage: metaMask.page,
  };
};

/**
 * Used to quickly bootstrap dappeteer testing environment with installed snap
 */
export const initSnapEnv = async (
  opts: DappeteerLaunchOptions &
    MetaMaskOptions &
    InstallSnapOptions & { snapIdOrLocation: string }
): Promise<{
  metaMask: Dappeteer;
  browser: DappeteerBrowser;
  metaMaskPage: DappeteerPage;
  snapId: string;
}> => {
  const browser = await launch({
    ...opts,
    metaMaskFlask: true,
  });
  const { snapIdOrLocation, seed, password, showTestNets } = opts;
  const metaMask = await setupMetaMask(browser, {
    seed,
    password,
    showTestNets,
  });
  const metaMaskPage = metaMask.page;
  const snapId = await metaMask.snaps.installSnap(snapIdOrLocation, opts);

  return {
    metaMask,
    browser,
    metaMaskPage,
    snapId,
  };
};
