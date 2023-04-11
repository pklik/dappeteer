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

  if (metaMaskUrl) {
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
  }

  const metaMaskPage = await getMetaMaskPage(browser);

  // Metamask is dumb
  await metaMaskPage.reload();

  let _isUnlocked, _isSetupScreen;
  const _isLockScreen = await isLockScreen(metaMaskPage);
  if (!_isLockScreen) {
    _isUnlocked = await isUnlocked(metaMaskPage);
  }
  if (!_isLockScreen && !_isUnlocked) {
    _isSetupScreen = await isSetupScreen(metaMaskPage);
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
