/*
 * Connect Wallet page. Thin EIP-1193 wrapper + Alpine component, no build step.
 * The flow is one connect and one personal_sign, so a direct provider call keeps
 * things small — this is a plain-JS port of the old React wallet-client (no viem).
 * Posts to the existing /api/wallet* JSON endpoints (session cookie carries auth).
 */
(function () {
  "use strict";

  const ETH_MAINNET = { chainId: 1, hexChainId: "0x1", name: "Ethereum Mainnet" };
  const CONNECTION_CHAIN_IDS = [1, 56];

  let selectedProvider = null;
  const selectProvider = (p) => { selectedProvider = p; };
  const getProvider = () => selectedProvider || window.ethereum || null;

  /* viem replacements — a client-side pre-check; the server verifies the signature. */
  const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || "").trim());
  function stringToHex(str) {
    let hex = "0x";
    const bytes = new TextEncoder().encode(str);
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return hex;
  }

  /** Listen before requesting announcements, including wallets injected after load. */
  function discoverWallets(onChange) {
    const wallets = [];
    const add = (wallet) => {
      if (!wallet.provider || typeof wallet.provider.request !== "function") return;
      const existing = wallets.findIndex((item) => item.provider === wallet.provider);
      if (existing >= 0) wallets[existing] = wallet;
      else if (!wallets.some((item) => item.id === wallet.id)) wallets.push(wallet);
      onChange(wallets.slice());
    };
    const legacy = () => {
      if (window.ethereum && !wallets.some((item) => item.provider === window.ethereum)) {
        add({ id: "browser", name: window.ethereum.isMetaMask ? "MetaMask" : "Browser wallet", provider: window.ethereum });
      }
    };
    const announce = (event) => {
      const detail = event.detail;
      if (!detail || typeof detail.info?.uuid !== "string" || typeof detail.info?.name !== "string") return;
      add({ id: detail.info.uuid.slice(0, 100), name: detail.info.name.slice(0, 60), provider: detail.provider });
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.addEventListener("ethereum#initialized", legacy);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    legacy();
    const timer = window.setTimeout(legacy, 1500);
    onChange(wallets.slice());
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("eip6963:announceProvider", announce);
      window.removeEventListener("ethereum#initialized", legacy);
    };
  }

  /** Only the current site's fixed connection route is shared; no session or signing data. */
  function walletAppLinks(origin) {
    const site = new URL(origin);
    if (site.protocol !== "https:") return null;
    const destination = `${site.origin}/user/user/connect`;
    return {
      metamask: `https://metamask.app.link/dapp/${destination.slice(8)}`,
      trust: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(destination)}`,
    };
  }

  /** Normalises the EIP-1193 error shape into something worth showing a user. */
  function describeProviderError(err) {
    const e = err || {};
    if (e.code === 4001) return "Request rejected. You cancelled the signature.";
    if (e.code === -32002) return "Another wallet request is already open.";
    if (e.code === 4902) return "This wallet does not have Ethereum Mainnet enabled.";
    if (e.code === -32001) return "No Ethereum wallet found. Install MetaMask to continue.";
    return e.message || "Could not reach your wallet.";
  }

  async function getChainId() {
    const provider = getProvider();
    if (!provider) throw new Error("No wallet detected.");
    const raw = await provider.request({ method: "eth_chainId" });
    return Number.parseInt(raw, 16);
  }

  async function getAccounts() {
    const provider = getProvider();
    if (!provider) return [];
    try {
      const accounts = await provider.request({ method: "eth_accounts" });
      return Array.isArray(accounts) ? accounts : [];
    } catch {
      return [];
    }
  }

  /** Prompts for access. Must be called from a user gesture or the wallet refuses. */
  async function requestAccounts() {
    const provider = getProvider();
    if (!provider) throw new Error("No Ethereum wallet found. Install MetaMask to continue.");
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    if (!Array.isArray(accounts) || accounts.length === 0) throw new Error("No account was shared by the wallet.");
    return accounts;
  }

  async function switchToMainnet() {
    const provider = getProvider();
    if (!provider) throw new Error("No Ethereum wallet found.");
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ETH_MAINNET.hexChainId }] });
    } catch (err) {
      // 4902 = chain not added yet, so offer to add it.
      if (err && err.code === 4902) {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: ETH_MAINNET.hexChainId,
            chainName: ETH_MAINNET.name,
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://cloudflare-eth.com"],
            blockExplorerUrls: ["https://etherscan.io"],
          }],
        });
        return;
      }
      throw err;
    }
  }

  /** personal_sign. MetaMask puts the message first, the address second. */
  async function signMessage(message, address) {
    const provider = getProvider();
    if (!provider) throw new Error("No Ethereum wallet found.");
    return provider.request({ method: "personal_sign", params: [stringToHex(message), address] });
  }

  const shortAddress = (a) => (!a || a.length < 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`);
  const explorerAddress = (a, chainId) => `https://${chainId === 56 ? "bscscan.com" : "etherscan.io"}/address/${a}`;

  async function postJson(path, body) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !json.ok) throw new Error((json && json.error && json.error.message) || "Request failed. Please try again.");
    return json.data;
  }

  document.addEventListener("alpine:init", () => {
    Alpine.data("connectWallet", () => ({
      ETH_MAINNET,
      wallets: [],
      status: { kind: "idle" },
      installed: null,
      browserWallets: [],
      selectedWallet: "",
      appLinks: null,
      listLoading: true,
      listError: false,
      chainId: null,
      liveAccount: null,
      manualOpen: false,
      connectionFailed: false,
      reviewOpen: false,
      reviewBusy: false,
      reviewError: "",
      reviewDone: false,
      reviews: [],
      reviewsError: false,
      reviewProvider: "MetaMask",
      reviewAsset: "ETH",
      reviewAddress: "",
      manualAddress: "",
      manualSignature: "",
      manualChallenge: null,
      reportOpen: false,
      reportSubject: "WALLET_NOT_DETECTED",
      reportMessage: "",
      reportBusy: false,
      reportError: "",
      reportDone: false,
      _lock: false,
      _stopDiscovery: null,
      _cleanupProvider: null,

      get working() { return this.status.kind === "working"; },
      get onWrongNetwork() { return this.chainId !== null && !CONNECTION_CHAIN_IDS.includes(this.chainId); },

      init() {
        this.load();
        this.loadReviews();
        this.appLinks = walletAppLinks(window.location.origin);
        this._stopDiscovery = discoverWallets((available) => {
          this.browserWallets = available;
          this.installed = available.length > 0;
          if (!available.some((w) => w.id === this.selectedWallet)) {
            this.selectedWallet = available[0] ? available[0].id : "";
          }
          this.bindProvider();
        });
        this.$watch("selectedWallet", () => this.bindProvider());
      },

      destroy() {
        if (this._stopDiscovery) this._stopDiscovery();
        if (this._cleanupProvider) this._cleanupProvider();
      },

      bindProvider() {
        if (this._cleanupProvider) { this._cleanupProvider(); this._cleanupProvider = null; }
        const found = this.browserWallets.find((w) => w.id === this.selectedWallet);
        const provider = found ? found.provider : null;
        selectProvider(provider);
        this.liveAccount = null;
        this.chainId = null;
        if (!provider) return;
        const onAccounts = (accounts) => { this.liveAccount = (accounts && accounts[0]) || null; };
        const onChain = (raw) => { this.chainId = Number.parseInt(raw, 16); };
        provider.on && provider.on("accountsChanged", onAccounts);
        provider.on && provider.on("chainChanged", onChain);
        getChainId().then((c) => { this.chainId = c; }).catch(() => { this.chainId = null; });
        getAccounts().then((a) => { this.liveAccount = a[0] || null; });
        this._cleanupProvider = () => {
          provider.removeListener && provider.removeListener("accountsChanged", onAccounts);
          provider.removeListener && provider.removeListener("chainChanged", onChain);
        };
      },

      async load() {
        this.listError = false;
        try {
          const res = await fetch("/api/wallet", { cache: "no-store" });
          const json = await res.json().catch(() => null);
          if (!res.ok || !json || !json.ok) throw new Error("Request failed");
          this.wallets = json.data.wallets;
        } catch {
          this.listError = true;
        } finally {
          this.listLoading = false;
        }
      },

      async connect() {
        if (this._lock) return;
        this._lock = true;
        this.connectionFailed = false;
        this.reviewDone = false;
        this.manualOpen = false;
        this.reviewOpen = false;
        this.status = { kind: "working", step: "Opening your wallet…" };
        try {
          const [account] = await requestAccounts();
          this.liveAccount = account;

          let chain = await getChainId();
          if (!CONNECTION_CHAIN_IDS.includes(chain)) {
            this.status = { kind: "working", step: `Switching to ${ETH_MAINNET.name}…` };
            await switchToMainnet();
            chain = await getChainId();
          }
          this.chainId = chain;

          this.status = { kind: "working", step: "Preparing signature…" };
          const challenge = await postJson("/api/wallet/challenge", { address: account });

          this.status = { kind: "working", step: "Confirm the signature in your wallet…" };
          const signature = await signMessage(challenge.message, account);

          this.status = { kind: "working", step: "Verifying…" };
          const res = await postJson("/api/wallet/verify", { address: account, signature, nonce: challenge.nonce, chainId: chain });

          await this.load();
          this.status = { kind: "done", message: res.alreadyConnected ? "Wallet reconnected." : "Wallet connected and verified." };
        } catch (err) {
          this.status = { kind: "error", message: describeProviderError(err) };
          this.connectionFailed = true;
        } finally {
          this._lock = false;
        }
      },

      async loadReviews() {
        try {
          const response = await fetch("/api/wallet/issues", { cache: "no-store" });
          const json = await response.json();
          if (!response.ok || !json?.ok) throw new Error("Could not load review status.");
          this.reviews = json.data.items || [];
          this.reviewsError = false;
        } catch { this.reviewsError = true; }
      },

      async submitReview() {
        if (this.reviewBusy || !this.connectionFailed) return;
        this.reviewBusy = true; this.reviewError = "";
        try {
          await postJson("/api/wallet/issues", { subject: "MANUAL_REVIEW", walletProvider: this.reviewProvider,
            assetKey: this.reviewAsset, publicAddress: this.reviewAddress.trim(), pageUrl: location.pathname });
          this.reviewDone = true; this.reviewOpen = false; this.reviewAddress = "";
          this.connectionFailed = false; this.manualOpen = false; this.status = { kind: "idle" };
          await this.loadReviews();
        } catch (error) { this.reviewError = error.message || "Could not submit the review."; }
        finally { this.reviewBusy = false; }
      },

      reviewStatus(status) {
        return { UNDER_REVIEW: "Under review", APPROVED: "Review approved", REJECTED: "Review declined" }[status] || status;
      },

      async switchNetwork() {
        try {
          await switchToMainnet();
          this.chainId = await getChainId();
          this.status = { kind: "idle" };
        } catch (err) {
          this.status = { kind: "error", message: describeProviderError(err) };
        }
      },

      async prepareManualChallenge() {
        const address = this.manualAddress.trim();
        if (!isAddress(address)) {
          this.status = { kind: "error", message: "Enter a valid Ethereum public address." };
          return;
        }
        this.status = { kind: "working", step: "Preparing a one-time message…" };
        try {
          const challenge = await postJson("/api/wallet/challenge", { address });
          this.manualChallenge = { address, nonce: challenge.nonce, message: challenge.message };
          this.manualSignature = "";
          this.status = { kind: "idle" };
        } catch (err) {
          this.status = { kind: "error", message: err.message };
        }
      },

      async copyMessage() {
        if (!this.manualChallenge) return;
        try {
          await navigator.clipboard.writeText(this.manualChallenge.message);
          this.status = { kind: "done", message: "Signing message copied." };
        } catch {
          this.status = { kind: "error", message: "Select and copy the message above." };
        }
      },

      async verifyManualSignature() {
        if (!this.manualChallenge) return;
        const signature = this.manualSignature.trim();
        if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
          this.status = { kind: "error", message: "Paste the full 0x signature from your wallet." };
          return;
        }
        this.status = { kind: "working", step: "Verifying wallet ownership…" };
        try {
          const result = await postJson("/api/wallet/verify", {
            address: this.manualChallenge.address,
            signature,
            nonce: this.manualChallenge.nonce,
            chainId: ETH_MAINNET.chainId,
          });
          await this.load();
          this.connectionFailed = false; this.manualOpen = false; this.reviewOpen = false;
          this.manualChallenge = null;
          this.manualSignature = "";
          this.status = { kind: "done", message: result.alreadyConnected ? "Wallet reconnected." : "Wallet connected and verified." };
        } catch (err) {
          this.status = { kind: "error", message: err.message };
        }
      },

      async disconnect(address) {
        this.status = { kind: "working", step: "Disconnecting…" };
        try {
          await postJson("/api/wallet", { address });
          await this.load();
          this.status = { kind: "done", message: "Wallet disconnected." };
        } catch (err) {
          this.status = { kind: "error", message: err.message };
        }
      },

      /* view helpers */
      short: shortAddress,
      explorer: explorerAddress,
      chainLabel(chainId) {
        if (chainId === 56) return "BNB Smart Chain";
        if (chainId === ETH_MAINNET.chainId) return ETH_MAINNET.name;
        return `Chain ${chainId}`;
      },
      isActiveHere(address) {
        return this.liveAccount && this.liveAccount.toLowerCase() === address.toLowerCase();
      },

      openReport() {
        this.reportOpen = true;
        this.reportError = "";
        this.reportDone = false;
        if (!this.reportMessage) {
          this.reportSubject = this.installed === false ? "WALLET_NOT_DETECTED" : "CONNECT_FAILED";
        }
      },

      closeReport() {
        if (this.reportBusy) return;
        this.reportOpen = false;
      },

      async submitReport() {
        if (this.reportBusy) return;
        const message = this.reportMessage.trim();
        if (message.length < 10) {
          this.reportError = "Describe the problem in at least 10 characters.";
          return;
        }
        this.reportBusy = true;
        this.reportError = "";
        try {
          await postJson("/api/wallet/issues", {
            subject: this.reportSubject,
            message,
            pageUrl: location.pathname + location.search,
          });
          this.reportDone = true;
          this.reportMessage = "";
        } catch (err) {
          this.reportError = err.message || "Could not send the report.";
        } finally {
          this.reportBusy = false;
        }
      },
    }));
  });

  /** EVM deposit send (parity with lib/wallet-client sendCryptoDeposit). */
  window.qfsSendCryptoDeposit = async function (asset, destination, quantityAtomic, beforeSend) {
    const provider = getProvider();
    if (!provider || !asset.chainId || ![1, 56].includes(asset.chainId)) {
      throw new Error("Use the address or QR option for this wallet and network.");
    }
    if (!isAddress(destination) || !/^[1-9][0-9]*$/.test(quantityAtomic)) throw new Error("Invalid deposit instructions.");
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const from = accounts[0];
    let chainId = await getChainId();
    if (chainId !== asset.chainId) {
      try {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${asset.chainId.toString(16)}` }] });
      } catch (error) {
        if (error?.code !== 4902 || asset.chainId !== 56) throw error;
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: "0x38",
            chainName: "BNB Smart Chain",
            nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
            rpcUrls: ["https://bsc-dataseed.bnbchain.org"],
            blockExplorerUrls: ["https://bscscan.com"],
          }],
        });
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x38" }] });
      }
      chainId = await getChainId();
    }
    if (chainId !== asset.chainId) throw new Error("Switch your wallet to the selected network before paying.");
    const qty = BigInt(quantityAtomic);
    let tx;
    if (asset.token) {
      const pad = qty.toString(16).padStart(64, "0");
      const addr = destination.slice(2).toLowerCase().padStart(64, "0");
      const data = "0xa9059cbb" + addr + pad;
      tx = { from, to: asset.token, data };
    } else {
      tx = { from, to: destination, value: `0x${qty.toString(16)}` };
    }
    beforeSend?.();
    const hash = await provider.request({ method: "eth_sendTransaction", params: [tx] });
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new Error("Check your wallet for the transaction hash before trying another payment.");
    }
    return hash;
  };
})();
