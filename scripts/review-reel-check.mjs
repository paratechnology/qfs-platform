/* Local browser checks. Review content is an in-browser fixture; no reviews are published. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, sleep } from "./lib/cdp.mjs";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const php = code => execFileSync("php", ["-r", `require 'vendor/autoload.php'; $app=require 'bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); if(!app()->environment('local'))throw new RuntimeException('Local checks only'); ${code}`], { cwd: "server", encoding: "utf8" }).trim();
const token = php("$id=Illuminate\\Support\\Facades\\DB::table('User')->where('role','ADMIN')->where('status','ACTIVE')->value('id');if(!$id)throw new RuntimeException('Active admin required');echo App\\Support\\SessionAuth::issue($id);");
let browser;
let passed = 0;
const errors = [];
try {
  const response = await fetch(`${base}/api/dashboard/overview`, { headers: { Cookie: `qfs_session=${token}` } });
  const overview = (await response.json()).data;
  assert(overview, "Authenticated overview available");
  overview.user.name = "Review preview";
  overview.illustrativeReviews = false;
  overview.reviews = [
    { name: "Fixture Avery", text: "The account pages are easy to navigate. I can find the details I need without searching through every menu.", stars: 5, avatar: "/avatars/avatar1.jpg", meta: "" },
    { name: "Fixture Sam", text: "I appreciate being able to read my investment terms and check the status of a request in one place.", stars: 4, avatar: "/avatars/avatar1.jpg", meta: "" },
    { name: "Fixture Noor", text: "The language selector helped me read the account information more comfortably. Clear explanations make a difference.", stars: 5, avatar: "/avatars/avatar1.jpg", meta: "" },
  ];
  browser = await launch({ port: 9250 });
  const { cdp, sessionId } = browser;
  cdp.on("Runtime.exceptionThrown", params => errors.push(params.exceptionDetails.text));
  cdp.on("Runtime.consoleAPICalled", params => { if (params.type === "error") errors.push(params.args.map(arg => arg.value ?? arg.description ?? "").join(" ")); });
  const evaluate = async expression => {
    const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  async function wait(expression, label) {
    for (let i = 0; i < 100; i++) { if (await evaluate(`!!(${expression})`)) return; await sleep(300); }
    mkdirSync("scripts/shots", { recursive: true });
    writeFileSync("scripts/shots/review-check-failure.png", Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64"));
    console.log(await evaluate('JSON.stringify({hidden:document.hidden,focused:document.activeElement?.className,reduce:matchMedia("(prefers-reduced-motion: reduce)").matches,progress:document.querySelector(".dash-reel-progress span")?.style.animationPlayState,root:document.querySelector(".dash-review-reel")?.getBoundingClientRect().toJSON(),paused:localStorage.getItem("qfs-review-reel-paused")})'));
    throw Error("Timed out: " + label);
  }
  async function check(label, expression) {
    const result = await evaluate(expression);
    if (!result) {
      mkdirSync("scripts/shots", { recursive: true });
      writeFileSync("scripts/shots/review-check-failure.png", Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64"));
      console.log(await evaluate('JSON.stringify({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,root:document.querySelector(".dash-review-reel")?.getBoundingClientRect().toJSON(),controls:[...document.querySelectorAll(".dash-reel-control")].map(el=>el.getBoundingClientRect().height)})'));
    }
    assert(result, label); passed++; console.log("PASS " + label);
  }
  const injection = `(() => {
    const original = window.fetch.bind(window);
    const state = window.__reviewCheck = {overview:${JSON.stringify(overview)},blocked:[],reads:0};
    window.fetch = async(input, options={}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
      if (url.pathname.startsWith('/__nextjs_')) return original(input, options);
      if ((options.method ?? 'GET') !== 'GET') { state.blocked.push(url.pathname); throw Error('Writes blocked in review check'); }
      if (url.pathname === '/api/dashboard/overview') { state.reads++; return new Response(JSON.stringify({ok:true,data:state.overview}),{headers:{'Content-Type':'application/json'}}); }
      return original(input, options);
    };
  })()`;
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: injection }, sessionId);
  await cdp.send("Network.setCookie", { name: "qfs_session", value: token, url: base }, sessionId);
  await cdp.send("Network.setCookie", { name: "qfs_locale", value: "en", url: base }, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] }, sessionId);
  await cdp.send("Page.navigate", { url: base + "/user/user/dashboard" }, sessionId);
  await cdp.send("Page.bringToFront", {}, sessionId);
  await wait('document.querySelector(".dash-body")', "dashboard");
  // Polling is normally 15 seconds; a normal focus wake loads the fixture sooner.
  await sleep(1600);
  await evaluate('window.dispatchEvent(new Event("focus"))');
  await wait('document.querySelector(".dash-reel-author b")?.textContent.startsWith("Fixture")', "fixture reviews");
  await evaluate('document.querySelector(".dash-review-reel").scrollIntoView({block:"center"})');
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 }, sessionId);
  await wait('document.querySelector(".dash-reel-progress span").style.animationPlayState === "running"', "autoplay");
  await check("Quote remains paired with its original author", `window.__reviewCheck.overview.reviews.some(r => r.name===document.querySelector('.dash-reel-author b').textContent && r.text===document.querySelector('.dash-reel-slide blockquote').textContent)`);
  await sleep(450);
  await check("Review arrows and count share one aligned navigation group", '(()=>{const nav=document.querySelector(".dash-reel-navigation"),parts=[...nav.children].map(el=>el.getBoundingClientRect());return nav.querySelectorAll("button").length===2&&parts.every(rect=>Math.abs((rect.top+rect.height/2)-(parts[0].top+parts[0].height/2))<1)&&parts[0].right<=parts[1].left&&parts[1].right<=parts[2].left;})()');
  await check("Heading, review and author use the same content edge", '(()=>{const selectors=[".dash-reel-heading",".dash-reel-slide blockquote",".dash-reel-author"];const positions=selectors.map(selector=>document.querySelector(selector).getBoundingClientRect().left);return positions.every(left=>Math.abs(left-positions[0])<1);})()');
  const authorTop = await evaluate('document.querySelector(".dash-reel-author").getBoundingClientRect().top-document.querySelector(".dash-reel-stage").getBoundingClientRect().top');
  const initial = await evaluate('document.querySelector(".dash-reel-author b").textContent');
  await sleep(12500);
  await check("Timed rotation advances without an immediate repeat", `document.querySelector('.dash-reel-author b').textContent !== ${JSON.stringify(initial)}`);
  await evaluate(`document.querySelector('[aria-label="Next review"]').click()`);
  await check("Every third slide has a cinematic treatment", 'document.querySelector(".dash-reel-stage").classList.contains("cinematic")');
  await sleep(450);
  await check("Cinematic slides preserve author placement and text alignment", `Math.abs(document.querySelector('.dash-reel-author').getBoundingClientRect().top-document.querySelector('.dash-reel-stage').getBoundingClientRect().top-${authorTop})<1&&Math.abs(document.querySelector('.dash-reel-heading').getBoundingClientRect().left-document.querySelector('.dash-reel-slide blockquote').getBoundingClientRect().left)<1`);
  const stageHeight = await evaluate('document.querySelector(".dash-reel-stage").getBoundingClientRect().height');
  const beforePrevious = await evaluate('document.querySelector(".dash-reel-author b").textContent');
  await evaluate(`document.querySelector('[aria-label="Previous review"]').click()`);
  await check("Previous control changes slide without shifting layout", `document.querySelector('.dash-reel-author b').textContent !== ${JSON.stringify(beforePrevious)} && document.querySelector('.dash-reel-stage').getBoundingClientRect().height === ${stageHeight}`);
  const point = await evaluate('(()=>{const r=document.querySelector(".dash-reel-stage").getBoundingClientRect();return {x:r.x+40,y:r.y+40};})()');
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point }, sessionId);
  await wait('document.querySelector(".dash-reel-progress span").style.animationPlayState === "paused"', "hover pause");
  await check("Hover pauses playback", 'document.querySelector(".dash-reel-progress span").style.animationPlayState === "paused"');
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 }, sessionId);
  await evaluate('document.querySelector(".dash-reel-controls button").focus()');
  await check("Keyboard focus pauses playback", 'document.querySelector(".dash-reel-progress span").style.animationPlayState === "paused"');
  await evaluate(`document.activeElement.blur();document.querySelector('[aria-label="Pause reviews"]').click()`);
  await check("Explicit pause is remembered", `localStorage.getItem('qfs-review-reel-paused')==='true' && !!document.querySelector('[aria-label="Play reviews"]')`);
  const pausedAuthor = await evaluate('document.querySelector(".dash-reel-author b").textContent');
  const reads = await evaluate('window.__reviewCheck.reads');
  await evaluate('window.dispatchEvent(new Event("focus"))');
  await wait(`window.__reviewCheck.reads>${reads}`, "overview refresh");
  await check("Balance refresh keeps the current review and pause preference", `document.querySelector('.dash-reel-author b').textContent===${JSON.stringify(pausedAuthor)} && !!document.querySelector('[aria-label="Play reviews"]')`);
  await evaluate(`document.querySelector('[aria-label="Play reviews"]').click();document.querySelector('.dash-reel-footer button').click();document.activeElement.blur()`);
  await wait('document.querySelector(".dash-modal")', "review list modal");
  await check("Read all reviews opens details and pauses the reel", 'document.querySelector(".dash-modal").textContent.includes("Fixture Avery") && document.querySelector(".dash-reel-progress span").style.animationPlayState === "paused"');
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
  await wait('!document.querySelector(".dash-modal")', "close reviews");
  await evaluate('document.activeElement.blur();window.scrollTo(0,0)');
  await wait('document.querySelector(".dash-reel-progress span").style.animationPlayState === "paused"', "offscreen pause");
  await check("Offscreen reviews stop playback", 'document.querySelector(".dash-reel-progress span").style.animationPlayState === "paused"');
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }, sessionId);
  await evaluate('document.querySelector(".dash-review-reel").scrollIntoView({block:"center"})');
  await wait(`!document.querySelector('[aria-label="Pause reviews"]')`, "reduced motion");
  await check("Reduced motion disables autoplay while keeping manual controls", `document.querySelector('.dash-reel-progress span').style.animationPlayState === 'paused' && !!document.querySelector('[aria-label="Next review"]')`);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
  await sleep(500);
  await evaluate('document.querySelector(".dash-review-reel").scrollIntoView({block:"center"})');
  await wait('(()=>{const r=document.querySelector(".dash-review-reel").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()', "mobile reel in viewport");
  await check("Mobile reel fits the viewport and controls have touch targets", '(()=>{const r=document.querySelector(".dash-review-reel").getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight && [...document.querySelectorAll(".dash-reel-control")].every(b=>b.getBoundingClientRect().height>=44);})()');
  await check("Mobile review navigation stays together below the review", '(()=>{const nav=document.querySelector(".dash-reel-navigation").getBoundingClientRect(),stage=document.querySelector(".dash-reel-stage").getBoundingClientRect(),buttons=[...document.querySelectorAll(".dash-reel-navigation button")].map(el=>el.getBoundingClientRect());return nav.top>=stage.bottom&&nav.left>=0&&nav.right<=innerWidth&&Math.abs(buttons[0].top-buttons[1].top)<1;})()');
  mkdirSync("scripts/shots", { recursive: true });
  writeFileSync("scripts/shots/review-reel-mobile.png", Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64"));
  await evaluate('window.__reviewCheck.overview.reviews=[];window.dispatchEvent(new Event("focus"))');
  await wait('document.querySelector(".dash-review-invite")', "empty reviews");
  await check("Empty published reviews show an invitation without fabricated testimonials", '!document.querySelector(".dash-review-reel") && document.querySelector(".dash-review-invite").textContent.includes("after approval")');
  await evaluate('document.querySelector(".dash-review-invite button").click()');
  await wait('document.querySelector(".dash-modal textarea")', "review submission form");
  await check("Empty state leads to the real review submission form", '!!document.querySelector(".dash-modal textarea")');
  await evaluate('document.querySelector(".dash-modal-close").click()');
  await wait('!document.querySelector(".dash-modal")', "close review form");
  await evaluate('window.__reviewCheck.overview.illustrativeReviews=true;window.dispatchEvent(new Event("focus"))');
  await wait('document.querySelector(".dash-reel-caption")?.textContent==="Illustrative reviews"', "illustrative class reviews");
  await check("Class-project reviews display their disclosure and 50-review playback count", 'document.querySelector(".dash-reel-count").textContent.includes("50")&&document.querySelector(".dash-reel-caption").textContent==="Illustrative reviews"');
  await evaluate('document.querySelector(".dash-reel-footer button").click()');
  await wait('document.querySelectorAll(".dash-modal .dash-review-card").length===50', "all illustrative reviews");
  await check("All 50 fictional reviewers have distinct names and the list retains its disclosure", 'new Set([...document.querySelectorAll(".dash-modal .dash-review-card-head b")].map(el=>el.textContent)).size===50&&document.querySelector(".dash-modal-body > .dash-input-note").textContent==="Illustrative reviews"&&![...document.querySelectorAll(".dash-modal .dash-review-card")].some(el=>el.textContent.includes("Verified Investor"))');
  await evaluate('[...document.querySelectorAll(".dash-modal-body button")].find(button=>button.textContent==="Write a Review").click()');
  await wait('!!document.querySelector("#review-text")', "review child form");
  await evaluate('document.querySelector(".dash-modal-back").click()');
  await wait('document.querySelectorAll(".dash-modal .dash-review-card").length===50', "back to review list");
  await check("A child dialog Back button returns to its parent list", '!document.querySelector("#review-text")&&document.querySelectorAll(".dash-modal .dash-review-card").length===50');
  await evaluate('document.querySelector(".dash-modal-close").click();[...document.querySelectorAll(".dash-tab")].find(el=>el.textContent.trim()==="Reviews").click()');
  await wait('document.querySelectorAll(".dash-rating-fill").length===5', "illustrative rating breakdown");
  await check("Illustrative review ratings are exactly 92%, 6%, 2%, 0% and 0%", 'JSON.stringify([...document.querySelectorAll(".dash-rating-fill")].map(el=>el.style.width))===JSON.stringify(["92%","6%","2%","0%","0%"] )');
  await check("The rating tab also identifies its reviews as illustrative", '[...document.querySelectorAll(".dash-docs-panel .dash-input-note, .dash-docs-tabs + div .dash-input-note, .dash-review-head + .dash-input-note")].some(el=>el.textContent==="Illustrative reviews")');
  await evaluate('document.querySelector(".dash-review-head").scrollIntoView({block:"start"})');await sleep(500);
  writeFileSync("scripts/shots/illustrative-reviews-mobile.png", Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64"));
  assert.deepEqual(await evaluate('window.__reviewCheck.blocked'), [], "No account writes attempted");
  passed++; console.log("PASS Browser checks made no account writes");
  assert.deepEqual(errors, [], "No runtime or hydration errors"); passed++;
  console.log(`PASS No runtime or hydration errors\n${passed} review reel checks passed`);
} finally {
  if (browser) await browser.close();
  php(`Illuminate\\Support\\Facades\\DB::table('Session')->where('tokenHash', App\\Support\\SessionAuth::tokenHash('${token}'))->delete();`);
}
process.exit(0);
