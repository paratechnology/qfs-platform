/* Source inventory and migration for built-in translations. No network calls. */
import ts from "typescript";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const write = process.argv.includes("--write");
const files = [];
function scan(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (/\.tsx?$/.test(file) && !/icons\.tsx|ReferralCapture|Reveal\.tsx/.test(file)) files.push(file);
  }
}
scan("components"); scan("app/user"); scan("app/admin"); scan("app/forgot-password"); scan("app/reset-password");
files.push("lib/use-live.tsx", "lib/wallet-client.ts");
files.push("lib/crypto-funds.ts");
files.push("app/layout.tsx");
files.push("app/error.tsx", "app/loading.tsx");
const sources = new Map();
const commonFiles = /AuthLayout|ActionFeedback|PasswordField|EmailField|AccountRecovery|AccountSettings|KycHistory|LanguageSelector|feedback|use-live|crypto-funds|app[\\/](?:layout|error|loading)/;
function section(file) {
  return commonFiles.test(file) ? "common" : /admin/.test(file) ? "admin" : /dashboard|connect|wallet-client/.test(file) ? "account" : "public";
}
function key(source) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(source)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return `m${hash.toString(16).padStart(8, "0")}`;
}
function add(source, bucket) {
  if (!source || !/[A-Za-z]/.test(source)) return;
  const item = sources.get(source) ?? new Set(); item.add(bucket); sources.set(source, item);
}
const exceptions = new Set(["QFS", "USD", "BTC", "ETH", "USDT", "NFT", "API", "POST", "GET", "PATCH", "DELETE", "PUT", "Content-Type", "ACTIVE", "ADMIN", "USER", "PENDING", "APPROVED", "REJECTED", "CLOSED", "MATURED", "MONTHLY", "HOURLY", "MANUAL", "AUTOMATIC", "IDENTITY_FRONT", "IDENTITY_BACK", "PORTRAIT", "PASSPORT", "NATIONAL_ID", "DRIVERS_LICENSE", "DRAFT", "NOT_STARTED", "NEEDS_CHANGES", "Escape", "Enter", "Tab", "Bearer", "Bitcoin", "Ethereum"]);
function human(value) {
  if (/^(?:dash|adm|fund|swap)-[\w-]+(?:\s+(?:dash|adm|fund|swap)-[\w-]+)*$/.test(value)) return false;
  if (value === "to") return false;
  value = value.trim();
  if (!/[A-Za-z]/.test(value) || exceptions.has(value) || /^(?:\/|#|https?:|mailto:|[\w.-]+@)/.test(value)) return false;
  if (/^(?:btn|label|section|feature-box|hero-label|play-btn|noreferrer|width\s+\d|M\d)(?:\s|$)/.test(value)) return false;
  if (/^(?:btn-|label-|width\s+\d)/.test(value) || /^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(value)) return false;
  if (/^(?:\d+(?:px|rem|em)\b|m\d+\s|ui-monospace,)/.test(value)) return false;
  if (/^(?:wc-|button:not|input, select|noopener noreferrer$)/.test(value) || ["Accept-Language", "Cookie"].includes(value)) return false;
  if (/^(?:dash-|adm-|auth-|wlt-|application\/|image\/|text\/|qfs-|rgba?\(|var\(|use |@|[a-z]+(?:-[a-z]+)+$)/.test(value)) return false;
  return /\s/.test(value) || /^[A-Z][a-z]/.test(value) || /^(?:monthly|hourly|months|days|hours|via|from|to|of|totaling|available|pending|completed|approved|rejected)$/.test(value);
}
function decode(value) {
  return value.replace(/&(?:apos|quot|amp|lt|gt|nbsp);/g, (match) => ({"&apos;":"'","&quot;":'"',"&amp;":"&","&lt;":"<","&gt;":">","&nbsp;":" "}[match]))
    .replace(/&#(?:x([a-f0-9]+)|(\d+));/gi, (_, hex, decimal) => String.fromCodePoint(parseInt(hex ?? decimal, hex ? 16 : 10)));
}
function jsxText(value) {
  const lines = value.split(/\r?\n/);
  return decode(lines.map((line, index) => {
    let current = line.replace(/\t/g, " ");
    if (index > 0) current = current.replace(/^ +/, "");
    if (index < lines.length - 1) current = current.replace(/ +$/, "");
    return current;
  }).filter((line) => line.length).join(" "));
}
const displayAttributes = new Set(["label", "title", "subtitle", "eyebrow", "submitLabel", "placeholder", "aria-label", "alt", "confirmLabel", "text", "hint", "emptyTitle"]);
const displayIdentifiers = /^(?:label|title|subtitle|eyebrow|submitLabel|placeholder|error|message|hint|busy|busyLabel|success|toast|statusText|type|method|period)$/;
const displayProperties = /^(?:label|title|subtitle|description|short)$/;
function component(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) && parent.name && /^[A-Z]/.test(parent.name.text)) return parent;
  }
}
function hasJsx(node) {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
  let found = false; ts.forEachChild(node, (child) => { if (hasJsx(child)) found = true; }); return found;
}
function textExpression(node) {
  return ts.isIdentifier(node) && displayIdentifiers.test(node.text)
    || ts.isPropertyAccessExpression(node) && displayProperties.test(node.name.text)
    || ts.isConditionalExpression(node) && ts.isStringLiteral(node.whenTrue) && ts.isStringLiteral(node.whenFalse);
}

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const bucket = section(file), edits = [], owners = new Set();
  const migrate = !/LanguageSelector|lib[\\/]wallet-client/.test(file);
  function edit(node, replacement, start = node.getStart(tree), end = node.end) {
    const owner = component(node);
    if (!owner || !migrate) return;
    owners.add(owner); edits.push({ start, end, replacement });
  }
  function valueExpression(expression) {
    if (textExpression(expression)) return `tx(${expression.getText(tree)})`;
    return localizedExpression(expression);
  }
  function localizedExpression(expression) {
    const base = expression.getStart(tree), changes = [];
    function walk(current) {
      if (ts.isTemplateExpression(current)) {
        let message = current.head.text; const values = [];
        for (const span of current.templateSpans) { const name = `value${values.length}`; values.push(`${name}: ${valueExpression(span.expression)}`); message += `{${name}}${span.literal.text}`; }
        if (human(message.replace(/\{value\d+\}/g, ""))) {
          add(message, bucket); changes.push({start:current.getStart(tree)-base,end:current.end-base,replacement:`tx(${JSON.stringify(message)}, { ${values.join(", ")} })`}); return;
        }
      }
      if (ts.isStringLiteral(current) && human(current.text)) {
        const parent = current.parent;
        const structural = ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsToken,ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsToken,ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(parent.operatorToken.kind)
          || ts.isPropertyAssignment(parent) && parent.name === current
          || ts.isElementAccessExpression(parent) && parent.argumentExpression === current;
        if (!structural) { add(current.text,bucket); changes.push({start:current.getStart(tree)-base,end:current.end-base,replacement:`tx(${JSON.stringify(current.text)})`}); return; }
      }
      ts.forEachChild(current, walk);
    }
    walk(expression);
    let result = expression.getText(tree);
    for (const change of changes.sort((a,b)=>b.start-a.start)) result = result.slice(0,change.start)+change.replacement+result.slice(change.end);
    return result;
  }
  function visit(node) {
    if (ts.isStringLiteral(node) && !ts.isTypeNode(node.parent) && human(node.text)) add(node.text, bucket);
    if (ts.isPropertyAssignment(node) && (ts.isStringLiteral(node.name) || ts.isIdentifier(node.name)) && human(node.name.text)) add(node.name.text, bucket);
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "tx" && ts.isStringLiteral(node.arguments[0])) add(node.arguments[0].text, bucket);
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const children = node.children;
      const simple = children.length && children.every((child) => ts.isJsxText(child) || ts.isJsxExpression(child) && child.expression && !hasJsx(child.expression));
      if (simple) {
        let message = "", values = [];
        for (const child of children) {
          if (ts.isJsxText(child)) message += jsxText(child.text);
          else if (ts.isStringLiteral(child.expression)) message += child.expression.text;
          else { const name = `value${values.length}`; message += `{${name}}`; values.push(`${name}: ${valueExpression(child.expression)}`); }
        }
        message = message.trim();
        if (human(message.replace(/\{value\d+\}/g, "")) && component(node)) {
          add(message, bucket);
          edit(node, `{tx(${JSON.stringify(message)}${values.length ? `, { ${values.join(", ")} }` : ""})}`, children[0].pos, children[children.length - 1].end);
          // Expressions can contain their own static labels and remain in the inventory.
          for (const child of children) if (ts.isJsxExpression(child) && child.expression) inventory(child.expression);
          if (ts.isJsxElement(node)) visit(node.openingElement);
          return;
        }
      }
    }
    if (ts.isJsxText(node) && human(jsxText(node.text).trim())) {
      const text = jsxText(node.text).trim(); add(text, bucket);
      edit(node, `{tx(${JSON.stringify(text)})}`, node.pos);
      return;
    }
    if (ts.isJsxAttribute(node) && displayAttributes.has(node.name.getText(tree)) && node.initializer) {
      if (ts.isStringLiteral(node.initializer) && human(node.initializer.text)) {
        add(node.initializer.text, bucket); edit(node.initializer, `{tx(${JSON.stringify(node.initializer.text)})}`); return;
      }
    }
    if (ts.isJsxExpression(node) && node.expression && !hasJsx(node.expression)) {
      const attribute = ts.isJsxAttribute(node.parent) ? node.parent.name.getText(tree) : null;
      if (!attribute || displayAttributes.has(attribute)) {
        const expression = node.expression;
        if (textExpression(expression) && component(node)) { edit(expression, `tx(${expression.getText(tree)})`); inventory(expression); return; }
        if (ts.isStringLiteral(expression) && human(expression.text)) { add(expression.text, bucket); edit(expression, `tx(${JSON.stringify(expression.text)})`); return; }
        if (ts.isTemplateExpression(expression)) {
          let message = expression.head.text; const values = [];
          for (const span of expression.templateSpans) { const name = `value${values.length}`; values.push(`${name}: ${valueExpression(span.expression)}`); message += `{${name}}${span.literal.text}`; }
          if (human(message.replace(/\{value\d+\}/g, ""))) { add(message, bucket); edit(expression, `tx(${JSON.stringify(message)}, { ${values.join(", ")} })`); inventory(expression); return; }
        }
        const translated = localizedExpression(expression);
        if (translated !== expression.getText(tree)) { edit(expression, translated); inventory(expression); return; }
      }
    }
    ts.forEachChild(node, visit);
  }
  function inventory(node) {
    if (ts.isStringLiteral(node) && human(node.text)) add(node.text, bucket);
    ts.forEachChild(node, inventory);
  }
  visit(tree);
  if (write && edits.length) {
    for (const owner of owners) {
      const async = owner.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
      edits.push({start:owner.body.getStart(tree)+1,end:owner.body.getStart(tree)+1,replacement:`\n  const tx = ${async ? "await getText()" : "useText()"};`});
    }
    const async = [...owners].some((owner) => owner.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword));
    const sync = [...owners].some((owner) => !owner.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword));
    const imports = `${async ? 'import { getText } from "@/lib/i18n/server";\n' : ""}${sync ? 'import { useText } from "@/lib/i18n/text";\n' : ""}`;
    const insertion = source.startsWith('"use client";') ? source.indexOf(";") + 1 : 0;
    edits.push({start:insertion,end:insertion,replacement:`\n${imports}`});
    let result = source;
    for (const change of edits.sort((a,b)=>b.start-a.start || b.end-a.end)) result = result.slice(0,change.start)+change.replacement+result.slice(change.end);
    const backup = join(process.env.TEMP ?? ".", "qfs-localization-source", file); mkdirSync(join(backup,".."), {recursive:true}); writeFileSync(backup, source);
    writeFileSync(file, result);
  }
}
const backend = [];
function scanBackend(path) {
  for (const entry of readdirSync(path,{withFileTypes:true})) {
    const file=join(path,entry.name);
    if(entry.isDirectory()) scanBackend(file);
    else if(file.endsWith(".php")) backend.push(file);
  }
}
scanBackend("server/app/Http"); scanBackend("server/app/Support"); scanBackend("server/app/Mail");
backend.push("server/resources/views/emails/password-recovery.blade.php");
backend.push("server/resources/views/statements/account.blade.php");
const phpStrings = JSON.parse(execFileSync("php", ["-r", `
$result = [];
foreach (array_slice($argv, 1) as $file) {
    $code = file_get_contents($file);
    if (str_ends_with($file, ".blade.php")) {
        preg_match_all('/\\{\\{(.*?)\\}\\}/s', $code, $expressions);
        $code = "<?php\\n".implode(";\\n", $expressions[1]);
    }
    $offset = 0;
    foreach (token_get_all($code) as $token) {
        $raw = is_array($token) ? $token[1] : $token;
        if (is_array($token) && $token[0] === T_CONSTANT_ENCAPSED_STRING) {
            $value = substr($raw, 1, -1);
            $value = $raw[0] === "'" ? str_replace(["\\\\'", "\\\\\\\\"], ["'", "\\\\"], $value) : stripcslashes($value);
            if (!preg_match('/table\\($/', substr($code, 0, $offset))) $result[] = $value;
        }
        $offset += strlen($raw);
    }
}
echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
`, ...backend], { encoding: "utf8" }));
const technical = new Set(["Accept", "Cache-Control", "Content-Disposition", "Content-Language", "Origin", "Referer", "Sec-Fetch-Site", "User-Agent", "F Y", "M j, Y, h:i A", "MMM d, y, h:mm a", "MMMM y", "Version: 1", "Issued At: ", "Nonce: ", "Transaction."]);
for (const message of phpStrings) {
  if (/LIKE\s*\?|\bTHEN\s+\d+\s+ELSE/.test(message)) continue;
  if ([" months; payout: ", " to ", "; activity timestamps are UTC. Snapshot rows show current values, not historical closing balances.", "; ends: ", "; paid profit USD: ", "%; term: ", "0 <= available <= total", "0 <= reserved <= total", "Asset/network", "Available USD: ", "Crypto quantity / reserved", "Invalid authenticator secret", "Missing", "Monthly rate: ", "No ledger record", "Record", "Recorded at (UTC)", "Reserved: ", "USD fee"].includes(message) || message.startsWith("LOWER(")) continue;
  if (["Idempotency-Key", "from", "binance smart chain", "bnb smart chain"].includes(message)) continue;
  if (["Y-m-d H:i:s", "Crypto payout ", "USD investment funding from ", "USD reserved for crypto withdrawal ("].includes(message)) continue;
  if (human(message) && !technical.has(message) && !/^[A-Z_0-9]+$/.test(message)
      && !/(?:[\x00-\x1f]|=>|function|\\|\.php|^ui\.|\.getLocale|^m\.|^[A-Z]\w*\.[\w*]|^CASE WHEN|^Mozilla\/|^(?:inline|attachment);|^private, no-store)/.test(message)) add(message,"server");
}
const validation = JSON.parse(execFileSync("php", ["-r", 'echo json_encode(require "server/vendor/laravel/framework/src/Illuminate/Translation/lang/en/validation.php", JSON_THROW_ON_ERROR);'], {encoding:"utf8"}));
delete validation.custom; delete validation.attributes;
function validationSources(value) {
  if (typeof value === "string") add(value,"server");
  else Object.values(value).forEach(validationSources);
}
validationSources(validation);
for (const label of ["Email address", "Recovery token", "File", "Translation source fingerprint", "Confirm password", "Full name", "Consent"]) add(label, "server");
for (const status of ["Active","Suspended","Pending","Approved","Rejected","Completed","Cancelled","Failed","Paid","Expired","Frozen","Inactive","Disabled","Hidden","Closed","Matured","Draft","Not started","Needs changes","Manual","Automatic","Hourly","Monthly"]) add(status,"common");
const catalog = {common:{},public:{},account:{},admin:{},server:{}};
const inventory = [];
const collisions = new Map();
for (const [source, buckets] of [...sources].sort(([a],[b])=>a.localeCompare(b))) {
  const id = key(source);
  if (collisions.has(id) && collisions.get(id) !== source) throw new Error(`Message key collision: ${source}`);
  collisions.set(id, source);
  const bucket = buckets.has("common") || buckets.size > 1 ? "common" : [...buckets][0];
  catalog[bucket][id] = source;
  inventory.push({key:id,section:bucket,source});
}
mkdirSync("lib/i18n/catalogs", {recursive:true});
writeFileSync("lib/i18n/sources.json", JSON.stringify(inventory,null,2)+"\n");
writeFileSync("lib/i18n/catalogs/en.json", JSON.stringify(catalog,null,2)+"\n");
console.log(`${inventory.length} source messages; ${Object.entries(catalog).map(([name,items])=>`${name}: ${Object.keys(items).length}`).join(", ")}`);
