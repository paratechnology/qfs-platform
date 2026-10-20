"""Produce resumable translation drafts from public UI source strings only.

This authoring tool is never imported by the website. It does not publish
languages; review drafts, then run localization-catalogs.mjs separately.
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
SOURCES = json.loads((ROOT / "lib/i18n/sources.json").read_text(encoding="utf-8"))
LANGUAGES = ["es", "fr", "de", "ar", "it", "pt", "nl", "pl", "ru", "tr", "hi", "bn", "ur", "zh-CN", "zh-TW", "ja", "ko", "id", "vi", "th"]
LOCK = threading.Lock()
PROTECTED = re.compile(
    r"\{[^{}]*\}|(?<![\w:]):[a-z][a-z_]*|https?://[^\s]+|"
    r"\b(?:QFS|USDT|BTC|ETH|XRP|SOL|USD|CSV|PDF|API|KYC|PHP|QR|RSA|SHA1|BEP20|TRC20|"
    r"Changelly|WalletConnect|MetaMask|CoinGecko|Ethereum|Solana|Bitcoin|Tron|BNB|BSC|UTC)\b|"
    r"(?<![\w])\d+(?:[.,]\d+)*(?:\s?%|\s?(?:MB|KB|GB))?"
)
VARIABLES = re.compile(r"\{[^{}]*\}|(?<![\w:]):[a-z][a-z_]*")


def log(message):
    with LOCK:
        print(message, flush=True)


def mask(source):
    tokens = []

    def replace(match):
        tokens.append(match.group())
        return "QFS_VAR_" + str(len(tokens) - 1)

    return PROTECTED.sub(replace, source), tokens


def restore(source, translated, tokens):
    for index, original in enumerate(tokens):
        token = "QFS_VAR_" + str(index)
        pattern = re.compile(r"QFS[\s_]*VAR[\s_]*" + str(index) + r"(?![0-9])", re.I)
        count = len(pattern.findall(translated))
        exact = bool(VARIABLES.fullmatch(original) or re.match(r"^\d", original))
        if count == 0 or (exact and count != 1):
            raise ValueError("A protected token was changed or duplicated")
        translated = pattern.sub(lambda _: original, translated)
    if "QFS_VAR_" in translated.upper() or Counter(VARIABLES.findall(source)) != Counter(VARIABLES.findall(translated)):
        raise ValueError("Translation changed a variable")
    leading = source[:len(source) - len(source.lstrip())]
    trailing = source[len(source.rstrip()):]
    return leading + translated.strip() + trailing


def translate(text, locale):
    query = urllib.parse.urlencode({"client": "gtx", "sl": "en", "tl": locale, "dt": "t", "q": text})
    url = "https://translate.googleapis.com/translate_a/single?" + query
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "QFS-localization-authoring/1.0"})
            with urllib.request.urlopen(request, timeout=35) as response:
                data = json.load(response)
            return "".join(part[0] or "" for part in data[0])
        except urllib.error.HTTPError as error:
            if error.code in [401, 403]:
                raise
            if error.code == 429:
                delay = max(15, min(60, int(error.headers.get("Retry-After", "30"))))
            elif error.code >= 500:
                delay = 2 ** attempt
            else:
                raise
            if attempt == 3:
                raise
            log(f"{locale}: service returned {error.code}; waiting {delay}s")
            time.sleep(delay)
        except (TimeoutError, urllib.error.URLError):
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def save(path, draft):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def context_source(source):
    replacements = {
        'All scheduled profit is paid. Your principal is awaiting admin release.': 'All scheduled profit has already been paid. Your invested capital is waiting for an administrator to make it available again.',
        'All scheduled profit is paid. Your principal is being returned to available balance.': 'All scheduled profit has already been paid. Your invested capital is being returned to your available account balance.',
        'Loading matured investments…': 'Loading investments whose agreed term has ended…',
        'Profit is based on the original principal and does not compound automatically. Monthly periods follow the start date; accrual advances in full hours.': 'Profit is based on the original invested capital. Profit is not automatically reinvested to earn further profit. Monthly periods are measured from the investment start date. Accrued profit increases only for completed hours.',
        'Quoted output; settlement is not complete.': 'Crypto amount specified in the exchange rate offer; the exchange has not finished settling.',
        'The quoted crypto quantity is the requested payout. No additional platform fee is deducted from this request.': 'The cryptocurrency quantity specified in the exchange rate offer is the requested payout. No additional platform fee is deducted from this request.',
        'The quoted USD value must be between $0.01 and $1,000,000.': 'The USD value specified in the exchange rate offer must be between $0.01 and $1,000,000.',
        'Crypto balance': 'Balance of cryptocurrency in the account',
        'Portfolio balance': 'Total balance of the investment portfolio',
        'Active balance': 'Active account balance',
        'Review swap': 'Review and check the cryptocurrency exchange',
        'Loading balances…': 'Loading account balances…',
        'Receive': 'Receive cryptocurrency',
    }
    if source in replacements:
        return replacements[source]
    source = re.sub(r'\bprincipal\b', 'invested capital', source, flags=re.I)
    return re.sub(r'\bquote\b', 'exchange rate offer', source, flags=re.I)


def draft_locale(locale, contextual=False):
    directory = ROOT / "lib/i18n/translations" / locale
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / ("context.json" if contextual else "draft.json")
    draft = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    known = dict(draft)
    baseline = ROOT / "lib/i18n/translations" / (locale + ".json")
    if not contextual and baseline.exists():
        known.update(json.loads(baseline.read_text(encoding="utf-8")))
    for part in directory.glob("*.json"):
        if contextual and part.name not in ['context.json', 'reviewed.json']:
            continue
        known.update(json.loads(part.read_text(encoding="utf-8")))
    remaining = [item["source"] for item in SOURCES if item["source"] not in known and ", plural," not in item["source"]]
    if contextual:
        remaining = [source for source in remaining if context_source(source) != source]
    log(f"{locale}: {len(remaining)} draft messages remaining")
    while remaining:
        batch, masked, protected = [], [], []
        for source in remaining:
            value, tokens = mask(context_source(source) if contextual else source)
            line = f"QFSLINE{len(batch):04d}: {value}"
            if batch and len(urllib.parse.quote("\n".join(masked + [line]))) > 4800:
                break
            batch.append(source)
            masked.append(line)
            protected.append(tokens)
        text = translate("\n".join(masked), locale)
        matches = list(re.finditer(r"QFSLINE\s*([\d]{4})\s*[:：]?\s*", text, re.I))
        pieces = {}
        for index, match in enumerate(matches):
            pieces[int(match.group(1))] = text[match.end():matches[index + 1].start() if index + 1 < len(matches) else len(text)].strip()
        for index, source in enumerate(batch):
            try:
                if index not in pieces:
                    raise ValueError("Missing line marker")
                value = restore(source, pieces[index], protected[index])
            except ValueError:
                single, tokens = mask(context_source(source) if contextual else source)
                value = restore(source, translate(single, locale), tokens)
            if not value.strip():
                raise ValueError("Empty translation")
            draft[source] = value
        save(path, draft)
        remaining = remaining[len(batch):]
        log(f"{locale}: saved {len(draft)} / {len(SOURCES)} messages")
        time.sleep(0.6)
    log(f"{locale}: first pass complete; plural forms and terminology require review")
    return locale


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--locales", nargs="+", choices=LANGUAGES, default=LANGUAGES)
    parser.add_argument("--workers", type=int, choices=[1, 2], default=2)
    parser.add_argument("--context-review", action="store_true")
    arguments = parser.parse_args()
    failures = []
    with ThreadPoolExecutor(max_workers=arguments.workers) as executor:
        futures = {executor.submit(draft_locale, locale, arguments.context_review): locale for locale in arguments.locales}
        for future in as_completed(futures):
            locale = futures[future]
            try:
                future.result()
                log(f"Draft ready: {locale}")
            except Exception as error:
                failures.append(locale)
                log(f"Draft incomplete: {locale}: {error}")
    if failures:
        raise SystemExit("Resume incomplete locales: " + ", ".join(failures))
