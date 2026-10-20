import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import { AVAILABLE_LANGUAGES, LANGUAGES, catalogSection, resolveLocale, messageKey } from "../lib/i18n/locales.ts";
import { createText } from "../lib/i18n/text.ts";
import { parseDecimal, reformatDecimal } from "../lib/i18n/number.ts";
import { cryptoQuantity, formatCryptoQuantity, swapStatus, withdrawalDefaults } from "../lib/crypto-funds.ts";
import { SITE_URL, SITE_HOST, SUPPORT_HREF, referralLink } from "../lib/site.ts";

test("referrals and support links use the canonical domain and encode referral values", () => {
  const url = new URL(referralLink("A&B /+"));
  assert.equal(url.origin, SITE_URL);
  assert.equal(url.host, SITE_HOST);
  assert.equal(url.pathname, "/user/user/register");
  assert.equal(url.searchParams.get("ref"), "A&B /+");
  assert.equal([...url.searchParams.keys()].length, 1);
  assert.equal(SUPPORT_HREF, "mailto:support@q-arculuspro.live");
});

test("registration and action feedback remain available in every published language", () => {
  for (const {code} of AVAILABLE_LANGUAGES) {
    const catalogue = JSON.parse(readFileSync(new URL(`../lib/i18n/catalogs/${code}.json`, import.meta.url)));
    const all = Object.assign({}, ...Object.values(catalogue));
    for (const source of ["Account registration successful.", "Click here to log in", "Sign in with your email address and password to access your account.", "Contact support for more information", "Creating account…", "Signing in…"]) {
      assert(catalogue.common[messageKey(source)], `${code}: shared auth feedback ${source}`);
    }
    for (const source of ["Edit account", "Loan review completed", "Deposit confirmed", "Withdrawal approved", "Reason for change", "Fund Account", "Back to transaction", "Transaction hash (optional)", "Download QR code"]) {
      assert(all[messageKey(source)], `${code}: action feedback ${source}`);
    }
  }
});

test("review playback controls and accessible slide counts are available in every language", () => {
  for (const {code} of AVAILABLE_LANGUAGES) {
    const catalogue = JSON.parse(readFileSync(new URL(`../lib/i18n/catalogs/${code}.json`, import.meta.url)));
    const ui = {...catalogue.common, ...catalogue.account};
    const tx = createText(createTranslator({locale: code, messages: {ui}, namespace: "ui"}), code);
    for (const source of ["Customer voices", "Pause reviews", "Play reviews", "Previous review", "Next review", "Read all reviews", "Your review appears here after approval."]) {
      assert(ui[messageKey(source)], `${code}: review playback ${source}`);
    }
    const count = tx("Review {current} of {total}", {current: 2, total: 3});
    assert(!count.includes("{") && count.includes("2") && count.includes("3"), `${code}: slide count parameters render`);
  }
});

test("swap statuses are translated in the common catalog used by both account and admin pages", () => {
  for (const {code} of AVAILABLE_LANGUAGES) {
    const catalogue = JSON.parse(readFileSync(new URL(`../lib/i18n/catalogs/${code}.json`, import.meta.url)));
    for (const status of ["COMPLETED", "CANCELLED", "REFUNDED", "NEEDS_REVIEW", "AWAITING_FUNDING", "FUNDING", "PROCESSING"]) {
      const source = swapStatus(status);
      assert(catalogue.common[messageKey(source)], `${code}: ${source} must be shared across account/admin`);
    }
    for (const source of ["Paid", "Expired"]) assert(catalogue.common[messageKey(source)], `${code}: dynamic status ${source} must be translated`);
  }
});

test("account security and verification history messages are shared with the admin interface", () => {
  for (const {code} of AVAILABLE_LANGUAGES) {
    const catalogue = JSON.parse(readFileSync(new URL(`../lib/i18n/catalogs/${code}.json`, import.meta.url)));
    for (const source of ["Active sessions", "Set up authenticator", "Download recovery codes", "Verification history", "Previous record preserved", "Version {version}"]) {
      assert(catalogue.common[messageKey(source)], `${code}: ${source} must be available to users and admins`);
    }
  }
});

test("crypto entry keeps exact atomic precision across languages and rejects ambiguous grouping", () => {
  const smallestEth = "0.000000000000000001";
  assert.equal(cryptoQuantity(smallestEth, "en"), smallestEth);
  assert.equal(cryptoQuantity("٠٫٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠١", "ar"), smallestEth);
  assert.equal(cryptoQuantity("0,000000000000000001", "de"), smallestEth);
  assert.equal(cryptoQuantity(formatCryptoQuantity(smallestEth, "de"), "de"), smallestEth);
  assert.equal(cryptoQuantity("1,000", "en"), null);
  assert.equal(cryptoQuantity("1.000", "de"), null);
  assert.equal(cryptoQuantity("1e-18", "en"), null);
  for (const [input, locale] of [["০.০০০০০০০০০০০০০০০০০১", "bn"], ["०.०००००००००००००००००१", "hi"], ["๐.๐๐๐๐๐๐๐๐๐๐๐๐๐๐๐๐๐๑", "th"], ["０.０００００００００００００００００１", "ja"]]) {
    assert.equal(cryptoQuantity(input, locale), smallestEth, `${locale}: native digits retain atomic precision`);
  }
});

