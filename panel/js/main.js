'use strict';

const API_BASE      = 'https://footagestore.fraggell.com';
const PANEL_VERSION = '1.8.2';
const PLUGIN_AUTH   = API_BASE;   // auth goes through Cloudflare, works for all editors
const PROXY_BASE    = API_BASE;   // proxies served via /api/assets/{id}/proxy.mp4
const PAGE_LIMIT    = 24;
const PREF_SESSION  = 'fs_session_token';
const PREF_DRIVE    = 'fraggell_footage_drive_path';
const SHARED_HINT   = 'footage store';  // matches the "Fraggell Footage Store" shared drive only (not "Fraggell Storage"/"Fraggell Editors")
const SKIP          = ['.Recycle.Bin','$RECYCLE.BIN','.DS_Store','desktop.ini','System Volume Information'];
const SESSION_COOKIE= '__Secure-authjs.session-token';


const PREF_EMAIL    = 'fraggell_saved_email';
const PREF_PASS     = 'fraggell_saved_pass';

// Escape untrusted values (clip names, filenames, tags, folder names from the
// API/Drive) before putting them in innerHTML. In a CEP panel the page has Node
// integration, so an unescaped "<img onerror=…>" in a filename is RCE, not just
// XSS. Use this at every interpolation of API/Drive data into innerHTML.
function esc(s){
  return String(s==null?'':s).replace(/[&<>"'`]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'}[c];
  });
}

const fs       = window.cep_node ? window.cep_node.require('fs')    : null;
const nodePath = window.cep_node ? window.cep_node.require('path')  : null;
const nodeHttps= window.cep_node ? window.cep_node.require('https') : null;
const nodeHttp = window.cep_node ? window.cep_node.require('http')  : null;
const nodeOs   = window.cep_node ? window.cep_node.require('os')    : null;

// ── Logger — writes to getDataDir()/panel.log (platform.js provides getDataDir) ──
var _logPath = null;
function initLog(){
  if(!fs||!nodePath) return;
  try{
    var dir = getDataDir(); // platform.js: %APPDATA%\FraggellFootagePanel on Win, ~/Library/Logs/... on Mac
    if(!dir) return;
    if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
    _logPath = nodePath.join(dir,'panel.log');
    try{
      var st=fs.statSync(_logPath);
      if(st.size>1024*1024) fs.renameSync(_logPath,_logPath+'.old');
    }catch(e){}
    log('info','Panel loaded v'+PANEL_VERSION+' platform='+(PLATFORM_IS_MAC?'mac':'win'));
  }catch(e){}
}
function log(level, ctx, err){
  if(!_logPath||!fs) return;
  var ts=new Date().toISOString();
  var line=ts+' ['+level.toUpperCase()+'] '+ctx;
  if(err){
    line+=' — '+(err.message||String(err));
    if(err.stack) line+='\n  '+err.stack.split('\n').slice(0,3).join('\n  ');
  }
  try{ fs.appendFileSync(_logPath,line+'\n'); }catch(e){}
}


// ── Premiere theme sync ───────────────────────────────────────────────────────
/**
 * Read Premiere Pro's current appearance colour and update all CSS variables
 * to match. Called on init and whenever the user changes the theme slider.
 *
 * CEP exposes the host app's panel background colour via appSkinInfo.
 * Premiere has a single brightness slider (Preferences > Appearance) that
 * maps to a grey value — we derive every surface/border/text variable from it.
 */
function applyPremiereTheme(){
  try{
    var env = getCS().getHostEnvironment();
    // getHostEnvironment() already returns a parsed object — do NOT JSON.parse it
    var skin = env.appSkinInfo;
    if(!skin||!skin.panelBackgroundColor) return;
    var c = skin.panelBackgroundColor.color;
    var r = Math.round(c.red), g = Math.round(c.green), b = Math.round(c.blue);
    // Perceptual luminance (0–255)
    var lum = r * 0.299 + g * 0.587 + b * 0.114;
    var isDark = lum < 128;

    function clamp(v){ return Math.max(0,Math.min(255,Math.round(v))); }
    function hex(rv,gv,bv){
      return '#'+[rv,gv,bv].map(function(v){
        return clamp(v).toString(16).padStart(2,'0');
      }).join('');
    }
    function rgba(rv,gv,bv,a){ return 'rgba('+clamp(rv)+','+clamp(gv)+','+clamp(bv)+','+a+')'; }

    var root = document.documentElement;
    var d = isDark ? 1 : -1; // direction: add lightness for dark, subtract for light

    // Surfaces — bg is Premiere's exact panel bg, each step is 8px brighter/darker
    root.style.setProperty('--bg',      hex(r,     g,     b));
    root.style.setProperty('--surface', hex(r+d*8, g+d*8, b+d*8));
    root.style.setProperty('--surface2',hex(r+d*16,g+d*16,b+d*16));
    root.style.setProperty('--surface3',hex(r+d*24,g+d*24,b+d*24));
    root.style.setProperty('--surface4',hex(r+d*32,g+d*32,b+d*32));

    // Borders — slightly more contrast than surfaces
    root.style.setProperty('--border',  hex(r+d*12,g+d*12,b+d*12));
    root.style.setProperty('--border2', hex(r+d*28,g+d*28,b+d*28));
    root.style.setProperty('--border3', hex(r+d*46,g+d*46,b+d*46));

    // Text — high contrast against the background
    if(isDark){
      root.style.setProperty('--text',      '#f0f0f0');
      root.style.setProperty('--text-muted','#a0a0a0');
      root.style.setProperty('--text-dim',  '#606060');
      root.style.setProperty('--text-sub',  '#808080');
    } else {
      root.style.setProperty('--text',      '#1a1a1a');
      root.style.setProperty('--text-muted','#4a4a4a');
      root.style.setProperty('--text-dim',  '#7a7a7a');
      root.style.setProperty('--text-sub',  '#606060');
    }

    _lastThemeLum = Math.round(lum);
    log('info','Theme applied: rgb('+r+','+g+','+b+') lum='+Math.round(lum)+' isDark='+isDark);
  }catch(e){
    log('warn','applyPremiereTheme failed',e);
  }
}

let _cs; function getCS(){ if(!_cs) _cs=new CSInterface(); return _cs; }

// ── File-based prefs ──────────────────────────────────────────────────────────
// CSInterface v11 removed getPersistentData/setPersistentData.
// We store prefs as a JSON file in %APPDATA%\FraggellFootagePanel\prefs.json
var _prefsCache = null;
var _lastThemeLum = -1; // track last applied Premiere theme luminance

// ── Auto-update ───────────────────────────────────────────────────────────────
var _updateAvailable = null; // { version, url, notes } or null

/**
 * Check FootageStore for a newer panel version.
 * @param {boolean} userTriggered - if true, shows "Checking..." feedback and
 *   "Up to date" toast when no update is found.
 */
function checkForUpdate(userTriggered){
  if(!nodeHttps){
    if(userTriggered) showToast('Update check unavailable','error');
    return;
  }
  var btn = document.getElementById('check-update-btn');
  if(userTriggered && btn){ btn.textContent = '...'; btn.disabled = true; }

  var req = nodeHttps.request({
    hostname: new URL(API_BASE).hostname, port: 443,
    path: '/panel-version.json', method: 'GET',
    headers: { 'User-Agent': 'FraggellPanel/' + PANEL_VERSION }
  }, function(res){
    var chunks = [];
    res.on('data', function(c){ chunks.push(c); });
    res.on('end', function(){
      if(userTriggered && btn){ btn.textContent = '↑'; btn.disabled = false; }
      try{
        var data = JSON.parse(Buffer.concat(chunks).toString());
        if(data.version && data.version !== PANEL_VERSION){
          _updateAvailable = data;
          showUpdateBadge(data);
          log('info', 'Update available: ' + data.version);
          if(userTriggered) showToast('Update available: v' + data.version + ' — click the badge to install','info');
        } else {
          log('info', 'Panel is up to date (' + PANEL_VERSION + ')');
          if(userTriggered) showToast('Panel is up to date (v' + PANEL_VERSION + ')','success');
        }
      }catch(e){
        log('warn', 'checkForUpdate parse failed', e);
        if(userTriggered) showToast('Update check failed','error');
      }
    });
  });
  req.on('error', function(e){
    if(userTriggered && btn){ btn.textContent = '↑'; btn.disabled = false; }
    log('warn', 'checkForUpdate request failed', e);
    if(userTriggered) showToast('Update check failed: ' + e.message,'error');
  });
  req.end();
}

/** Show or hide the update badge in the header. */
function showUpdateBadge(data){
  var badge = document.getElementById('update-badge');
  if(!badge) return;
  badge.textContent = 'Update available (' + data.version + ')';
  badge.style.display = 'inline-flex';
  badge.title = data.notes || 'A new version is available';
}

/**
 * Download the new version zip, extract it over the current installation,
 * and prompt the editor to restart Premiere.
 *
 * Works by:
 *  1. Downloading panel.zip from FootageStore (authenticated)
 *  2. Writing it to a temp file
 *  3. Using PowerShell (Windows) or unzip (Mac) to extract it
 *  4. The extracted folder overwrites the current extension folder
 *  5. Changes take effect after Premiere is restarted
 */
