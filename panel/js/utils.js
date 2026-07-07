/**
 * Fraggell Footage Panel — pure utility functions
 *
 * This file contains functions with no CEP/DOM/API dependencies.
 * They can be required directly in Node.js for testing.
 * Included via <script> in index.html before main.js.
 */

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtSize(b){
  if(!b||isNaN(b)) return '--';
  if(b<1048576)   return (b/1024).toFixed(1)+' KB';
  if(b<1073741824) return (b/1048576).toFixed(1)+' MB';
  return (b/1073741824).toFixed(2)+' GB';
}
function fmtDur(s){
  if(!s||isNaN(s)) return '';
  var m=Math.floor(s/60), sc=Math.floor(s%60);
  return m+':'+(sc<10?'0':'')+sc;
}
function fmtTime(s){
  if(!s||isNaN(s)) return '0:00';
  var m=Math.floor(s/60), sc=Math.floor(s%60);
  return m+':'+(sc<10?'0':'')+sc;
}

// ── VTT / sprite sheet parsing ────────────────────────────────────────────────
function parseVTT(text){
  var cues=[], lines=text.split(/\r?\n/);
  for(var i=0;i<lines.length;i++){
    var line=lines[i].trim();
    if(line.includes('-->')){
      var parts=line.split('-->');
      var s=vttSec(parts[0].trim()), e=vttSec(parts[1].trim());
      var m=(lines[i+1]||'').trim().match(/#xywh=(\d+),(\d+),(\d+),(\d+)/);
      if(m) cues.push({start:s,end:e,x:+m[1],y:+m[2],w:+m[3],h:+m[4]});
    }
  }
  return cues;
}
function vttSec(s){
  var p=s.split(':');
  return p.length===3
    ? +p[0]*3600+(+p[1]*60)+parseFloat(p[2])
    : (+p[0]*60+parseFloat(p[1]));
}
function getNumCols(cues){
  var xs=[];
  for(var i=0;i<cues.length;i++){
    if(xs.indexOf(cues[i].x)===-1) xs.push(cues[i].x);
    if(i>0&&cues[i].x===0&&xs.length>1) break;
  }
  return xs.length||8;
}

// ── Import path resolution ────────────────────────────────────────────────────
/**
 * Resolve a clip's local file path on the Google Drive mount.
 *
 * Strategy:
 *   1. Primary:  footageRoot / clientName / folderPath / filename
 *   2. Fallback: footageRoot / clientName / filename  (if folderPath was set but primary missed)
 *
 * @param {string}   footageRoot  - e.g. "H:\Shared drives\Fraggell Editors\Footage Storage"
 * @param {string}   clientName   - e.g. "Leaf Shave"
 * @param {object}   clip         - clip object from FootageStore API (camelCase keys)
 * @param {object}   fsModule     - Node.js fs module (or mock)
 * @param {object}   pathModule   - Node.js path module (or mock)
 * @returns {string|null}         - resolved absolute path, or null if not found
 */
function resolveClipPath(footageRoot, clientName, clip, fsModule, pathModule){
  var fn = clip.originalFilename || '';
  if(!fn || !footageRoot || !fsModule || !pathModule) return null;

  var fp = clip.folderPath || '';

  var primary = fp
    ? pathModule.join(footageRoot, clientName, fp, fn)
    : pathModule.join(footageRoot, clientName, fn);

  try{ if(fsModule.existsSync(primary)) return primary; }catch(e){}

  // Only run fallback if a folderPath was set (primary tried a deeper path)
  if(fp){
    var fallback = pathModule.join(footageRoot, clientName, fn);
    try{ if(fsModule.existsSync(fallback)) return fallback; }catch(e){}
  }

  return null;
}

// ── Auto-detect drive subfolder ───────────────────────────────────────────────
/**
 * Given a root shared drive path, find the Footage Storage subfolder.
 * Pure function — takes fs as a parameter so it can be tested with a mock.
 *
 * @param {string}   root       - e.g. "H:\Shared drives\Fraggell Editors"
 * @param {object}   fsModule   - Node.js fs module (or mock)
 * @param {object}   pathModule - Node.js path module (or mock)
 * @returns {string}            - subfolder path if found, else root unchanged
 */
function resolveFootageRoot(root, fsModule, pathModule){
  var candidates = ['Footage Storage','footage storage','footage','Footage'];
  for(var i=0; i<candidates.length; i++){
    var candidate = pathModule.join(root, candidates[i]);
    try{ if(fsModule.statSync(candidate).isDirectory()) return candidate; }catch(e){}
  }
  return root;
}

// ── CommonJS export for Node.js test runner ───────────────────────────────────
if(typeof module !== 'undefined' && module.exports){
  module.exports = { fmtSize, fmtDur, fmtTime, parseVTT, vttSec, getNumCols, resolveClipPath, resolveFootageRoot };
}