test("explicit language choices win; browser preferences resolve regional and Chinese variants", () => {
  assert.equal(resolveLocale("fr", "es;q=1"), "fr");
  assert.equal(resolveLocale(undefined, "xx, de-DE;q=.9, en;q=.5"), "de");
  assert.equal(resolveLocale(undefined, "zh-Hant-HK"), "zh-TW");
  assert.equal(resolveLocale(undefined, "zh-SG"), "zh-CN");
  assert.equal(resolveLocale("invalid", "fr;q=0, ja;q=.8"), "ja");
  assert.equal(resolveLocale(undefined, "unknown"), "en");
});

test("page catalogues separate public, account and admin messages", () => {
  assert.equal(catalogSection("/"), "public");
  assert.equal(catalogSection("/reset-password"), "public");
  assert.equal(catalogSection("/user/user/dashboard/verification"), "account");
  assert.equal(catalogSection("/user/user/connect"), "account");
  assert.equal(catalogSection("/admin/login"), "admin");
  assert.equal(catalogSection("/user/admin/plans"), "admin");
});

test("only complete catalogues are published and negotiation skips unfinished languages", () => {
  const english=JSON.parse(readFileSync(new URL("../lib/i18n/catalogs/en.json",import.meta.url)));
  for (const {code} of AVAILABLE_LANGUAGES) {
    const catalogue=JSON.parse(readFileSync(new URL(`../lib/i18n/catalogs/${code}.json`,import.meta.url)));
    for (const [section,messages] of Object.entries(english)) {
      for (const key of Object.keys(messages)) assert(catalogue[section]?.[key],`${code}: missing ${section}.${key}`);
    }
  }
  assert.equal(resolveLocale("xx", "xx;q=1,es-MX;q=.9", true),"es");
  assert.equal(resolveLocale("en", "es", true),"en");
  const unfinished=LANGUAGES.find(language=>!AVAILABLE_LANGUAGES.some(available=>available.code===language.code));
  if (unfinished) assert.equal(resolveLocale(unfinished.code, "unknown", true),"en");
});