async function performUpdate(){
  if(!_updateAvailable) return;
  var badge = document.getElementById('update-badge');
  if(badge) badge.textContent = 'Downloading...';

  try{
    // Work out the CEP extensions folder (parent of this extension)
    var isMac = typeof process !== 'undefined' && process.platform === 'darwin';
    var extParent = isMac
      ? nodePath.join(process.env.HOME, 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions')
      : nodePath.join(process.env.APPDATA, 'Adobe', 'CEP', 'extensions');

    var zipPath = nodePath.join(isMac ? '/tmp' : process.env.TEMP, 'fraggell-panel-update.zip');

    // Download zip
    await new Promise(function(resolve, reject){
      var file = fs.createWriteStream(zipPath);
      // Always use the authenticated download endpoint — never the raw manifest URL
    var url = new URL(API_BASE + '/api/panel/download');
      var req = nodeHttps.request({
        hostname: url.hostname, port: 443, path: url.pathname,
        method: 'GET',
        headers: {
          'Cookie': '__Secure-authjs.session-token=' + state.sessionToken,
          'User-Agent': 'FraggellPanel/' + PANEL_VERSION
        }
      }, function(res){
        if(res.statusCode !== 200){ reject(new Error('HTTP ' + res.statusCode)); return; }
        var total = parseInt(res.headers['content-length'] || '0', 10);
        var received = 0;
        res.on('data', function(chunk){
          received += chunk.length;
          file.write(chunk);
          if(total > 0 && badge){
            badge.textContent = 'Downloading... ' + Math.round((received/total)*100) + '%';
          }
        });
        res.on('end', function(){ file.on('finish', resolve); file.on('error', reject); file.end(); });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });

    if(badge) badge.textContent = 'Installing...';

    if(isMac){
      // Mac: validate zip size first, then extract — CEP doesn't lock JS files on Mac
      await new Promise(function(resolve, reject){
        var { execFile } = require('child_process');
        // Remove old folder first for a clean extract
        execFile('bash', ['-c',
          'rm -rf "' + extParent + '/fraggell-footage-panel" && unzip -o "' + zipPath + '" -d "' + extParent + '"'
        ], { timeout: 60000 }, function(err, _, stderr){
          if(err) reject(new Error('Mac extract: ' + stderr.slice(-200)));
          else resolve();
        });
      });
      try{ fs.unlinkSync(zipPath); }catch(e){}

    } else {
      // Windows: CEP locks JS files while Premiere is running.
      // Write a helper bat that waits for Premiere to close (retries folder
      // deletion until it succeeds), then does a clean extract.
      // The bat runs detached so it survives the panel being closed.
      var helperPath = nodePath.join(process.env.TEMP, 'fraggell-apply-update.bat');
      var extFolder  = nodePath.join(extParent, 'fraggell-footage-panel');
      var batLines = [
        '@echo off',
        'set RETRIES=0',
        ':RETRY',
        'if %RETRIES% gtr 60 exit /b 1',
        'rd /s /q "' + extFolder + '" 2>nul',
        'if exist "' + extFolder + '" (',
        '  set /a RETRIES+=1',
        '  timeout /t 2 /nobreak >nul',
        '  goto RETRY',
        ')',
        'powershell -NoProfile -NonInteractive -Command "Expand-Archive -Force -Path \'' + zipPath + '\' -DestinationPath \'' + extParent + '\'"',
        'del /f /q "' + zipPath + '"',
        'del /f /q "%~f0"',
      ].join('\r\n');
      fs.writeFileSync(helperPath, batLines);

      // Launch detached — it runs in the background, survives panel close
      var { spawn } = require('child_process');
      spawn('cmd.exe', ['/c', helperPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      }).unref();
    }

    log('info', 'Updated to ' + _updateAvailable.version + ' — restart required');
    _updateAvailable = null;

    if(badge){
      badge.textContent = 'Updated! Restart Premiere to apply.';
      badge.style.background = 'var(--ok-bg)';
      badge.style.borderColor = 'var(--ok-border)';
      badge.style.color = 'var(--ok-text)';
    }

  }catch(e){
    log('error', 'performUpdate failed', e);
    if(badge){ badge.textContent = 'Update failed — try again'; }
    showToast('Update failed: ' + e.message, 'error');
  }
}
var _prefsFilePath = null;

function _getPrefsFilePath(){
  if(_prefsFilePath) return _prefsFilePath;
  if(!fs||!nodePath) return null;
  try{
    var dir = getDataDir(); // platform.js
    if(!dir) return null;
    if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
    _prefsFilePath = nodePath.join(dir,'prefs.json');
    return _prefsFilePath;
  }catch(e){ return null; }
}
function _loadPrefs(){
  if(_prefsCache) return _prefsCache;
  var p=_getPrefsFilePath();
  if(!p){ _prefsCache={}; return _prefsCache; }
  try{
    _prefsCache = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p,'utf8')) : {};
  }catch(e){ _prefsCache={}; }
  return _prefsCache;
}
function _savePrefs(){
  var p=_getPrefsFilePath(); if(!p) return;
  try{ fs.writeFileSync(p, JSON.stringify(_prefsCache||{})); }catch(e){}
}
function getPref(k){ var v=_loadPrefs()[k]; return v!==undefined?v:null; }
function setPref(k,v){ _loadPrefs()[k]=v; _savePrefs(); }
function delPref(k){ delete _loadPrefs()[k]; _savePrefs(); }

var state = {
  sessionToken:null, footageRoot:null,
  clients:[], activeClient:null,
  clips:[], totalClips:0, currentPage:1, totalPages:1,
  selected:new Set(), modalClip:null,
  searchQuery:'', filterShotType:null, filterTags:new Set(), filterSkus:new Set(),
  filterMonths:new Set(), filterAngles:new Set(),
  gridSize:'md', projectName:'No project open',
  vttCache:new Map(), spriteCache:new Map(),
  thumbCache:new Map(),
  pathCache:new Map(),
  downloading:new Set()
};

// ── Drive detection ───────────────────────────────────────────────────────────

// findMounts() is provided by js/platform.js — cross-platform implementation
// for both Windows (A-Z drive scan) and Mac (/Volumes + CloudStorage)
/** Find the Fraggell footage root by matching SHARED_HINT and checking for Footage Storage subfolder. */
function autoDetectDrive(){
  var mounts=findMounts();
  for(var m=0;m<mounts.length;m++){
    for(var d=0;d<mounts[m].drives.length;d++){
      if(mounts[m].drives[d].name.toLowerCase().includes(SHARED_HINT)){
        var root=mounts[m].drives[d].fullPath;
        // Find the "Footage Storage" subfolder — FootageStore syncs from there.
        // Accept a numbered suffix ("Footage Storage 2", "Footage Storage 3", …) and
        // prefer the highest-numbered, since the live folder can be rolled over.
        try{
          var fsKids=fs.readdirSync(root).filter(function(n){return /^footage storage/i.test(n);})
            .sort(function(a,b){return b.localeCompare(a,undefined,{numeric:true});});
          for(var s=0;s<fsKids.length;s++){
            var candidate=nodePath.join(root,fsKids[s]);
            try{ if(fs.statSync(candidate).isDirectory()) return candidate; }catch(e){}
          }
        }catch(e){}
        return root; // Fallback to drive root if no subfolder found
      }
    }
  }
  return null;
}
/** Load footageRoot from saved pref, auto-detect, or single-mount fallback. Returns true if set. */
function connectDrive(){
  var saved=getPref(PREF_DRIVE);
  if(saved){ try{if(fs.statSync(saved).isDirectory()){state.footageRoot=saved;return true;}}catch(err){} }
  var auto=autoDetectDrive(); if(auto){setPref(PREF_DRIVE,auto);state.footageRoot=auto;return true;}
  var all=findMounts().reduce(function(a,m){return a.concat(m.drives);},[]);
  if(all.length===1){setPref(PREF_DRIVE,all[0].fullPath);state.footageRoot=all[0].fullPath;return true;}
  return false;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function nodeRequest(urlStr, opts){
  return new Promise(function(resolve,reject){
    var u=new URL(urlStr);
    var isHttp=u.protocol==='http:';
    var lib=isHttp?nodeHttp:nodeHttps;
    var req=lib.request({hostname:u.hostname,port:u.port?parseInt(u.port):(isHttp?80:443),path:u.pathname+(u.search||''),method:opts.method||'GET',headers:opts.headers||{}},function(res){
      var chunks=[];
      res.on('data',function(c){chunks.push(c);});
      res.on('end',function(){
        var buf=Buffer.concat(chunks);
        resolve({status:res.statusCode,headers:res.headers,ok:res.statusCode>=200&&res.statusCode<300,
          text:function(){return Promise.resolve(buf.toString());},
          json:function(){try{return Promise.resolve(JSON.parse(buf.toString()));}catch(e){return Promise.reject(e);}},
          buffer:function(){return Promise.resolve(buf);}
        });
      });
    });
    req.on('error',reject);
    if(opts.body) req.write(opts.body);
    req.end();
  });
}
function doReq(path, opts){
  var h=Object.assign({'Content-Type':'application/json','User-Agent':'FraggellPanel/1.0'},(opts&&opts.headers)||{});
  if(state.sessionToken) h['Cookie']=SESSION_COOKIE+'='+state.sessionToken;
  return nodeRequest(API_BASE+path,Object.assign({},opts||{},{headers:h}));
}
async function apiFetch(path,opts){
  if(nodeHttps) return doReq(path,opts);
  var h={'Content-Type':'application/json'};
  if(state.sessionToken) h['Cookie']=SESSION_COOKIE+'='+state.sessionToken;
  return fetch(API_BASE+path,Object.assign({},opts||{},{headers:Object.assign(h,(opts&&opts.headers)||{}),credentials:'include'}));
}
async function apiJSON(path,opts){
  var r=await apiFetch(path,opts);
  if(r.status===401){ sessionExpired(); throw new Error('Session expired'); }
  if(!r.ok){ var e=await r.json().catch(function(){return{error:'HTTP '+r.status};}); throw new Error(e.error||'HTTP '+r.status); }
  return r.json();
}

// ── Session expiry ────────────────────────────────────────────────────────────
function sessionExpired(){
  if(!state.sessionToken) return; // already handled
  log('warn','Session expired — showing re-auth banner');
  state.sessionToken=null; delPref(PREF_SESSION);
  var banner=document.getElementById('session-expired-banner');
  if(banner) banner.classList.add('visible');
}
function hideSessionBanner(){
  var banner=document.getElementById('session-expired-banner');
  if(banner) banner.classList.remove('visible');
}

// ── Thumbnail loading — 3 concurrent, spinner until loaded ───────────────────
var thumbQueue=[];
var thumbActive=0;
var THUMB_CONCURRENCY=3;

// ── Drag to timeline state ────────────────────────────────────────────────────
var _dragState = {
  active: false,
  clip: null,
  card: null,
  startX: 0,
  startY: 0,
  threshold: 6  // pixels of movement before drag begins
};

// ── Persistent thumbnail disk cache ───────────────────────────────────────────
// Thumbnails are immutable (write-once per clip id), but CEP requests go through
// Node's https which ignores the browser HTTP cache, so without this the panel
// re-downloads every thumbnail each time it opens. Cache them to disk (LRU,
// capped at 100MB) so re-opens are fast. All ops are best-effort — a disk error
// never breaks thumbnail loading.
var THUMB_DISK_CACHE_MAX = 100 * 1024 * 1024; // 100MB (~350 thumbnails)
var _thumbCacheDir = null;   // null = not yet resolved, '' = unavailable
var _thumbWrites   = 0;
function thumbCacheDir(){
  if(_thumbCacheDir !== null) return _thumbCacheDir;
  _thumbCacheDir = '';
  try{
    if(fs && nodePath && nodeOs){
      var dir = nodePath.join(nodeOs.homedir(), '.fraggell-panel', 'thumbs');
      fs.mkdirSync(dir, { recursive:true });
      _thumbCacheDir = dir;
    }
  }catch(e){}
  return _thumbCacheDir;
}
function readDiskThumb(clipId){
  try{
    var dir = thumbCacheDir(); if(!dir) return null;
    var f = nodePath.join(dir, clipId + '.jpg');
    var buf = fs.readFileSync(f);                 // throws if missing
    try{ var now = new Date(); fs.utimesSync(f, now, now); }catch(e){} // touch → LRU
    return 'data:image/jpeg;base64,' + buf.toString('base64');
  }catch(e){ return null; }
}
function writeDiskThumb(clipId, buf){
  try{
    var dir = thumbCacheDir(); if(!dir || !buf) return;
    fs.writeFileSync(nodePath.join(dir, clipId + '.jpg'), buf);
    if(++_thumbWrites % 25 === 0) enforceThumbCacheCap(); // amortise the scan
  }catch(e){}
}
/** Evict least-recently-used thumbnails until under the cap (with hysteresis). */
function enforceThumbCacheCap(){
  try{
    var dir = thumbCacheDir(); if(!dir) return;
    var files = fs.readdirSync(dir).filter(function(n){ return /\.jpg$/i.test(n); }).map(function(n){
      var p = nodePath.join(dir, n); var st = fs.statSync(p);
      return { p:p, size:st.size, mtime:st.mtimeMs };
    });
    var total = files.reduce(function(s,f){ return s + f.size; }, 0);
    if(total <= THUMB_DISK_CACHE_MAX) return;
    files.sort(function(a,b){ return a.mtime - b.mtime; }); // oldest first
    var target = THUMB_DISK_CACHE_MAX * 0.9;                // evict down to 90%
    for(var i=0; i<files.length && total>target; i++){
      try{ fs.unlinkSync(files[i].p); total -= files[i].size; }catch(e){}
    }
  }catch(e){}
}

/** Queue a thumbnail load for a clip. Uses cached value if available. */
function loadThumb(clipId){
  if(state.thumbCache.has(clipId)){ applyThumb(clipId,state.thumbCache.get(clipId)); return; }
  if(!thumbQueue.includes(clipId)) thumbQueue.push(clipId);
  drainThumbQueue();
}
/** Apply a loaded thumbnail data URL to all cards showing a given clip. */
function applyThumb(clipId,dataUrl){
  document.querySelectorAll('.clip-card[data-id="'+clipId+'"]').forEach(function(card){
    var img=card.querySelector('.clip-thumb-img');
    if(dataUrl&&img){ img.src=dataUrl; img.classList.add('loaded'); }
    card.classList.add(dataUrl?'clip-card--thumb-loaded':'clip-card--thumb-failed');
  });
}
function drainThumbQueue(){
  while(thumbActive<THUMB_CONCURRENCY&&thumbQueue.length){
    var clipId=thumbQueue.shift();
    if(state.thumbCache.has(clipId)){ applyThumb(clipId,state.thumbCache.get(clipId)); continue; }
    // Disk cache hit — serve locally, no network slot needed.
    var diskUrl=readDiskThumb(clipId);
    if(diskUrl){ state.thumbCache.set(clipId,diskUrl); applyThumb(clipId,diskUrl); continue; }
    thumbActive++;
    (function(id){
      doReq('/api/assets/'+id+'/thumbnail.jpg',{method:'GET',headers:{'Accept':'image/jpeg,image/*'}})
        .then(function(r){return r.ok?r.buffer():Promise.resolve(null);})
        .then(function(buf){
          if(buf) writeDiskThumb(id,buf);   // persist the raw JPEG for next time
          var url=buf?'data:image/jpeg;base64,'+buf.toString('base64'):null;
          state.thumbCache.set(id,url); applyThumb(id,url);
        })
        .catch(function(){state.thumbCache.set(id,null);applyThumb(id,null);})
        .finally(function(){thumbActive--;drainThumbQueue();});
    })(clipId);
  }
}

// IntersectionObserver for lazy thumbnail loading
var io;
/** Initialise the IntersectionObserver for lazy thumbnail loading. */
function initIO(){
  if(io) io.disconnect();
  io=new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(!e.isIntersecting) return;
      var card=e.target;
      var id=card.dataset.id;
      if(!id||state.thumbCache.has(id)) return;
      io.unobserve(card);
      loadThumb(id);
    });
  },{rootMargin:'200px'});
}

