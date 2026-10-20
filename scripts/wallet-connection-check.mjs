import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {launch, sleep} from './lib/cdp.mjs';

const base = process.env.BASE_URL ?? 'http://localhost:3000';
const php = code => execFileSync('php', ['-r', `require 'vendor/autoload.php'; $app=require 'bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); if(!app()->environment('local'))throw new RuntimeException('Local checks only'); ${code}`], {cwd:'server',encoding:'utf8'}).trim();
const token = php("$id=Illuminate\\Support\\Facades\\DB::table('User')->where('status','ACTIVE')->value('id');if(!$id)throw new RuntimeException('Active user required');echo App\\Support\\SessionAuth::issue($id);");
let browser;
let passed = 0;
const errors = [];
try {
  browser = await launch({port:9254});
  const {cdp,sessionId} = browser;
  cdp.on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.text));
  const evaluate = async expression => {
    const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);
    if(result.exceptionDetails)throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  async function wait(expression) { for(let i=0;i<150;i++){if(await evaluate(`!!(${expression})`))return;await sleep(400);}throw Error('Timed out: '+expression); }
  async function check(label, expression) { assert(await evaluate(expression),label);passed++;console.log('PASS '+label); }
  const injection = `(()=>{
    const scenario=new URLSearchParams(location.search).get('case')||'eip';
    const state=window.__walletCheck={calls:[],writes:[],wallets:[],hold:false,fail:scenario==='load-error'};
    const original=fetch.bind(window);
    const address='0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
    let chain=scenario==='bnb'?'0x38':scenario==='network'?'0x89':'0x1';
    const provider=name=>({isMetaMask:name==='MetaMask',on(){},removeListener(){},async request({method,params}){
      state.calls.push({name,method});
      if(method==='eth_chainId')return chain;
      if(method==='eth_accounts'||method==='eth_requestAccounts')return [address];
      if(method==='wallet_switchEthereumChain'){chain=params[0].chainId;return null;}
      if(method==='personal_sign'){
        if(scenario==='reject')throw Object.assign(new Error('Rejected'),{code:4001});
        while(state.hold)await new Promise(r=>setTimeout(r,20));
        return '0x'+'1'.repeat(130);
      }
      throw Error('Unexpected wallet RPC '+method);
    }});
    delete window.ethereum;
    if(scenario==='legacy')window.ethereum=provider('MetaMask');
    else if(!['none','load-error'].includes(scenario)){
      const items=[{info:{uuid:'trust-test',name:'Trust Wallet'},provider:provider('Trust Wallet')},{info:{uuid:'metamask-test',name:'MetaMask'},provider:provider('MetaMask')}];
      const announce=()=>items.forEach(detail=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail})));
      if(scenario==='late')state.announce=announce;
      else addEventListener('eip6963:requestProvider',announce);
    }
    window.fetch=async(input,options={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.origin);
      const method=options.method||'GET';
      const reply=(data,status=200)=>new Response(JSON.stringify(status===200?{ok:true,data}:{ok:false,error:{message:data}}),{status,headers:{'Content-Type':'application/json'}});
      if(url.pathname.startsWith('/api/wallet')){
        if(method!=='GET')state.writes.push({path:url.pathname,body:JSON.parse(options.body||'{}')});
        if(url.pathname==='/api/wallet'&&method==='GET')return state.fail?reply('Unavailable',503):reply({wallets:state.wallets});
        if(url.pathname==='/api/wallet/challenge')return reply({nonce:'a'.repeat(32),message:'A one-time connection message'});
        if(url.pathname==='/api/wallet/verify'){
          const body=JSON.parse(options.body);state.wallets=[{address:body.address,chainId:body.chainId,label:'',lastUsedAt:new Date().toISOString()}];return reply({alreadyConnected:false});
        }
        if(url.pathname==='/api/wallet'&&method==='POST'){state.wallets=[];return reply({disconnected:true});}
        throw Error('Unexpected wallet endpoint');
      }
      if(method!=='GET')throw Error('Unstubbed mutation blocked');
      return original(input,options);
    };
  })()`;
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:injection},sessionId);
  await cdp.send('Network.setCookie',{name:'qfs_session',value:token,url:base,httpOnly:true,sameSite:'Lax'},sessionId);
  async function go(scenario){await cdp.send('Page.navigate',{url:base+'/user/user/connect?case='+scenario},sessionId);await wait('document.querySelector(".wc-wrap") && window.__walletCheck');await sleep(600);}
  await go('eip');
  await wait('document.querySelectorAll("#wc-provider option").length===2');
  await check('EIP-6963 wallets work without window.ethereum','!window.ethereum && !document.querySelector(".wc-btn-primary").disabled');
  await evaluate(`(()=>{const select=document.querySelector('#wc-provider');select.value='metamask-test';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(250);
  await evaluate(`window.__walletCheck.hold=true;document.querySelector('.wc-btn-primary').click();document.querySelector('.wc-btn-primary').click();`);
  await wait(`window.__walletCheck.calls.some(x=>x.method==='personal_sign')`);
  await check('chosen wallet signs and duplicate clicks are blocked',`window.__walletCheck.calls.filter(x=>x.method==='eth_requestAccounts').length===1 && window.__walletCheck.calls.find(x=>x.method==='personal_sign').name==='MetaMask'`);
  await check('pending connection shows loading state',`document.querySelector('.wc-btn-primary').disabled && !!document.querySelector('.wc-spinner') && document.querySelector('.wc-btn-primary').getAttribute('aria-busy')==='true'`);
  await evaluate('window.__walletCheck.hold=false');
  await wait(`document.querySelector('.wc-status-ok') && document.querySelector('.wc-item')`);
  await check('verified connection is listed',`window.__walletCheck.writes.filter(x=>x.path==='/api/wallet/verify').length===1 && !!document.querySelector('.wc-item')`);
  await evaluate(`document.querySelector('.wc-item button').click()`);
  await wait(`document.querySelector('.wc-empty')`);
  await check('disconnect updates saved wallet list',`document.querySelector('.wc-status-ok').textContent.includes('disconnected')`);
  await go('bnb');await wait(`document.querySelector('#wc-provider')`);
  await evaluate(`document.querySelector('.wc-btn-primary').click()`);await wait(`document.querySelector('.wc-item')`);
  await check('BNB connection keeps the selected network',`window.__walletCheck.writes.find(x=>x.path.endsWith('/verify')).body.chainId===56 && !window.__walletCheck.calls.some(x=>x.method==='wallet_switchEthereumChain') && document.querySelector('.wc-addr').href.startsWith('https://bscscan.com/')`);
  await go('reject');await wait(`document.querySelector('#wc-provider')`);await evaluate(`document.querySelector('.wc-btn-primary').click()`);await wait(`document.querySelector('.wc-status-error')`);
  await check('cancelled signature shows error and allows retry',`!document.querySelector('.wc-btn-primary').disabled && window.__walletCheck.writes.every(x=>!x.path.endsWith('/verify'))`);
  await go('network');await wait(`document.querySelector('#wc-provider')`);await evaluate(`document.querySelector('.wc-btn-primary').click()`);await wait(`document.querySelector('.wc-item')`);
  await check('unsupported network is switched during connect',`window.__walletCheck.calls.some(x=>x.method==='wallet_switchEthereumChain') && window.__walletCheck.writes.find(x=>x.path.endsWith('/verify')).body.chainId===1`);
  await go('late');await wait(`document.querySelector('.wc-note')`);await check('no injected wallet has helpful alternatives',`document.querySelector('.wc-note').textContent.includes('No wallet is available')`);
  await evaluate('window.__walletCheck.announce()');await wait(`document.querySelectorAll('#wc-provider option').length===2`);
  await check('late wallet discovery enables connection',`!document.querySelector('.wc-btn-primary').disabled`);
  await go('legacy');await wait(`document.querySelector('#wc-provider')`);
  await check('legacy injected wallet remains supported',`document.querySelector('#wc-provider').textContent.includes('MetaMask') && !document.querySelector('.wc-btn-primary').disabled`);
  await go('load-error');await wait(`document.querySelector('.wc-list [role=alert]')`);
  await check('wallet list failure offers retry',`document.querySelector('.wc-list button').textContent.includes('Try again') && !document.querySelector('.wc-empty')`);
  await evaluate(`window.__walletCheck.fail=false;document.querySelector('.wc-list button').click()`);await wait(`document.querySelector('.wc-empty')`);
  await go('none');await wait(`document.querySelector('.wc-note')`);await cdp.send('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:true},sessionId);await sleep(300);
  await check('connection page fits a 320px phone','document.documentElement.scrollWidth<=320');
  await check('back link returns to dashboard',`document.querySelector('.wc-back').getAttribute('href')==='/user/user/dashboard'`);
  if(base.startsWith('https:'))await check('wallet app links use this HTTPS origin without session data',`(()=>{const links=[...document.querySelectorAll('.wc-app-links a')];return links.length===2 && links[0].href==='https://metamask.app.link/dapp/'+location.host+'/user/user/connect' && new URL(links[1].href).searchParams.get('url')===location.origin+'/user/user/connect';})()`);
  else await check('local HTTP explains HTTPS requirement',`document.querySelector('.wc-wrap').textContent.includes('Use the HTTPS website address')`);
  mkdirSync('scripts/shots',{recursive:true});
  writeFileSync('scripts/shots/wallet-connection-mobile.png',Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'},sessionId)).data,'base64'));
  assert.deepEqual(errors,[]);console.log(`${passed} wallet browser checks passed`);
} finally {
  if(browser)await browser.close();
  php(`Illuminate\\Support\\Facades\\DB::table('Session')->where('tokenHash',hash('sha256',${JSON.stringify(token)}))->delete();`);
}
process.exit(0);