test("all 21 registered languages are published with finance terms and usable plural forms", () => {
  assert.equal(AVAILABLE_LANGUAGES.length, 21);
  for (const {code} of LANGUAGES) {
    assert(AVAILABLE_LANGUAGES.some(language => language.code === code), `${code}: language is published`);
    const catalog=JSON.parse(readFileSync(new URL(`../lib/i18n/catalogs/${code}.json`,import.meta.url)));
    const tx=createText(createTranslator({locale:code,namespace:"ui",messages:{ui:Object.assign({},...Object.values(catalog))}}),code);
    if(code!=="en") for(const source of ["Language","Principal","Withdraw"]) assert.notEqual(tx(source),source,`${code}: ${source}`);
    for(const count of [0,1,2,3,5,11,21,22,101]) {
      const result=tx("{count, plural, one {# month} other {# months}}",{count});
      assert(!/[{}#]/.test(result),`${code}: plural resolves at ${count}`);
      assert(!/months?\b/.test(result)||code==="en",`${code}: no English month fallback`);
    }
    const amount=new Intl.NumberFormat(code,{style:"currency",currency:"USD"}).format(1234.56);
    const message=tx("Your {plan} investment of {amount, number, ::currency/USD} is now active.",{plan:"PRIVATE_PLAN_94",amount:1234.56});
    assert(message.includes("PRIVATE_PLAN_94"),`${code}: private plan name is preserved`);
    assert(message.includes(amount),`${code}: USD value is preserved`);
    const formatted=new Intl.NumberFormat(code,{minimumFractionDigits:2,maximumFractionDigits:2}).format(1234.5);
    assert.equal(parseDecimal(formatted,code),1234.5,`${code}: financial amount round trip`);
    const quantity="0.000000000000000001";
    assert.equal(cryptoQuantity(formatCryptoQuantity(quantity,code),code),quantity,`${code}: crypto precision round trip`);
  }
});

test("Polish and Russian investment durations use their distinct plural forms", () => {
  for(const [code,expected] of [["pl",["1 miesiąc","2 miesiące","5 miesięcy"]],["ru",["1 месяц","2 месяца","5 месяцев"]]]) {
    const catalog=JSON.parse(readFileSync(new URL(`../lib/i18n/catalogs/${code}.json`,import.meta.url)));
    const tx=createText(createTranslator({locale:code,namespace:"ui",messages:{ui:catalog.common}}),code);
    assert.deepEqual([1,2,5].map(count=>tx("{count, plural, one {# month} other {# months}}",{count})),expected);
  }
});

test("translation preserves private names, placeholders and monetary amounts", () => {
  const catalog=JSON.parse(readFileSync(new URL("../lib/i18n/catalogs/es.json",import.meta.url)));
  const messages={ui:Object.assign({},...Object.values(catalog))};
  const tx=createText(createTranslator({locale:"es",namespace:"ui",messages}),"es");
  assert.equal(tx("Language"),"Idioma");
  assert.equal(tx("Hello {name},",{name:"María"}),"Hola, María:");
  assert.equal(tx("private investor note"),"private investor note");
  assert.equal(tx("Unpublished {name}",{name:"María"}),"Unpublished María");
  assert.match(tx.money(123456),/1234|1\.234/);
  assert.match(tx.money(123456),/56/);
});

test("source keys are stable UTF-8 hashes and have no collisions in the current inventory", () => {
  assert.equal(messageKey("Language"),"m9a73db9b");
  const sources=JSON.parse(readFileSync(new URL("../lib/i18n/sources.json",import.meta.url)));
  assert.equal(new Set(sources.map((item)=>messageKey(item.source))).size,sources.length);
  for(const item of sources) assert.equal(item.key,messageKey(item.source));
});

test("catalogue extraction retains recovery email, metadata, financial templates and native validation", () => {
  const sources=JSON.parse(readFileSync(new URL("../lib/i18n/sources.json",import.meta.url)));
  const spanish=JSON.parse(readFileSync(new URL("../lib/i18n/catalogs/es.json",import.meta.url)));
  const messages=Object.assign({},...Object.values(spanish));
  for (const source of ["Hello {name},", "Reset your password", "QFS – Your Financial Freedom Begins here", "Your {plan} investment of {amount, number, ::currency/USD} is now active.", "The :attribute field is required."]) {
    assert(sources.some(item=>item.source === source), `Missing source: ${source}`);
    assert(messages[messageKey(source)], `Missing Spanish translation: ${source}`);
  }
});

test("financial inputs parse regional decimals and reject ambiguous or malformed values", () => {
  for (const [input,locale] of [["1,000.50","en"],["1.000,50","es"],["1.000,50","de"],["1 000,50","fr"],["١٬٠٠٠٫٥٠","ar"],["1000.50","ar"],["১,০০০.৫০","bn"]]) assert.equal(parseDecimal(input,locale),1000.5,`${locale}: ${input}`);
  assert.equal(parseDecimal("1,00,000.50","hi"),100000.5);
  assert.equal(parseDecimal("1.000","es"),1000);
  for (const [input,locale] of [["100.50","es"],["1,00.50","en"],["1,000.500","en"],["1e3","en"],["100 USD","en"],["NaN","en"],["","en"],["١٬٠٠٫٥٠","ar"]]) assert.equal(parseDecimal(input,locale),null,`${locale}: ${input}`);
  assert.equal(parseDecimal("3,5","es"),3.5);
  assert.equal(parseDecimal("-10,50","es"),-10.5);
  assert.equal(parseDecimal("3,5","es",0),null);
  for (const [input, locale] of [["१२३४.५०", "hi"], ["১২৩৪.৫০", "bn"], ["๑๒๓๔.๕๐", "th"], ["۱۲۳۴.۵۰", "ur"], ["１２３４.５０", "ja"]]) assert.equal(parseDecimal(input, locale),1234.5);
});

test("language changes preserve entered financial values instead of reinterpreting separators", () => {
  for (const [input,from,to,amount] of [["1.00","en","es",1],["1,000","en","es",1000],["1.000","es","en",1000],["1.000,50","es","fr",1000.5],["١٬٠٠٠٫٥٠","ar","es",1000.5],["3,45","fr","ar",3.45]]) {
    assert.equal(parseDecimal(reformatDecimal(input,from,to),to),amount);
  }
  assert.equal(reformatDecimal("","es","en"),"");
  assert.equal(reformatDecimal("invalid","es","en"),"invalid");
});

test("withdrawals default to the funded network and respect reserved crypto without rounding", () => {
  const snapshot = {usd: {availableCents: 0}, holdings: [
    {assetKey: "ETH", availableAtomic: "0"},
    {assetKey: "USDT_TRC20", availableAtomic: "100000001"},
    {assetKey: "USDT_BEP20", availableAtomic: "0"}
  ]};
  assert.deepEqual(withdrawalDefaults(snapshot), {source: "CRYPTO", assetKey: "USDT_TRC20"});
  snapshot.usd.availableCents = 10000;
  assert.deepEqual(withdrawalDefaults(snapshot), {source: "CRYPTO", assetKey: "USDT_TRC20"});
  snapshot.holdings[1].availableAtomic = "0";
  assert.deepEqual(withdrawalDefaults(snapshot), {source: "USD", assetKey: "ETH"});
  snapshot.holdings[0].availableAtomic = "1";
  assert.deepEqual(withdrawalDefaults(snapshot), {source: "CRYPTO", assetKey: "ETH"});
});