// ── Auth ──────────────────────────────────────────────────────────────────────
/** Authenticate against FootageStore and save the session token. Throws on failure. */
async function login(email,password){
  if(!nodeHttp) throw new Error('Node.js not available');
  var body=JSON.stringify({email:email,password:password,pluginKey:'fraggell-premiere-plugin-2026'});
  var resp=await nodeRequest(PLUGIN_AUTH+'/api/auth/plugin',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(body))},body:body});
  var data=await resp.json();
  if(!resp.ok) throw new Error(data.error||'Login failed');
  if(!data.sessionToken) throw new Error('No session token returned');
  state.sessionToken=data.sessionToken; setPref(PREF_SESSION,data.sessionToken);
  var rem=document.getElementById('remember-me');
  if(rem&&rem.checked){ setPref(PREF_EMAIL,email); setPref(PREF_PASS,password); }
  else { delPref(PREF_EMAIL); delPref(PREF_PASS); }
  return true;
}
/** Check if a saved session token is still valid. Clears and returns false if not. */
async function checkExistingSession(){
  var token=getPref(PREF_SESSION); if(!token) return false;
  state.sessionToken=token;
  try{ var r=await apiFetch('/api/clients'); if(r.ok) return true; }catch(err){}
  state.sessionToken=null; delPref(PREF_SESSION); log('info','Session token invalid, cleared'); return false;
}
/** Clear auth state and return to the login screen. */
function logout(){
  delPref(PREF_SESSION); state.sessionToken=null; state.clients=[]; state.activeClient=null;
  state.clips=[]; state.selected.clear(); showScreen('login');
}

// ── Data ──────────────────────────────────────────────────────────────────────
/** Fetch all clients from the API and render the sidebar list. */
async function loadClients(){ var data=await apiJSON('/api/clients'); state.clients=data; renderClientList(); }
/** Fetch a page of clips for a client. Appends to state.clips if append=true. */
async function loadClips(clientId,page,append){
  var params=new URLSearchParams({clientId:clientId,page:page||1,limit:PAGE_LIMIT});
  if(state.searchQuery) params.set('search',state.searchQuery);
  if(state.filterShotType) params.set('shotType',state.filterShotType);
  var data=await apiJSON('/api/clips?'+params.toString());
  state.clips=append?state.clips.concat(data.clips):data.clips;
  state.totalClips=data.pagination.total; state.currentPage=data.pagination.page; state.totalPages=data.pagination.totalPages;
  renderClipGrid(); updateCountBadge(); updateLoadMore();
}
/** Return clips filtered by active tag and SKU selections (client-side only). */
function getVisible(){
  return state.clips.filter(function(c){
    if(state.filterTags.size){
      var t=Array.isArray(c.tags)?c.tags:(typeof c.tags==='string'&&c.tags?JSON.parse(c.tags):[]);
      if(!Array.from(state.filterTags).every(function(f){return t.includes(f);})) return false;
    }
    if(state.filterSkus.size){
      var s=Array.isArray(c.productSkus)?c.productSkus:(typeof c.productSkus==='string'&&c.productSkus?JSON.parse(c.productSkus):[]);
      if(!Array.from(state.filterSkus).every(function(f){return s.includes(f);})) return false;
    }
    if(state.filterMonths.size && !state.filterMonths.has(c.month)) return false;
    if(state.filterAngles.size && !state.filterAngles.has(c.angle)) return false;
    return true;
  });
}

// ── Screens ───────────────────────────────────────────────────────────────────
/** Switch to a named screen by ID (login/connecting/panel/not-connected/drive-picker). */
function showScreen(n){
  document.querySelectorAll('.screen').forEach(function(s){s.classList.remove('screen--active');});
  var el=document.getElementById('screen-'+n); if(el) el.classList.add('screen--active');
}
/** Initialise the panel on load: restore credentials, check session, detect drive. */
async function init(){
  // Pre-fill login credentials if remembered
  var savedEmail=getPref(PREF_EMAIL), savedPass=getPref(PREF_PASS);
  if(savedEmail){ var e=document.getElementById('login-email'); if(e) e.value=savedEmail; }
  if(savedPass){  var p=document.getElementById('login-password'); if(p) p.value=savedPass; }
  if(savedEmail&&savedPass){ var r=document.getElementById('remember-me'); if(r) r.checked=true; }
  applyPremiereTheme();
  try{ enforceThumbCacheCap(); }catch(e){} // trim the thumbnail disk cache on startup
  initLog(); showScreen('connecting'); document.getElementById('connecting-msg').textContent='Checking session...';
  var ok=false; try{ok=await checkExistingSession();}catch(err){log('error','checkExistingSession threw',err);}
  if(!ok){showScreen('login');return;}
  document.getElementById('connecting-msg').textContent='Checking Google Drive...';
  var hasDrive=connectDrive();
  if(!hasDrive){
    var mounts=findMounts(), all=mounts.reduce(function(a,m){return a.concat(m.drives);},[]);
    if(all.length>1){showDrivePicker(all);return;}
    showNotConnected(mounts.length>0?'Google Drive is running but no Shared Drives are visible.':'Google Drive Desktop does not appear to be running.');
    return;
  }
  await startPanel();
}
/** Transition to the main panel: load clients and start the project-name poll. */
async function startPanel(){
  hideSessionBanner(); initIO(); showScreen('panel');
  try{await loadClients();}catch(err){log('error','loadClients failed',err);showToast('Failed to load clients: '+err.message,'error');}
  updateProjectName(); setInterval(updateProjectName,5000);
  checkForUpdate();
  // Poll Premiere's theme every 1s and re-apply only if it changed.
  // The ThemeColorChanged CEP event is unreliable for Premiere's discrete
  // Darkest/Dark/Light selector, so polling is the only robust approach.
  setInterval(function(){
    try{
      var env = getCS().getHostEnvironment();
      var skin = env && env.appSkinInfo;
      if(!skin||!skin.panelBackgroundColor) return;
      var c = skin.panelBackgroundColor.color;
      var lum = Math.round(c.red * 0.299 + c.green * 0.587 + c.blue * 0.114);
      if(lum !== _lastThemeLum) applyPremiereTheme();
    }catch(e){}
  }, 1000);
}
/** Show the "not connected" error screen with a descriptive message. */
function showNotConnected(m){document.getElementById('not-connected-msg').textContent=m;showScreen('not-connected');}
/** Show the drive picker screen so the editor can choose a Shared Drive manually. */
function showDrivePicker(drives){
  var list=document.getElementById('drive-picker-list'); list.innerHTML='';
  drives.forEach(function(d){
    var b=document.createElement('button'); b.className='drive-pick-btn';
    b.innerHTML='<span class="drive-pick-icon">&#9654;</span><div class="drive-pick-body"><span class="drive-pick-name">'+esc(d.name)+'</span><span class="drive-pick-path">'+esc(d.fullPath)+'</span></div>';
    b.addEventListener('click',function(){
      // Check for Footage Storage subfolder just like autoDetectDrive does
      var chosenRoot=d.fullPath;
      var subCandidates=['Footage Storage','footage storage','footage','Footage'];
      for(var sc=0;sc<subCandidates.length;sc++){
        var subPath=nodePath.join(chosenRoot,subCandidates[sc]);
        try{ if(fs.statSync(subPath).isDirectory()){chosenRoot=subPath;break;} }catch(e){}
      }
      setPref(PREF_DRIVE,chosenRoot);state.footageRoot=chosenRoot;startPanel();
    });
    list.appendChild(b);
  });
  showScreen('drive-picker');
}

