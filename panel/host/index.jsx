/**
 * Fraggell Footage Panel - ExtendScript Host
 * Runs inside Premiere Pro to handle file import.
 * Files are imported BY REFERENCE only — no copying, no moving.
 */

function importFootage(jsonPayload) {
  try {
    var payload = JSON.parse(jsonPayload);
    var paths = payload.paths;
    var binName = payload.binName || "Fraggell Footage";

    if (!app.project) {
      return JSON.stringify({ success: false, error: "No active Premiere Pro project." });
    }

    if (!paths || paths.length === 0) {
      return JSON.stringify({ success: false, error: "No paths received." });
    }

    var targetBin = findOrCreateBin(binName);

    // Build a plain ExtendScript Array (JSON.parse may return non-native array in some ES versions)
    var fileArray = [];
    for (var i = 0; i < paths.length; i++) {
      fileArray.push(paths[i]);
    }

    app.project.importFiles(
      fileArray,
      true,   // suppressUIForDuplicates
      targetBin,
      false   // interpret footage automatically
    );

    return JSON.stringify({ success: true, imported: fileArray.length });

  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), line: e.line });
  }
}

/**
 * Find a named bin inside a given parent bin, or create it if missing.
 * Works on any ProjectItem (root or nested bin).
 */
function findOrCreateBinInParent(parent, name) {
  var children = parent.children;
  for (var i = 0; i < children.numItems; i++) {
    var item = children[i];
    if (item.name === name && item.type === ProjectItemType.BIN) {
      return item;
    }
  }
  return parent.createBin(name);
}

/**
 * Find or create the import destination bin.
 * Structure: Footage > ClientName
 * If a "Footage" bin exists at root, the client bin goes inside it.
 * If not, "Footage" is created first, then the client bin inside.
 */
function findOrCreateBin(clientName) {
  var root = app.project.rootItem;
  var footageBin = findOrCreateBinInParent(root, "Footage");
  return findOrCreateBinInParent(footageBin, clientName);
}

function getProjectName() {
  try {
    if (app.project) { return app.project.name; }
    return "No project open";
  } catch (e) { return "No project open"; }
}

function getProjectFolder() {
  try {
    if (app.project && app.project.path) {
      var p = app.project.path;
      var lastSlash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
      if (lastSlash > 0) { return p.substring(0, lastSlash); }
    }
    return "";
  } catch (e) { return ""; }
}
