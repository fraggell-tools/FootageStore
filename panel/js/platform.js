/**
 * Fraggell Footage Panel — Platform abstraction layer
 *
 * All OS-specific logic lives here. main.js calls these functions
 * without caring about the platform. Add Mac or Windows behaviour
 * only in this file — the rest of the codebase stays untouched.
 *
 * Exported globals (loaded via <script> before main.js):
 *   getDataDir()   → string  base directory for logs and prefs
 *   findMounts()   → array   {driveLetter|mountPoint, drives:[{name,fullPath}]}
 */

// ── Platform detection ────────────────────────────────────────────────────────
var PLATFORM_IS_MAC = (typeof process !== 'undefined') && process.platform === 'darwin';

// Resolve fs and nodePath for both environments:
//   CEP (browser+Node): globals set by main.js via window.cep_node
//   Node.js test runner: use native require()
var _pfs   = (typeof fs       !== 'undefined') ? fs       : null;
var _ppath = (typeof nodePath !== 'undefined') ? nodePath : null;
try{ if(!_pfs)   _pfs   = require('fs');   }catch(e){}
try{ if(!_ppath) _ppath = require('path'); }catch(e){}

// ── getDataDir ────────────────────────────────────────────────────────────────
/**
 * Return the directory used for panel.log and prefs.json.
 *
 * Windows: %APPDATA%\FraggellFootagePanel
 * Mac:     ~/Library/Logs/FraggellFootagePanel
 */
function getDataDir(){
  if(!_ppath) return null;
  try{
    if(PLATFORM_IS_MAC){
      var home = (typeof process !== 'undefined') && process.env && process.env.HOME;
      if(!home) return null;
      return _ppath.join(home, 'Library', 'Logs', 'FraggellFootagePanel');
    } else {
      var appdata = (typeof process !== 'undefined') && process.env && process.env.APPDATA;
      if(!appdata) return null;
      return _ppath.join(appdata, 'FraggellFootagePanel');
    }
  }catch(e){ return null; }
}

// ── findMounts ────────────────────────────────────────────────────────────────
/**
 * Scan the OS for Google Drive Shared Drive mounts.
 * Returns an array of mount objects: { mountPoint, drives: [{name, fullPath}] }
 *
 * Windows:
 *   Scans A:\ through Z:\ for "Shared drives" sub-directories.
 *   Google Drive for Desktop on Windows mounts as a drive letter, e.g. G:\
 *   giving G:\Shared drives\<drive name>\
 *
 * Mac:
 *   Google Drive for Desktop has two mount styles depending on version:
 *
 *   Legacy (pre-2021):
 *     /Volumes/GoogleDrive/Shared drives/<drive name>/
 *
 *   Modern (post-2021, CloudStorage):
 *     ~/Library/CloudStorage/GoogleDrive-<email>/Shared drives/<drive name>/
 *     The email is part of the folder name, so we glob for GoogleDrive-* entries.
 *
 *   Both locations are checked. If both exist (unlikely), both are returned.
 */
function findMounts(){
  if(!_pfs||!_ppath) return [];

  if(PLATFORM_IS_MAC){
    return _findMountsMac();
  } else {
    return _findMountsWindows();
  }
}

function _findMountsWindows(){
  var res = [];
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(function(L){
    var p = L + ':\\Shared drives';
    try{
      if(_pfs.statSync(p).isDirectory()){
        var drives = _readDriveList(p);
        res.push({ mountPoint: L + ':', drives: drives });
      }
    }catch(e){}
  });
  return res;
}

function _findMountsMac(){
  var res = [];
  var home = (typeof process !== 'undefined') && process.env && process.env.HOME;
  if(!home) return res;

  // ── 1. Legacy: /Volumes/GoogleDrive/Shared drives ────────────────────────
  var legacyPath = '/Volumes/GoogleDrive/Shared drives';
  try{
    if(_pfs.statSync(legacyPath).isDirectory()){
      var drives = _readDriveList(legacyPath);
      if(drives.length) res.push({ mountPoint: '/Volumes/GoogleDrive', drives: drives });
    }
  }catch(e){}

  // ── 2. Modern: ~/Library/CloudStorage/GoogleDrive-*/Shared drives ─────────
  var cloudStorageDir = _ppath.join(home, 'Library', 'CloudStorage');
  try{
    var entries = _pfs.readdirSync(cloudStorageDir, { withFileTypes: true });
    entries.forEach(function(entry){
      if(!entry.isDirectory()) return;
      if(!entry.name.startsWith('GoogleDrive-')) return;
      var sharedPath = _ppath.join(cloudStorageDir, entry.name, 'Shared drives');
      try{
        if(_pfs.statSync(sharedPath).isDirectory()){
          var drives = _readDriveList(sharedPath);
          if(drives.length){
            res.push({
              mountPoint: _ppath.join(cloudStorageDir, entry.name),
              drives: drives
            });
          }
        }
      }catch(e){}
    });
  }catch(e){}

  return res;
}

/** Read the list of named shared drives from a "Shared drives" directory. */
function _readDriveList(sharedDrivesPath){
  try{
    return _pfs.readdirSync(sharedDrivesPath, { withFileTypes: true })
      .filter(function(e){
        return e.isDirectory() && !e.name.startsWith('.') && e.name !== '.Trash';
      })
      .map(function(e){
        return { name: e.name, fullPath: _ppath.join(sharedDrivesPath, e.name) };
      });
  }catch(e){ return []; }
}

// CommonJS export for test runner
if(typeof module !== 'undefined' && module.exports){
  module.exports = { getDataDir, findMounts, PLATFORM_IS_MAC };
}