// ── Client list ───────────────────────────────────────────────────────────────
var AVATAR_COLORS=['#6366f1','#8b5cf6','#ec4899','#14b8a6','#f59e0b','#3b82f6','#10b981','#f43f5e'];
/** Return a deterministic avatar background colour based on the first character of a name. */
function avatarColor(n){return AVATAR_COLORS[(n.charCodeAt(0)||0)%AVATAR_COLORS.length];}
/** Render the client list in the sidebar from state.clients. */
function renderClientList(){
  var el=document.getElementById('client-list'); el.innerHTML='';
  if(!state.clients.length){el.innerHTML='<div style="padding:16px 8px;font-size:11px;color:var(--text-dim);text-align:center">No clients found</div>';return;}
  state.clients.forEach(function(c){
    var btn=document.createElement('button');
    btn.className='client-item'+(state.activeClient&&state.activeClient.id===c.id?' client-item--active':'');
    var col=avatarColor(c.name);
    btn.innerHTML='<div class="client-avatar" style="background:'+col+'22;color:'+col+'">'+esc(c.name[0].toUpperCase())+'</div><span class="client-name">'+esc(c.name)+'</span><span class="client-count">'+esc(c.clipCount)+'</span>';
    btn.addEventListener('click',function(){selectClient(c);});
    el.appendChild(btn);
  });
}
/** Switch the active client: reset state, update sidebar highlight, load first page. */
async function selectClient(client){
  if(state.activeClient&&state.activeClient.id===client.id) return;
  state.activeClient=client; state.clips=[]; state.selected.clear();
  state.searchQuery=''; state.currentPage=1; state.filterShotType=null; state.filterTags.clear(); state.filterSkus.clear();
  state.filterMonths.clear(); state.filterAngles.clear();
  var inp=document.getElementById('search-input'); if(inp) inp.value='';
  document.getElementById('content-title').textContent=client.name;
  document.getElementById('fb-shottype-label').textContent='Shot Type';
  document.getElementById('fb-tags-label').textContent='Tags';
  document.getElementById('fb-skus-label').textContent='SKU';
  document.getElementById('fb-month-label').textContent='Month';
  document.getElementById('fb-angle-label').textContent='Angle';
  document.getElementById('fb-shottype').classList.remove('active');
  document.getElementById('fb-tags').classList.remove('active');
  document.getElementById('fb-skus').classList.remove('active');
  document.getElementById('fb-month').classList.remove('active');
  document.getElementById('fb-angle').classList.remove('active');
  document.getElementById('active-filters').innerHTML='';
  document.querySelectorAll('.client-item').forEach(function(el2){el2.classList.toggle('client-item--active',el2.querySelector('.client-name').textContent===client.name);});
  document.getElementById('clip-count-badge').textContent='Loading...';
  document.getElementById('clip-grid').innerHTML='<div class="empty-state"><div class="spinner"></div><p>Loading clips...</p></div>';
  document.getElementById('load-more-row').classList.remove('visible');
  updateBottomBar();
  try{
    await loadClips(client.id,1,false);buildFilterMenus();
  }
  catch(err){document.getElementById('clip-grid').innerHTML='<div class="empty-state"><p>'+err.message+'</p></div>';}
}

// ── Clip grid ─────────────────────────────────────────────────────────────────
/** Re-render the clip grid from state.clips (filtered by getVisible()). */
function renderClipGrid(){
  var grid=document.getElementById('clip-grid'); if(!grid) return;
  var visible=getVisible(); grid.innerHTML='';
  if(!state.activeClient){grid.innerHTML='<div class="empty-state"><p>Select a client</p></div>';return;}
  if(!visible.length){grid.innerHTML='<div class="empty-state"><p>No clips match your filters</p></div>';return;}
  var frag=document.createDocumentFragment();
  visible.forEach(function(clip){
    var sel=state.selected.has(clip.id);
    var card=document.createElement('div');
    card.className='clip-card'+(sel?' clip-card--selected':'');
    card.dataset.id=clip.id;
    var dur=clip.duration?fmtDur(clip.duration):'';
    var name=clip.name||clip.originalFilename||'';
    var cached=state.thumbCache.get(clip.id);
    if(cached) card.classList.add('clip-card--thumb-loaded');
    card.innerHTML=
      '<div class="clip-thumb-wrap">'+
        (cached?'':'<div class="clip-thumb-skeleton"></div><div class="clip-thumb-loader"><div class="spinner"></div></div>')+
        '<div class="clip-scrub-layer" style="display:none"></div>'+
        '<img class="clip-thumb-img'+(cached?' loaded':'')+'" data-id="'+esc(clip.id)+'" src="'+esc(cached||'')+'" draggable="false">'+
        (dur?'<div class="clip-duration">'+esc(dur)+'</div>':'')+
        '<div class="clip-sel-check">&#10003;</div>'+
      '</div>'+
      '<div class="clip-card-info">'+
        (clip.code?'<div class="clip-code-badge">'+esc(clip.code)+'</div>':'')+
        '<div class="clip-name" title="'+esc(name)+'">'+esc(name)+'</div>'+
        '<div class="clip-sub"><span>'+esc(clip.shotType||'')+'</span><span>'+esc(fmtSize(clip.fileSize||0))+'</span></div>'+
      '</div>';
    card.addEventListener('mousedown', function(e){ onCardMouseDown(card,clip,e); });
    card.addEventListener('mousemove', function(e){ onCardMouseMove(card,clip,e); updateScrub(card,clip,e); });
    card.addEventListener('mouseup',   function(){ onCardMouseUp(card); });
    card.addEventListener('mouseleave',function(){ onCardMouseUp(card); endScrub(card,clip); });
    card.addEventListener('mouseenter',function(){ startScrub(card,clip); });
    card.addEventListener('click',     function(e){ handleClipClick(clip,e); });
    frag.appendChild(card);
    if(!cached&&io) io.observe(card);
  });
  grid.appendChild(frag);
}
/** Update the clip count badge in the breadcrumb. */
function updateCountBadge(){
  var el=document.getElementById('clip-count-badge'); if(!el) return;
  el.textContent='('+((state.filterTags.size||state.filterSkus.size)?getVisible().length+' of ':'')+state.totalClips+' clips)';
}
/** Show/hide the "load more" button based on pagination state. */
function updateLoadMore(){
  var row=document.getElementById('load-more-row'); if(!row) return;
  row.classList.toggle('visible',state.currentPage<state.totalPages&&!state.filterTags.size&&!state.filterSkus.size);
}

// ── Hover scrub ───────────────────────────────────────────────────────────────
// parseVTT, vttSec, getNumCols — defined in js/utils.js
async function ensureVTT(clip){
  if(state.vttCache.has(clip.id)) return state.vttCache.get(clip.id);
  try{
    var r=await doReq('/api/assets/'+clip.id+'/sprite.vtt',{method:'GET',headers:{'Accept':'text/vtt,text/*'}});
    if(!r.ok) return null;
    var cues=parseVTT(await r.text()); state.vttCache.set(clip.id,cues); return cues;
  }catch(err){log('warn','ensureVTT failed for clip',err);return null;}
}
async function ensureSprite(clip){
  if(state.spriteCache.has(clip.id)) return state.spriteCache.get(clip.id);
  try{
    var r=await new Promise(function(res,rej){
      var req=nodeHttps.request({hostname:new URL(API_BASE).hostname,port:443,path:'/api/assets/'+clip.id+'/sprite.jpg',method:'GET',
        headers:{'Cookie':SESSION_COOKIE+'='+state.sessionToken,'User-Agent':'FraggellPanel/1.0'}},
        function(r2){var c=[];r2.on('data',function(d){c.push(d);});r2.on('end',function(){res(Buffer.concat(c));});});
      req.on('error',rej);req.end();
    });
    var url='data:image/jpeg;base64,'+r.toString('base64');
    state.spriteCache.set(clip.id,url); return url;
  }catch(err){log('warn','ensureSprite failed for clip',err);return null;}
}
/** Pre-fetch VTT and sprite for a clip card so scrub is instant on hover. */
function startScrub(card,clip){ensureVTT(clip);ensureSprite(clip);}
function updateScrub(card,clip,e){
  var cues=state.vttCache.get(clip.id), spriteUrl=state.spriteCache.get(clip.id);
  if(!cues||!spriteUrl) return;
  var layer=card.querySelector('.clip-scrub-layer'), wrap=card.querySelector('.clip-thumb-wrap');
  if(!layer||!wrap) return;
  var rect=wrap.getBoundingClientRect();
  var pct=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
  var cue=cues.find(function(c){return pct*(clip.duration||1)>=c.start&&pct*(clip.duration||1)<c.end;})||cues[cues.length-1];
  if(!cue) return;
  var scale=rect.width/cue.w;
  var numCols=getNumCols(cues), numRows=Math.ceil(cues.length/numCols);
  layer.style.display='block';
  layer.style.backgroundImage='url('+spriteUrl+')';
  layer.style.backgroundSize=(cue.w*numCols*scale)+'px '+(cue.h*numRows*scale)+'px';
  layer.style.backgroundPosition=(-cue.x*scale)+'px '+(-cue.y*scale)+'px';
  var db=card.querySelector('.clip-duration');
  if(db) db.textContent=fmtDur(pct*(clip.duration||1))+(clip.duration?' / '+fmtDur(clip.duration):'');
}
/** Reset the scrub layer and restore the static duration badge on mouse leave. */
function endScrub(card,clip){
  var layer=card.querySelector('.clip-scrub-layer');if(layer)layer.style.display='none';
  var db=card.querySelector('.clip-duration');if(db&&clip&&clip.duration)db.textContent=fmtDur(clip.duration);
}

