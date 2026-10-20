/* Builds local runtime catalogues and checks ICU arguments. No network calls. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { IntlMessageFormat } from "intl-messageformat";
import { execFileSync } from "node:child_process";

const english = JSON.parse(readFileSync("lib/i18n/catalogs/en.json", "utf8"));
const languages = ["en","es","fr","de","it","pt","nl","pl","ru","tr","ar","hi","bn","ur","zh-CN","zh-TW","ja","ko","id","vi","th"];
const check = process.argv.includes("--check");
const only = process.argv.find((argument) => argument.startsWith("--locale="))?.slice(9);
let missing = 0;
const available = [];
function argumentsIn(message, locale) {
  const ast = new IntlMessageFormat(message, locale).getAst();
  const names = new Set();
  function visit(nodes) {
    for (const node of nodes) {
      if ([1,2,3,4,5,6,8].includes(node.type)) names.add(node.value);
      if (node.options) Object.values(node.options).forEach((option) => visit(option.value));
      if (node.children) visit(node.children);
    }
  }
  visit(ast); return [...names].sort().join(",");
}
function formatsIn(message) {
  return [...message.matchAll(/\{\s*\w+\s*,\s*(?:number|date|time)\s*,[^{}]*\}/g)].map(match => match[0]).sort().join("\n");
}
function validationParameters(message) {
  return [...message.matchAll(/(?<![\w:]):[a-z][a-z_]*/g)].map(match => match[0]).sort().join(",");
}
const quote = (value) => `'${value.replace(/\\/g,"\\\\").replace(/'/g,"\\'")}'`;
const validation = JSON.parse(execFileSync("php", ["-r", 'echo json_encode(require "server/vendor/laravel/framework/src/Illuminate/Translation/lang/en/validation.php", JSON_THROW_ON_ERROR);'], {encoding:"utf8"}));
delete validation.custom;
validation.attributes = {
  email:"Email address", password:"Password", password_confirmation:"Confirm password", name:"Full name", token:"Recovery token",
  currentPassword:"Current password", confirmPassword:"Confirm password", code:"Authenticator or recovery code",
  firstName:"First Name", lastName:"Last Name", phone:"Phone number", from:"From", to:"To", status:"Status", search:"Search",
  reason:"Reason for change",
  amount:"Amount", method:"Method", reference:"Reference", details:"Details", file:"File", locale:"Language",
  quantity:"Crypto quantity", assetKey:"Asset and network", walletId:"Receiving wallets", txHash:"Transaction hash",
  legalName:"Full legal name", dateOfBirth:"Date of birth", country:"Country", address:"Address", documentType:"Document type", consent:"Consent",
  description:"Description (shown to users)", terms:"Additional plan terms", riskDisclosure:"Risk disclosure",
  minAmount:"Minimum amount (USD)", maxAmount:"Maximum amount (USD, optional)", monthlyRoiPct:"Monthly ROI (%)", termMonths:"Term (months)",
  "translations.*.description":"Translated description", "translations.*.terms":"Translated plan terms", "translations.*.riskDisclosure":"Translated risk disclosure",
  "translations.*.sourceHash":"Translation source fingerprint"
};
function phpValue(value, depth = 0) {
  if (typeof value === "string") return quote(value);
  const entries = Object.entries(value);
  if (!entries.length) return "[]";
  return `[\n${entries.map(([key, item]) => `${"    ".repeat(depth + 1)}${quote(key)} => ${phpValue(item, depth + 1)},`).join("\n")}\n${"    ".repeat(depth)}]`;
}
for (const locale of languages) {
  const draftPath = `lib/i18n/translations/${locale}.json`;
  const draft = locale === "en" ? {} : existsSync(draftPath) ? JSON.parse(readFileSync(draftPath,"utf8")) : {};
  const parts = `lib/i18n/translations/${locale}`;
  if (locale !== "en" && existsSync(parts)) {
    for (const file of readdirSync(parts).filter((file) => file.endsWith(".json")).sort()) {
      for (const [source, translation] of Object.entries(JSON.parse(readFileSync(`${parts}/${file}`, "utf8")))) {
        if (draft[source] != null && draft[source] !== translation) throw new Error(`${locale}: conflicting translation for ${source}`);
        draft[source] = translation;
      }
    }
  }
  const catalog = {};
  const php = {};
  let count = 0, absent = 0;
  for (const [section, messages] of Object.entries(english)) {
    catalog[section] = {};
    for (const [id, source] of Object.entries(messages)) {
      const translation = locale === "en" ? source : draft[source];
      if (translation == null || translation === "") { absent++; continue; }
      if (argumentsIn(source,"en") !== argumentsIn(translation,locale)) throw new Error(`${locale}: arguments changed for ${source}`);
      if (formatsIn(source) !== formatsIn(translation)) throw new Error(`${locale}: number/date formatting changed for ${source}`);
      if (validationParameters(source) !== validationParameters(translation)) throw new Error(`${locale}: validation parameters changed for ${source}`);
      if (/QFS_VAR_\d|QFSLINE\d/.test(translation)) throw new Error(`${locale}: unresolved draft token for ${source}`);
      catalog[section][id] = translation; count++;
      if (section === "common" || section === "server") php[id] = translation;
    }
  }
  console.log(`${locale}: ${count} messages, ${absent} remaining`);
  if (!absent) available.push(locale);
  if (!only || locale === only) missing += absent;
  if (!check && (!only || locale === only || !absent)) {
    writeFileSync(`lib/i18n/catalogs/${locale}.json`, JSON.stringify(catalog,null,2)+"\n");
    mkdirSync(`server/lang/${locale}`,{recursive:true});
    writeFileSync(`server/lang/${locale}/ui.php`, `<?php\n\nreturn [\n${Object.entries(php).map(([id,value])=>`    ${quote(id)} => ${quote(value)},`).join("\n")}\n];\n`);
    const localize = (value) => typeof value === "string" ? draft[value] ?? value : Object.fromEntries(Object.entries(value).map(([key,item])=>[key,localize(item)]));
    writeFileSync(`server/lang/${locale}/validation.php`, `<?php\n\nreturn ${phpValue(localize(validation))};\n`);
  }
}
if (!check) {
  writeFileSync("lib/i18n/available.json", JSON.stringify(available, null, 2) + "\n");
  writeFileSync("server/lang/available.php", `<?php\n\nreturn [${available.map(quote).join(", ")}];\n`);
}
if(check && missing) { console.error(`${missing} untranslated messages remain.`); process.exitCode=1; }
