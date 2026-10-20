"use client";
import { useText } from "@/lib/i18n/text";
import LanguageSelector from "@/components/LanguageSelector";


import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { isAddress } from "viem";
import {
  ETH_MAINNET,
  CONNECTION_CHAIN_IDS,
  describeProviderError,
  explorerAddress,
  getAccounts,
  getChainId,
  discoverWallets,
  selectProvider,
  walletAppLinks,
  type BrowserWallet,
  requestAccounts,
  shortAddress,
  signMessage,
  switchToMainnet,
} from "@/lib/wallet-client";

type Wallet = { address: string; chainId: number; label: string; lastUsedAt: string };
type ManualChallenge = { address: string; nonce: string; message: string };

type Status =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string };

export default function ConnectWalletPage() {
  const tx = useText();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [browserWallets, setBrowserWallets] = useState<BrowserWallet[]>([]);
  const [selectedWallet, setSelectedWallet] = useState("");
  const [appLinks, setAppLinks] = useState<ReturnType<typeof walletAppLinks>>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const actionLock = useRef(false);
  const [chainId, setChainId] = useState<number | null>(null);
  const [liveAccount, setLiveAccount] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualAddress, setManualAddress] = useState("");
  const [manualSignature, setManualSignature] = useState("");
  const [manualChallenge, setManualChallenge] = useState<ManualChallenge | null>(null);

  const load = useCallback(async () => {
    setListError(false);
    try {
      const res = await fetch("/api/wallet", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error("Request failed");
      setWallets(json.data.wallets as Wallet[]);
    } catch {
      setListError(true);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    setAppLinks(walletAppLinks(window.location.origin));
    return discoverWallets((available) => {
      setBrowserWallets(available);
      setInstalled(available.length > 0);
      setSelectedWallet((current) => available.some((wallet) => wallet.id === current) ? current : available[0]?.id ?? "");
    });
  }, [load]);

  useEffect(() => {
    const provider = browserWallets.find((wallet) => wallet.id === selectedWallet)?.provider ?? null;
    selectProvider(provider);
    setLiveAccount(null);
    setChainId(null);
    if (!provider) return;
    let active = true;

    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setLiveAccount(accounts?.[0] ?? null);
    };
    const onChain = (...args: unknown[]) => {
      const raw = args[0] as string;
      setChainId(Number.parseInt(raw, 16));
    };
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);

    void getChainId()
      .then((chain) => { if (active) setChainId(chain); })
      .catch(() => { if (active) setChainId(null); });
    void getAccounts().then((a) => { if (active) setLiveAccount(a[0] ?? null); });

    return () => {
      active = false;
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [browserWallets, selectedWallet]);

  const onWrongNetwork = chainId !== null && !CONNECTION_CHAIN_IDS.includes(chainId);

  const connect = async () => {
    if (actionLock.current) return;
    actionLock.current = true;
    setStatus({ kind: "working", step: "Opening your wallet…" });
    try {
      const [account] = await requestAccounts();
      setLiveAccount(account);

      let chain = await getChainId();
      if (!CONNECTION_CHAIN_IDS.includes(chain)) {
        setStatus({ kind: "working", step: `Switching to ${ETH_MAINNET.name}…` });
        await switchToMainnet();
        chain = await getChainId();
      }
      setChainId(chain);

      setStatus({ kind: "working", step: "Preparing signature…" });
      const challenge = await postJson<{ nonce: string; message: string }>("/api/wallet/challenge", {
        address: account,
      });

      setStatus({ kind: "working", step: "Confirm the signature in your wallet…" });
      const signature = await signMessage(challenge.message, account);

      setStatus({ kind: "working", step: "Verifying…" });
      const res = await postJson<{ alreadyConnected: boolean }>("/api/wallet/verify", {
        address: account,
        signature,
        nonce: challenge.nonce,
        chainId: chain,
      });

      await load();
      setStatus({
        kind: "done",
        message: res.alreadyConnected
          ? "Wallet reconnected."
          : "Wallet connected and verified.",
      });
    } catch (err) {
      setStatus({ kind: "error", message: describeProviderError(err) });
      setManualOpen(true);
    } finally {
      actionLock.current = false;
    }
  };

  const prepareManualChallenge = async () => {
    const address = manualAddress.trim();
    if (!isAddress(address)) {
      setStatus({ kind: "error", message: "Enter a valid Ethereum public address." });
      return;
    }
    setStatus({ kind: "working", step: "Preparing a one-time message…" });
    try {
      const challenge = await postJson<{ nonce: string; message: string }>("/api/wallet/challenge", { address });
      setManualChallenge({ address, ...challenge });
      setManualSignature("");
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  };

  const verifyManualSignature = async () => {
    if (!manualChallenge) return;
    const signature = manualSignature.trim();
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      setStatus({ kind: "error", message: "Paste the full 0x signature from your wallet." });
      return;
    }
    setStatus({ kind: "working", step: "Verifying wallet ownership…" });
    try {
      const result = await postJson<{ alreadyConnected: boolean }>("/api/wallet/verify", {
        address: manualChallenge.address,
        signature,
        nonce: manualChallenge.nonce,
        chainId: ETH_MAINNET.chainId,
      });
      await load();
      setManualChallenge(null);
      setManualSignature("");
      setStatus({ kind: "done", message: result.alreadyConnected ? "Wallet reconnected." : "Wallet connected and verified." });
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  };

  const disconnect = async (address: string) => {
    setStatus({ kind: "working", step: "Disconnecting…" });
    try {
      await postJson("/api/wallet", { address });
      await load();
      setStatus({ kind: "done", message: "Wallet disconnected." });
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  };

  const working = status.kind === "working";

  return (
    <div className="wc-wrap">
      <Link className="wc-back" href="/user/user/dashboard">← {tx("Back to dashboard")}</Link>
      <div className="wallet-language"><LanguageSelector /></div>
      <div className="wc-head">
        <h1>{tx("Connect Wallet")}</h1>
        <p>{tx("Connect your Ethereum or BNB Smart Chain wallet by signing a message. Connecting verifies ownership and never moves money on its own.")}</p>
      </div>

      {installed === false && (
        <div className="wc-note">
          <strong>{tx("No wallet is available in this browser.")}</strong>{tx("Open this page in your wallet app, or use a browser with a wallet extension.")}
          <a href="https://metamask.io/download/" target="_blank" rel="noreferrer noopener">{tx("Get MetaMask")}</a>
        </div>
      )}

      {onWrongNetwork && (
        <div className="wc-note wc-note-warn">{tx("Your wallet is on chain")}{chainId}{tx(". Switch to")}{ETH_MAINNET.name}{tx("to connect.")}<button
            type="button"
            className="wc-btn wc-btn-ghost"
            disabled={working}
            onClick={async () => {
              try {
                await switchToMainnet();
                setChainId(await getChainId());
                setStatus({ kind: "idle" });
              } catch (err) {
                setStatus({ kind: "error", message: describeProviderError(err) });
              }
            }}
          >{tx("Switch network")}</button>
        </div>
      )}

      <div className="wc-card">
        {browserWallets.length > 0 && <label className="wc-field" htmlFor="wc-provider">{tx("Choose your wallet")}
          <select id="wc-provider" className="wc-input" value={selectedWallet} disabled={working}
            onChange={(event) => { setSelectedWallet(event.target.value); setStatus({ kind: "idle" }); }}>
            {browserWallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}
          </select>
        </label>}
        <button
          type="button"
          className="wc-btn wc-btn-primary"
          onClick={connect}
          disabled={working || installed !== true}
          aria-busy={working}
        >
          {tx(wallets.length > 0 ? "Connect another wallet" : "Connect wallet")}
        </button>

        {status.kind === "working" && (
          <p className="wc-status" role="status">
            <span className="wc-spinner" aria-hidden="true" />
            {tx(status.step)}
          </p>
        )}
        {status.kind === "error" && (
          <p className="wc-status wc-status-error" role="alert">
            {tx(status.message)}
          </p>
        )}
        {status.kind === "done" && (
          <p className="wc-status wc-status-ok" role="status">
            {tx(status.message)}
          </p>
        )}
      </div>

      {installed === false && <section className="wc-card">
        <h2 className="wc-app-title">{tx("Open in wallet app")}</h2>
        <p className="wc-manual-intro">{tx("On your phone, open this page in MetaMask or Trust Wallet. Sign in there, then connect your wallet.")}</p>
        {appLinks ? <div className="wc-app-links">
          <a className="wc-btn wc-btn-ghost" href={appLinks.metamask}>MetaMask ↗</a>
          <a className="wc-btn wc-btn-ghost" href={appLinks.trust}>Trust Wallet ↗</a>
        </div> : <p className="wc-status">{tx("Use the HTTPS website address to open this page in a wallet app.")}</p>}
      </section>}

      <section className="wc-card wc-manual">
        <button type="button" className="wc-manual-toggle" aria-expanded={manualOpen}
          aria-controls="wc-manual-form" onClick={() => setManualOpen((value) => !value)}>
          {tx(manualOpen ? "Hide manual verification" : "Automatic connection failed? Verify manually")}
        </button>
        {manualOpen && <div id="wc-manual-form">
          <p className="wc-manual-intro">{tx("Enter your public Ethereum address, sign the one-time message in your wallet, then paste the signature. Never enter your recovery phrase or private key here.")}</p>
          <p className="wc-manual-intro">{tx("If you only have a recovery phrase, import it in your wallet app first, then return here to connect. This site will never ask you to type it.")}</p>
          <label className="wc-field" htmlFor="wc-address">{tx("Public wallet address")}</label>
          <input id="wc-address" className="wc-input" autoComplete="off" spellCheck={false}
            placeholder="0x…" value={manualAddress} disabled={working}
            onChange={(event) => { setManualAddress(event.target.value); setManualChallenge(null); setManualSignature(""); }} />
          <button type="button" className="wc-btn wc-btn-ghost wc-manual-action" disabled={working}
            onClick={prepareManualChallenge}>{tx("Generate signing message")}</button>
          {manualChallenge && <>
            <label className="wc-field" htmlFor="wc-message">{tx("Sign this exact message in your wallet")}</label>
            <textarea id="wc-message" className="wc-input wc-message" readOnly value={manualChallenge.message} rows={9} />
            <button type="button" className="wc-btn wc-btn-ghost wc-manual-action"
              onClick={async () => {
                try { await navigator.clipboard.writeText(manualChallenge.message); setStatus({ kind: "done", message: "Signing message copied." }); }
                catch { setStatus({ kind: "error", message: "Select and copy the message above." }); }
              }}>{tx("Copy message")}</button>
            <label className="wc-field" htmlFor="wc-signature">{tx("Signature from your wallet")}</label>
            <textarea id="wc-signature" className="wc-input wc-signature" autoComplete="off" spellCheck={false}
              placeholder="0x…" value={manualSignature} disabled={working}
              onChange={(event) => setManualSignature(event.target.value)} rows={3} />
            <button type="button" className="wc-btn wc-btn-primary wc-manual-action" disabled={working}
              onClick={verifyManualSignature}>{tx("Verify and connect")}</button>
          </>}
        </div>}
      </section>

      <section className="wc-list">
        <h2>{tx("Your wallets")}</h2>
        {listLoading ? <p className="wc-status" role="status">{tx("Loading wallets…")}</p> : listError ? <p className="wc-status wc-status-error" role="alert">
          {tx("Your wallets could not be loaded.")} <button className="wc-btn wc-btn-ghost" disabled={working} onClick={() => void load()}>{tx("Try again")}</button>
        </p> : wallets.length === 0 ? (
          <p className="wc-empty">{tx("No wallets connected yet.")}</p>
        ) : (
          <ul>
            {wallets.map((w) => (
              <li key={w.address} className="wc-item">
                <div>
                  <a
                    className="wc-addr"
                    href={explorerAddress(w.address, w.chainId)}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={w.address}
                  >
                    {shortAddress(w.address)}
                  </a>
                  <span className="wc-meta">
                    {w.chainId === 56 ? "BNB Smart Chain" : w.chainId === ETH_MAINNET.chainId ? ETH_MAINNET.name : tx("Chain {value0}", { value0: w.chainId })}
                    {tx(liveAccount && liveAccount.toLowerCase() === w.address.toLowerCase()
                      ? " · active in this browser"
                      : "")}
                  </span>
                </div>
                <button
                  type="button"
                  className="wc-btn wc-btn-ghost"
                  onClick={() => disconnect(w.address)}
                  disabled={working}
                >{tx("Disconnect")}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="wc-foot">{tx("Wallet verification does not authorize a payment or transfer. Withdrawal requests require separate review.")}</p>
    </div>
  );
}

async function postJson<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error?.message ?? "Request failed. Please try again.");
  }
  return json.data as T;
}