// ── Drag to timeline ──────────────────────────────────────────────────────────

/**
 * Begin tracking a potential drag from a clip card.
 * Called on mousedown — we don't start the OS drag immediately because
 * a short press is a click (select/open modal), not a drag.
 */
function onCardMouseDown(card, clip, e){
  // Only respond to left-button
  if(e.button !== 0) return;
  _dragState.active = false;
  _dragState.clip = clip;
  _dragState.card = card;
  _dragState.startX = e.clientX;
  _dragState.startY = e.clientY;
  card.classList.add('clip-card--drag-ready');
}

/**
 * Once the mouse has moved past the threshold, resolve the clip's local path
 * and hand a native OS drag to Premiere via window.__adobe_cep__.startDraging().
 * Premiere treats this identically to dragging a file from Explorer/Finder.
 */
function onCardMouseMove(card, clip, e){
  if(!_dragState.clip || _dragState.clip.id !== clip.id) return;
  if(_dragState.active) return;

  var dx = e.clientX - _dragState.startX;
  var dy = e.clientY - _dragState.startY;
  if(Math.sqrt(dx*dx + dy*dy) < _dragState.threshold) return;

  // Threshold crossed — resolve the file path before starting OS drag
  var filePath = null;
  var cached = state.pathCache.get(clip.originalFilename||'');
  if(cached){
    filePath = cached;
  } else if(fs && nodePath && state.footageRoot && (clip.originalFilename||'')){
    filePath = resolveClipPath(state.footageRoot, state.activeClient ? state.activeClient.name : '', clip, fs, nodePath);
    if(filePath) state.pathCache.set(clip.originalFilename, filePath);
  }

  if(!filePath){
    showToast('File not found on Shared Drive', 'error');
    onCardMouseUp(card);
    return;
  }

  _dragState.active = true;
  card.classList.remove('clip-card--drag-ready');
  card.classList.add('clip-card--dragging');

  // Convert Windows backslash path to file:// URI
  var fileUri = 'file:///' + filePath.replace(/\\/g, '/');

  try{
    // window.__adobe_cep__.startDraging hands a native OS drag to the host app.
    // Premiere Pro intercepts this and imports the file onto the timeline
    // at the playhead position, exactly like dragging from Explorer/Finder.
    window.__adobe_cep__.startDraging(
      0,          // mimeData type (0 = no special MIME)
      0,          // dragType (0 = normal)
      0,          // dragKey
      fileUri,    // the file to drag
      e.clientX,
      e.clientY,
      null
    );
    log('info', 'Drag started for: ' + (clip.originalFilename||''));
  }catch(err){
    log('warn', 'startDraging failed', err);
    showToast('Drag not supported in this version of Premiere', 'error');
  }

  onCardMouseUp(card);
}

/** Clean up drag state when mouse is released. */
function onCardMouseUp(card){
  if(card){
    card.classList.remove('clip-card--drag-ready');
    card.classList.remove('clip-card--dragging');
  }
  _dragState.clip = null;
  _dragState.card = null;
  _dragState.active = false;
}

// ── Click handler ─────────────────────────────────────────────────────────────
/**
 * Handle click on a clip card.
 * Ctrl/Cmd+click toggles selection; Shift+click extends range; plain click opens the modal.
 */
function handleClipClick(clip, e){
  // Ctrl/Cmd+click: toggle single clip in/out of selection
  if(e.ctrlKey || e.metaKey){
    state.selected.has(clip.id) ? state.selected.delete(clip.id) : state.selected.add(clip.id);
    renderClipGrid(); updateBottomBar(); return;
  }
  // Shift+click: extend selection from last selected item to clicked item
  if(e.shiftKey){
    var ids = getVisible().map(function(c){ return c.id; });
    var last = ids.findIndex(function(id){ return state.selected.has(id); });
    var to = ids.indexOf(clip.id);
    if(last >= 0){
      for(var i = Math.min(last, to); i <= Math.max(last, to); i++) state.selected.add(ids[i]);
    } else {
      state.selected.add(clip.id);
    }
    renderClipGrid(); updateBottomBar(); return;
  }
  // Plain click: select and open detail modal
  if(!state.selected.has(clip.id)){ state.selected.clear(); state.selected.add(clip.id); }
  openModal(clip); renderClipGrid(); updateBottomBar();
}
/** Update the bottom bar selection count label and button disabled states. */
function updateBottomBar(){
  var n=state.selected.size;
  document.getElementById('bottom-label').textContent=n>0?n+' clip'+(n!==1?'s':'')+' selected':'No clips selected';
  document.getElementById('clear-btn').disabled=n===0;
  document.getElementById('import-btn').disabled=n===0;
  var dl=document.getElementById('download-btn'); if(dl) dl.disabled=n===0;
}

// ── Filters ───────────────────────────────────────────────────────────────────
/** Apply a shot type filter selection: toggle, reload clips, update UI. */
function onShotTypeSelect(v){
  state.filterShotType = (v === state.filterShotType) ? null : v;
  document.getElementById('fb-shottype-label').textContent = state.filterShotType || 'Shot Type';
  document.getElementById('fb-shottype').classList.toggle('active', !!state.filterShotType);
  state.clips = [];
  loadClips(state.activeClient.id, 1, false).then(function(){ buildFilterMenus(); });
  updateActiveTags();
  closeMenus();
}

/** Toggle a tag filter on/off and refresh the visible clips. */
function onTagSelect(v){
  state.filterTags.has(v) ? state.filterTags.delete(v) : state.filterTags.add(v);
  document.getElementById('fb-tags-label').textContent = state.filterTags.size ? state.filterTags.size + ' tags' : 'Tags';
  document.getElementById('fb-tags').classList.toggle('active', state.filterTags.size > 0);
  renderClipGrid(); updateCountBadge(); updateLoadMore(); updateActiveTags(); buildFilterMenus();
  closeMenus();
}

/** Toggle a SKU filter on/off and refresh the visible clips. */
function onSkuSelect(v){
  state.filterSkus.has(v) ? state.filterSkus.delete(v) : state.filterSkus.add(v);
  document.getElementById('fb-skus-label').textContent = state.filterSkus.size ? state.filterSkus.size + ' SKUs' : 'SKU';
  document.getElementById('fb-skus').classList.toggle('active', state.filterSkus.size > 0);
  renderClipGrid(); updateCountBadge(); updateLoadMore(); updateActiveTags(); buildFilterMenus();
  closeMenus();
}

/** Toggle a month filter on/off (client-side) and refresh the visible clips. */
function onMonthSelect(v){
  state.filterMonths.has(v) ? state.filterMonths.delete(v) : state.filterMonths.add(v);
  document.getElementById('fb-month-label').textContent = state.filterMonths.size ? state.filterMonths.size + ' months' : 'Month';
  document.getElementById('fb-month').classList.toggle('active', state.filterMonths.size > 0);
  renderClipGrid(); updateCountBadge(); updateLoadMore(); buildFilterMenus();
  closeMenus();
}

/** Toggle an angle filter on/off (client-side) and refresh the visible clips. */
function onAngleSelect(v){
  state.filterAngles.has(v) ? state.filterAngles.delete(v) : state.filterAngles.add(v);
  document.getElementById('fb-angle-label').textContent = state.filterAngles.size ? state.filterAngles.size + ' angles' : 'Angle';
  document.getElementById('fb-angle').classList.toggle('active', state.filterAngles.size > 0);
  renderClipGrid(); updateCountBadge(); updateLoadMore(); buildFilterMenus();
  closeMenus();
}

/** Rebuild Shot Type, Tags, SKU, Month and Angle filter menus from state.clips. */
function buildFilterMenus(){
  var shots = [...new Set(state.clips.map(function(c){ return c.shotType; }).filter(Boolean))].sort();
  var allTags = [...new Set(state.clips.flatMap(function(c){
    var t = c.tags;
    return Array.isArray(t) ? t : (typeof t === 'string' && t ? JSON.parse(t) : []);
  }))].sort();
  var allSkus = [...new Set(state.clips.flatMap(function(c){
    var s = c.productSkus;
    return Array.isArray(s) ? s : (typeof s === 'string' && s ? JSON.parse(s) : []);
  }))].sort();
  var allMonths = [...new Set(state.clips.map(function(c){ return c.month; }).filter(Boolean))].sort();
  var allAngles = [...new Set(state.clips.map(function(c){ return c.angle; }).filter(Boolean))].sort();
  buildMenu('fm-shottype', shots, onShotTypeSelect, function(v){ return v === state.filterShotType; });
  buildMenu('fm-tags', allTags, onTagSelect, function(v){ return state.filterTags.has(v); });
  buildMenu('fm-skus', allSkus, onSkuSelect, function(v){ return state.filterSkus.has(v); });
  buildMenu('fm-month', allMonths, onMonthSelect, function(v){ return state.filterMonths.has(v); });
  buildMenu('fm-angle', allAngles, onAngleSelect, function(v){ return state.filterAngles.has(v); });
}
/** Render a filter dropdown menu. Calls onClick(value) when an item is selected. */
function buildMenu(menuId,items,onClick,isSel){
  var menu=document.getElementById(menuId);if(!menu)return;menu.innerHTML='';
  if(!items.length){menu.innerHTML='<div class="filter-menu-item" style="color:var(--text-dim)">No options yet</div>';return;}
  items.forEach(function(item){var div=document.createElement('div');div.className='filter-menu-item'+(isSel(item)?' selected':'');div.innerHTML='<span class="filter-check">'+(isSel(item)?'&#10003;':'')+'</span><span>'+esc(item)+'</span>';div.addEventListener('click',function(){onClick(item);buildFilterMenus();});menu.appendChild(div);});
}
/** Re-render the active filter pills row from current filter state. */
function updateActiveTags(){
  var container = document.getElementById('active-filters');
  container.innerHTML = '';

  // Shot type pill
  if(state.filterShotType){
    var pill = document.createElement('div');
    pill.className = 'active-tag';
    pill.innerHTML = esc(state.filterShotType) + '<button>x</button>';
    pill.querySelector('button').addEventListener('click', function(){
      state.filterShotType = null;
      document.getElementById('fb-shottype-label').textContent = 'Shot Type';
      document.getElementById('fb-shottype').classList.remove('active');
      state.clips = [];
      loadClips(state.activeClient.id, 1, false).then(function(){ buildFilterMenus(); });
      updateActiveTags();
    });
    container.appendChild(pill);
  }

  // Tag pills
  state.filterTags.forEach(function(tag){
    var pill = document.createElement('div');
    pill.className = 'active-tag';
    pill.innerHTML = esc(tag) + '<button>x</button>';
    pill.querySelector('button').addEventListener('click', function(){
      state.filterTags.delete(tag);
      if(!state.filterTags.size){
        document.getElementById('fb-tags-label').textContent = 'Tags';
        document.getElementById('fb-tags').classList.remove('active');
      } else {
        document.getElementById('fb-tags-label').textContent = state.filterTags.size + ' tags';
      }
      renderClipGrid(); updateCountBadge(); updateLoadMore(); updateActiveTags(); buildFilterMenus();
    });
    container.appendChild(pill);
  });

  // SKU pills
  state.filterSkus.forEach(function(sku){
    var pill = document.createElement('div');
    pill.className = 'active-tag active-tag--sku';
    pill.innerHTML = esc(sku) + '<button>x</button>';
    pill.querySelector('button').addEventListener('click', function(){
      state.filterSkus.delete(sku);
      if(!state.filterSkus.size){
        document.getElementById('fb-skus-label').textContent = 'SKU';
        document.getElementById('fb-skus').classList.remove('active');
      } else {
        document.getElementById('fb-skus-label').textContent = state.filterSkus.size + ' SKUs';
      }
      renderClipGrid(); updateCountBadge(); updateLoadMore(); updateActiveTags(); buildFilterMenus();
    });
    container.appendChild(pill);
  });
}
/** Close all open filter dropdown menus. */
function closeMenus(){document.querySelectorAll('.filter-menu').forEach(function(m){m.classList.remove('open');});}

// ── Modal ─────────────────────────────────────────────────────────────────────
/**
 * Fill in the metadata panel (right side) of the clip modal.
 * Handles tags, stats, description truncation and filename display.
 * @param {object} clip - clip object from FootageStore API
 */
function populateModalMeta(clip){
  document.getElementById('modal-title').textContent=clip.name||clip.originalFilename||'';
  try{document.getElementById('modal-date').textContent=clip.createdAt?new Date(clip.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'';}catch(err){}
  var codeEl=document.getElementById('modal-clip-code');if(codeEl)codeEl.textContent=clip.code||'';
  // Shot type
  var shot=clip.shotType||'';
  document.getElementById('modal-shot-tags').innerHTML=shot?'<span class="modal-tag">'+esc(shot)+'</span>':'<span style="color:var(--text-dim);font-size:10px">None</span>';
  // Tags
  var tags=Array.isArray(clip.tags)?clip.tags:(typeof clip.tags==='string'&&clip.tags?JSON.parse(clip.tags):[]);
  document.getElementById('modal-clip-tags').innerHTML=tags.length?tags.map(function(t){return'<span class="modal-tag">'+esc(t)+'</span>';}).join(''):'<span style="color:var(--text-dim);font-size:10px">None</span>';
  // Product SKUs
  var skus=Array.isArray(clip.productSkus)?clip.productSkus:(typeof clip.productSkus==='string'&&clip.productSkus?JSON.parse(clip.productSkus):[]);
  document.getElementById('modal-sku-tags').innerHTML=skus.length?skus.map(function(s){return'<span class="modal-tag modal-tag--sku">'+esc(s)+'</span>';}).join(''):'<span style="color:var(--text-dim);font-size:10px">None</span>';
  // Month + Angle (editable inputs)
  var monthEl=document.getElementById('modal-month-input');
  var angleEl=document.getElementById('modal-angle-input');
  if(monthEl){ monthEl.value=clip.month||''; monthEl.dataset.clipId=clip.id; }
  if(angleEl){ angleEl.value=clip.angle||''; angleEl.dataset.clipId=clip.id; }
  // Stats grid
  document.getElementById('stat-duration').textContent=clip.duration?fmtDur(clip.duration):'--';
  document.getElementById('stat-resolution').textContent=(clip.width&&clip.height)?clip.width+'x'+clip.height:'--';
  document.getElementById('stat-size').textContent=fmtSize(clip.fileSize||0);
  document.getElementById('stat-codec').textContent=clip.codec||'--';
  document.getElementById('stat-fps').textContent=clip.fps?Math.round(clip.fps*100)/100+'fps':'--';
  document.getElementById('stat-format').textContent=clip.mimeType||'--';
  // Description (truncated to 160 chars with expand button)
  var desc=clip.description||'';
  var descEl=document.getElementById('modal-description'), moreBtn=document.getElementById('modal-desc-more');
  if(desc.length>160){descEl.textContent=desc.slice(0,160)+'...';descEl.dataset.full=desc;moreBtn.style.display='block';moreBtn.textContent='See more';}
  else{descEl.textContent=desc||'No description available.';moreBtn.style.display='none';}
  // Filename
  document.getElementById('modal-filename').textContent=clip.originalFilename||'';
}

/**
 * Reset and initialise the video player area, then kick off proxy loading.
 * The proxy is fetched as a binary blob so auth cookies work in CEP.
 * @param {object} clip - clip object from FootageStore API
 */
function populateModalVideo(clip){
  var vid=document.getElementById('modal-video');
  var noVid=document.getElementById('modal-no-video');
  vid.pause(); vid.removeAttribute('src'); vid.load(); // clear any previous video
  vid.style.display='none'; noVid.style.display='flex';
  document.getElementById('modal-ext-icon').textContent='\u25B6';
  document.getElementById('modal-ext-label').textContent='Generating preview...';
  document.getElementById('modal-play-btn').textContent='\u25B6';
  setModalScrub(0); document.getElementById('modal-time').textContent='0:00 / 0:00';
  if(state.sessionToken) requestProxy(clip.id, vid, noVid);
}

/**
 * Open the clip detail modal for a given clip.
 * Sets modal state then delegates to populateModalMeta and populateModalVideo.
 * @param {object} clip - clip object from FootageStore API
 */
function openModal(clip){
  state.modalClip=clip;
  document.getElementById('modal-overlay').classList.add('open');
  populateModalMeta(clip);
  populateModalVideo(clip);
}
// ── Proxy video request ──────────────────────────────────────────────────────
// Proxies are pre-generated by the FootageStore worker and served via Cloudflare.
// Works for all editors regardless of network location.
var proxyPollTimers={};
function requestProxy(clipId, vid, noVid){
  if(proxyPollTimers[clipId]) clearTimeout(proxyPollTimers[clipId]);

  // First do a HEAD request to check if the proxy exists before downloading
  var headReq=nodeHttps.request({
    hostname:new URL(API_BASE).hostname, port:443,
    path:'/api/assets/'+clipId+'/proxy.mp4', method:'HEAD',
    headers:{'Cookie':'__Secure-authjs.session-token='+state.sessionToken,'User-Agent':'FraggellPanel/1.0'}
  },function(headRes){
    if(headRes.statusCode===404){
      // Not generated yet — show message and poll
      var label=document.getElementById('modal-ext-label');
      if(label&&state.modalClip&&state.modalClip.id===clipId) label.textContent='Preview generating…';
      proxyPollTimers[clipId]=setTimeout(function(){
        if(state.modalClip&&state.modalClip.id===clipId) requestProxy(clipId,vid,noVid);
      },8000);
      return;
    }
    if(headRes.statusCode!==200&&headRes.statusCode!==206){
      var label=document.getElementById('modal-ext-label');
      if(label&&state.modalClip&&state.modalClip.id===clipId) label.textContent='Preview unavailable';
      return;
    }
    // Proxy exists — get the content-length so we can show progress
    var totalBytes=parseInt(headRes.headers['content-length']||'0',10);
    var label=document.getElementById('modal-ext-label');
    if(label&&state.modalClip&&state.modalClip.id===clipId) label.textContent='Loading preview…';
    // Now download as blob with progress tracking
    var getReq=nodeHttps.request({
      hostname:new URL(API_BASE).hostname, port:443,
      path:'/api/assets/'+clipId+'/proxy.mp4', method:'GET',
      headers:{'Cookie':'__Secure-authjs.session-token='+state.sessionToken,'User-Agent':'FraggellPanel/1.0'}
    },function(getRes){
      if(getRes.statusCode!==200){
        if(label&&state.modalClip&&state.modalClip.id===clipId) label.textContent='Preview unavailable';
        return;
      }
      var chunks=[], received=0;
      getRes.on('data',function(chunk){
        // Check modal still open for this clip before continuing
        if(!state.modalClip||state.modalClip.id!==clipId){ getRes.destroy(); return; }
        chunks.push(chunk);
        received+=chunk.length;
        if(totalBytes>0&&label&&state.modalClip&&state.modalClip.id===clipId){
          var pct=Math.round((received/totalBytes)*100);
          label.textContent='Loading preview… '+pct+'%';
        }
      });
      getRes.on('end',function(){
        if(!vid||!noVid||!state.modalClip||state.modalClip.id!==clipId) return;
        var blob=new Blob([Buffer.concat(chunks)],{type:'video/mp4'});
        var url=URL.createObjectURL(blob);
        vid.src=url;
        vid.style.display='block';
        noVid.style.display='none';
      });
      getRes.on('error',function(e){
        log('warn','requestProxy stream error for '+clipId,e);
        if(label&&state.modalClip&&state.modalClip.id===clipId) label.textContent='Preview unavailable';
      });
    });
    getReq.on('error',function(e){
      log('warn','requestProxy GET failed for '+clipId,e);
      if(label&&state.modalClip&&state.modalClip.id===clipId) label.textContent='Preview unavailable';
    });
    getReq.end();
  });
  headReq.on('error',function(e){
    log('warn','requestProxy HEAD failed for '+clipId,e);
    var label=document.getElementById('modal-ext-label');
    if(label&&state.modalClip&&state.modalClip.id===clipId) label.textContent='Preview unavailable';
  });
  headReq.end();
}

/** Close the clip detail modal and cancel any in-flight proxy poll. */
function closeModal(){
  document.getElementById('modal-overlay').classList.remove('open');
  var vid=document.getElementById('modal-video');if(vid)vid.pause();
  // Cancel any in-flight proxy poll for the clip being closed
  if(state.modalClip&&proxyPollTimers[state.modalClip.id]){
    clearTimeout(proxyPollTimers[state.modalClip.id]);
    delete proxyPollTimers[state.modalClip.id];
  }
  state.modalClip=null;
}
/** Set the modal video scrub bar position (0-100%). */
function setModalScrub(pct){document.getElementById('modal-scrub-fill').style.width=pct+'%';document.getElementById('modal-scrub-thumb').style.left=pct+'%';}
/** Wire up the modal video player controls (play/pause, scrub, keyboard shortcuts). */
function setupModalControls(){
  var vid=document.getElementById('modal-video'), playBtn=document.getElementById('modal-play-btn');
  var track=document.getElementById('modal-scrub-track'), timeEl=document.getElementById('modal-time');
  if(playBtn) playBtn.addEventListener('click',function(){
    if(vid.paused){
      var p=vid.play();
      if(p&&p.catch) p.catch(function(){});  // suppress AbortError if interrupted
    } else {
      vid.pause();
    }
  });
  if(vid){
    vid.addEventListener('play',function(){playBtn.textContent='||';});
    vid.addEventListener('pause',function(){playBtn.textContent='\u25B6';});
    vid.addEventListener('ended',function(){playBtn.textContent='\u25B6';setModalScrub(0);});
    vid.addEventListener('loadedmetadata',function(){timeEl.textContent='0:00 / '+fmtTime(vid.duration);});
    vid.addEventListener('timeupdate',function(){if(!vid.duration)return;setModalScrub((vid.currentTime/vid.duration)*100);timeEl.textContent=fmtTime(vid.currentTime)+' / '+fmtTime(vid.duration);});
  }
  var drag=false;
  function scrubTo(e){if(!vid||!vid.duration)return;var r=track.getBoundingClientRect();vid.currentTime=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*vid.duration;}
  if(track){track.addEventListener('mousedown',function(e){drag=true;scrubTo(e);e.preventDefault();});}
  document.addEventListener('mousemove',function(e){if(drag)scrubTo(e);});
  document.addEventListener('mouseup',function(){drag=false;});
  document.getElementById('modal-overlay').addEventListener('click',function(e){if(e.target===document.getElementById('modal-overlay'))closeModal();});
  document.getElementById('modal-close').addEventListener('click',closeModal);
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal();});
  document.getElementById('modal-copy-btn').addEventListener('click',function(){
    var fn=document.getElementById('modal-filename').textContent;
    if(!fn) return;
    // navigator.clipboard is unavailable in CEP (file:// context) — use execCommand fallback
    try{
      var ta=document.createElement('textarea');
      ta.value=fn; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Copied','info');
    }catch(e){
      log('warn','Copy to clipboard failed',e);
      showToast('Copy failed','error');
    }
  });
  var codeCopyBtn=document.getElementById('modal-code-copy-btn');
  if(codeCopyBtn) codeCopyBtn.addEventListener('click',function(){
    var code=document.getElementById('modal-clip-code').textContent;
    if(!code) return;
    try{
      var ta=document.createElement('textarea');
      ta.value=code;ta.style.position='fixed';ta.style.opacity='0';
      document.body.appendChild(ta);ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Code copied','info');
    }catch(e){showToast('Copy failed','error');}
  });
  document.getElementById('modal-desc-more').addEventListener('click',function(){
    var el=document.getElementById('modal-description');
    if(this.textContent==='See more'){el.textContent=el.dataset.full;this.textContent='See less';}
    else{el.textContent=el.dataset.full.slice(0,160)+'...';this.textContent='See more';}
  });
  document.getElementById('modal-import-btn').addEventListener('click',function(){closeModal();importSelected();});
  document.getElementById('modal-gdrive-btn').addEventListener('click',function(){
    if(!state.modalClip) return;
    var fileId=state.modalClip.driveFileId;
    if(fileId) getCS().openURLInDefaultBrowser('https://drive.google.com/file/d/'+fileId+'/view');
    else showToast('No Drive file ID for this clip','error');
  });
}


// ── Import to Premiere ─────────────────────────────────────────────────────────────
/**
 * Resolve each selected clip to a local path on the Shared Drive mount, then
 * call Premiere's importFiles() via ExtendScript. Same as dragging a file
 * from Windows Explorer into Premiere — just automated.
 */
async function importSelected(){
  if(!state.selected.size) return;

  var projectCheck=await new Promise(function(resolve){
    getCS().evalScript('app.project?app.project.name:"NONE"',function(r){resolve(r&&r!=='NONE'&&r.length>0);});
  });
  if(!projectCheck){showToast('No Premiere project open','error');return;}

  var selectedClips=state.clips.filter(function(c){return state.selected.has(c.id);});
  var binName=state.activeClient?state.activeClient.name:'Fraggell Footage';
  var paths=[];
  var notFound=[];

  for(var i=0;i<selectedClips.length;i++){
    var clip=selectedClips[i];
    var fn=clip.originalFilename||'';

    // Check path cache first
    var p=state.pathCache.get(fn);

    if(!p&&fs&&nodePath&&state.footageRoot&&fn){
      p=resolveClipPath(state.footageRoot, state.activeClient.name, clip, fs, nodePath);
      if(!p) log('warn','resolveClipPath: not found on drive',{message:fn});
    }

    if(p){
      state.pathCache.set(fn,p);
      paths.push(p);
    } else {
      notFound.push(fn);
    }
  }

  if(notFound.length){
    var driveOk=false;
    if(state.footageRoot&&fs){ try{ driveOk=fs.existsSync(state.footageRoot); }catch(e){} }
    if(!driveOk){
      showToast('Google Drive appears disconnected. Check Drive Desktop is running, then click the folder icon to re-detect.','error');
    } else {
      var firstName=notFound[0]?notFound[0].slice(0,35)+(notFound[0].length>35?'...':''):'';
      var msg=notFound.length===1
        ? '"'+firstName+'" was not found on the Shared Drive'
        : notFound.length+' clips were not found on the Shared Drive';
      showToast(msg,'error');
    }
  }
  if(!paths.length) return;

  showToast('Importing into Premiere…','info');
  var payload=JSON.stringify({paths:paths,binName:binName});
  getCS().evalScript('importFootage('+JSON.stringify(payload)+')',function(r){
    try{
      var res=JSON.parse(r);
      if(res.success){
        showToast('\u2713 '+res.imported+' clip'+(res.imported!==1?'s':'')+' imported into "'+binName+'"','success');
        state.selected.clear();renderClipGrid();updateBottomBar();
      } else {
        showToast('Import error: '+(res.error||'unknown'),'error');
      }
    }catch(err){
      log('error','importSelected evalScript callback parse failed',err);
      showToast('Import failed','error');
    }
  });
}

// ── Month/Angle edit ───────────────────────────────────────────────────────────
/** PATCH a clip's month or angle label. Updates local state so filters refresh. */
async function saveClipLabel(clipId, field, value){
  if(!clipId) return;
  var v=(value||'').trim()||null;
  var c=state.clips.find(function(x){return x.id===clipId;});
  if(c && (c[field]||null)===v) return; // no change
  var body={}; body[field]=v;
  try{
    await apiJSON('/api/clips/'+clipId,{method:'PATCH',body:JSON.stringify(body)});
    if(c) c[field]=v;
    if(state.modalClip&&state.modalClip.id===clipId) state.modalClip[field]=v;
    buildFilterMenus();
    showToast(field.charAt(0).toUpperCase()+field.slice(1)+' saved','success');
  }catch(e){ log('warn','saveClipLabel failed',e); showToast('Failed to save '+field,'error'); }
}

// ── Bulk download ──────────────────────────────────────────────────────────────
/**
 * Copy the selected clips' ORIGINAL files from the mounted Shared Drive to a
 * folder the editor picks. The originals are already local (Google Drive Desktop),
 * so this is a plain file copy — no network download.
 */
async function downloadSelected(){
  if(!state.selected.size) return;
  if(!fs||!nodePath||!(window.cep&&window.cep.fs)){ showToast('File access unavailable in this environment','error'); return; }

  var dlg=window.cep.fs.showOpenDialog(false,true,'Choose a download folder','');
  if(!dlg||!dlg.data||!dlg.data.length) return; // cancelled
  var destDir=dlg.data[0];

  var selectedClips=state.clips.filter(function(c){return state.selected.has(c.id);});
  showToast('Downloading '+selectedClips.length+' clip'+(selectedClips.length!==1?'s':'')+'…','info');
  var copied=0, notFound=[], failed=[];
  for(var i=0;i<selectedClips.length;i++){
    var clip=selectedClips[i];
    var fn=clip.originalFilename||'';
    var p=state.pathCache.get(fn);
    if(!p&&state.footageRoot&&fn){ p=resolveClipPath(state.footageRoot, state.activeClient.name, clip, fs, nodePath); if(p) state.pathCache.set(fn,p); }
    if(!p){ notFound.push(fn); continue; }
    try{
      var dest=nodePath.join(destDir, nodePath.basename(p));
      await new Promise(function(resolve,reject){ fs.copyFile(p, dest, function(err){ err?reject(err):resolve(); }); });
      copied++;
    }catch(e){ failed.push(fn); log('warn','download copy failed for '+fn,e); }
  }
  var msg='✓ '+copied+' downloaded to '+destDir;
  if(notFound.length) msg+=' · '+notFound.length+' not found on Drive';
  if(failed.length) msg+=' · '+failed.length+' failed';
  showToast(msg, copied?'success':'error');
}


// ── Utilities ─────────────────────────────────────────────────────────────────
// fmtSize, fmtDur, fmtTime — defined in js/utils.js
/** Returns a debounced version of fn that fires after ms milliseconds of inactivity. */
function debounce(fn,ms){var t;return function(){var a=arguments;clearTimeout(t);t=setTimeout(function(){fn.apply(null,a);},ms);};}
/** Poll Premiere for the current project name and update the header display. */
function updateProjectName(){getCS().evalScript('getProjectName()',function(r){state.projectName=r||'No project open';var el=document.getElementById('project-name');if(el)el.textContent=state.projectName;});}
/** Show a temporary notification toast. type: "success" | "error" | "info". */
function showToast(msg,type){
  var c=document.getElementById('toast-container');
  var t=document.createElement('div');t.className='toast toast--'+(type||'info');t.textContent=msg;
  c.appendChild(t);
  setTimeout(function(){t.classList.add('toast--visible');},10);
  setTimeout(function(){t.classList.remove('toast--visible');setTimeout(function(){t.remove();},300);},5000);
}

// ── Events ────────────────────────────────────────────────────────────────────

/**
 * Wire up the login screen — sign-in button, Enter key on email/password fields.
 */
function setupLoginEvents(){
  document.getElementById('login-btn').addEventListener('click',async function(){
    var email=(document.getElementById('login-email').value||'').trim();
    var password=document.getElementById('login-password').value||'';
    var errEl=document.getElementById('login-error'), btn=document.getElementById('login-btn');
    if(!email||!password){errEl.textContent='Please enter email and password';return;}
    btn.textContent='Signing in...';btn.disabled=true;errEl.textContent='';
    try{
      await login(email,password);
      var hasDrive=connectDrive();
      if(!hasDrive){
        var mounts=findMounts(),all=mounts.reduce(function(a,m){return a.concat(m.drives);},[]);
        if(all.length>1){showDrivePicker(all);return;}
        showNotConnected(mounts.length>0?'No Shared Drives visible.':'Google Drive Desktop not running.');
        return;
      }
      await startPanel();
    }catch(err){errEl.textContent=err.message||'Login failed';}
    finally{btn.textContent='Sign in';btn.disabled=false;}
  });
  document.getElementById('login-password').addEventListener('keydown',function(e){if(e.key==='Enter')document.getElementById('login-btn').click();});
  document.getElementById('login-email').addEventListener('keydown',function(e){if(e.key==='Enter')document.getElementById('login-password').focus();});
}

/**
 * Wire up header buttons — logout, session banner, retry, refresh, change drive.
 */
function setupHeaderEvents(){
  document.getElementById('logout-btn').addEventListener('click',logout);
  var cub = document.getElementById('check-update-btn');
  if(cub) cub.addEventListener('click', function(){ checkForUpdate(true); });
  var ub = document.getElementById('update-badge');
  if(ub) ub.addEventListener('click', function(){
    if(_updateAvailable) performUpdate();
  });
  var sib=document.getElementById('session-signin-btn');
  if(sib) sib.addEventListener('click',function(){ hideSessionBanner(); logout(); });
  document.getElementById('retry-btn').addEventListener('click',init);
  document.getElementById('refresh-btn').addEventListener('click',function(){
    if(state.activeClient) selectClient(state.activeClient);
  });
  var cdb=document.getElementById('change-drive-btn');
  if(cdb){
    cdb.addEventListener('click',function(){
      delPref(PREF_DRIVE); state.footageRoot=null; state.pathCache.clear();
      var mounts=findMounts(), all=mounts.reduce(function(a,m){return a.concat(m.drives);},[]);
      if(all.length===0){
        showNotConnected('No Shared Drives found. Make sure Google Drive Desktop is running.');
      } else if(all.length===1){
        setPref(PREF_DRIVE,all[0].fullPath); state.footageRoot=all[0].fullPath;
        showToast('Drive set to: '+all[0].name,'success');
      } else {
        showDrivePicker(all);
      }
    });
  }
}

/**
 * Wire up main panel interactions — clip selection, import, search, filters, grid size.
 */
function setupPanelEvents(){
  document.getElementById('import-btn').addEventListener('click',importSelected);
  document.getElementById('clear-btn').addEventListener('click',function(){
    state.selected.clear(); renderClipGrid(); updateBottomBar();
  });
  document.getElementById('select-all-btn').addEventListener('click',function(){
    getVisible().forEach(function(c){state.selected.add(c.id);});
    renderClipGrid(); updateBottomBar();
  });
  document.getElementById('load-more-btn').addEventListener('click',async function(){
    if(state.activeClient&&state.currentPage<state.totalPages)
      await loadClips(state.activeClient.id,state.currentPage+1,true);
  });
  document.getElementById('search-input').addEventListener('input',debounce(async function(e){
    state.searchQuery=e.target.value; state.currentPage=1; state.clips=[];
    if(state.activeClient) await loadClips(state.activeClient.id,1,false).then(buildFilterMenus);
  },350));
  var codeIn=document.getElementById('code-input');
  if(codeIn){
    codeIn.addEventListener('keydown',async function(e){
      if(e.key!=='Enter') return;
      e.preventDefault();
      var val=e.target.value.trim().toUpperCase();
      if(!val) return;
      try{
        var data=await apiJSON('/api/clips/lookup?code='+encodeURIComponent(val));
        if(data.clip){openModal(data.clip);e.target.value='';}
        else{showToast('No clip found with code "'+val+'"','error');}
      }catch(err){showToast('No clip found with that code','error');}
    });
    codeIn.addEventListener('input',debounce(async function(e){
      var val=e.target.value.trim().toUpperCase();
      if(val.length<4) return;
      try{
        var data=await apiJSON('/api/clips/lookup?code='+encodeURIComponent(val));
        if(data.clip){openModal(data.clip);e.target.value='';}
      }catch(err){}
    },500));
  }
  document.querySelectorAll('.gs-btn').forEach(function(b){
    b.addEventListener('click',function(){
      state.gridSize=b.dataset.size;
      document.getElementById('clip-grid').className='clip-grid clip-grid--'+b.dataset.size;
      document.querySelectorAll('.gs-btn').forEach(function(x){x.classList.toggle('gs-btn--active',x.dataset.size===b.dataset.size);});
    });
  });
  document.getElementById('fb-shottype').addEventListener('click',function(e){
    e.stopPropagation();
    document.getElementById('fm-shottype').classList.toggle('open');
    document.getElementById('fm-tags').classList.remove('open');
    document.getElementById('fm-skus').classList.remove('open');
  });
  document.getElementById('fb-tags').addEventListener('click',function(e){
    e.stopPropagation();
    document.getElementById('fm-tags').classList.toggle('open');
    document.getElementById('fm-shottype').classList.remove('open');
    document.getElementById('fm-skus').classList.remove('open');
  });
  document.getElementById('fb-skus').addEventListener('click',function(e){
    e.stopPropagation();
    document.getElementById('fm-skus').classList.toggle('open');
    document.getElementById('fm-shottype').classList.remove('open');
    document.getElementById('fm-tags').classList.remove('open');
  });
  document.getElementById('fb-month').addEventListener('click',function(e){
    e.stopPropagation();
    var open=document.getElementById('fm-month').classList.contains('open');
    closeMenus(); if(!open) document.getElementById('fm-month').classList.add('open');
  });
  document.getElementById('fb-angle').addEventListener('click',function(e){
    e.stopPropagation();
    var open=document.getElementById('fm-angle').classList.contains('open');
    closeMenus(); if(!open) document.getElementById('fm-angle').classList.add('open');
  });
  // Save month/angle edits on blur (PATCH to the API; sync won't overwrite manual edits).
  ['modal-month-input','modal-angle-input'].forEach(function(id){
    var el=document.getElementById(id); if(!el) return;
    el.addEventListener('blur',function(){ saveClipLabel(el.dataset.clipId, id==='modal-month-input'?'month':'angle', el.value); });
    el.addEventListener('keydown',function(e){ if(e.key==='Enter') el.blur(); });
  });
  document.getElementById('download-btn').addEventListener('click',downloadSelected);
  document.addEventListener('click',closeMenus);
}

/** Prevent wheel events from reaching Premiere's timeline.
 *
 * Two-part fix:
 *
 * 1. OS-level focus: when you click Premiere's timeline, the OS routes wheel
 *    events to Premiere regardless of which window the mouse is over.
 *    Fix: call window.focus() on mouseenter to reclaim focus for the CEP panel.
 *
 * 2. CEP forwarding: even with focus, Chromium can forward unhandled wheel
 *    events to the host. Fix: preventDefault() on every wheel event so CEP
 *    never considers them "unhandled", then manually scroll the target element.
 */
function setupScrollLock(){
  // Reclaim OS focus whenever the mouse enters the panel.
  // Without this, Premiere keeps focus after the user clicks the timeline
  // and wheel events never reach our JS handler.
  document.body.addEventListener('mouseenter', function(){
    window.focus();
  });

  document.addEventListener('wheel', function(e){
    // Prevent CEP from forwarding this wheel event to Premiere's host window
    e.preventDefault();
    e.stopPropagation();

    // Manually scroll the nearest scrollable ancestor
    var el = e.target;
    while(el && el !== document.documentElement){
      var style = window.getComputedStyle(el);
      var overflowY = style.overflowY;
      if(overflowY === 'auto' || overflowY === 'scroll'){
        var canDown = e.deltaY > 0 && el.scrollTop < (el.scrollHeight - el.clientHeight);
        var canUp   = e.deltaY < 0 && el.scrollTop > 0;
        var canH    = e.deltaX !== 0;
        if(canDown || canUp || canH){
          el.scrollTop  += e.deltaY;
          el.scrollLeft += e.deltaX;
          return;
        }
      }
      el = el.parentElement;
    }
    // Nothing to scroll — event consumed, playhead stays still.
  }, { passive: false, capture: true });
}

/**
 * Top-level event setup — calls all focused setup functions.
 * Called once on DOMContentLoaded.
 */
function setupEvents(){
  setupLoginEvents();
  setupHeaderEvents();
  setupPanelEvents();
  setupModalControls();
  setupScrollLock();
}

// ── Global error handlers ─────────────────────────────────────────────────────
/** Log unhandled promise rejections that would otherwise be silent in CEP. */
window.addEventListener('unhandledrejection',function(e){
  log('error','Unhandled promise rejection',{message:String(e.reason),stack:e.reason&&e.reason.stack});
});
/** Log uncaught synchronous exceptions. */
window.addEventListener('error',function(e){
  log('error','Uncaught error: '+e.message,{message:e.message,stack:e.error&&e.error.stack,file:e.filename,line:e.lineno});
});

if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){setupEvents();init();});}else{setupEvents();init();}
