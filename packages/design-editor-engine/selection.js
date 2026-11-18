// Pure selection helper for undo and redo. Classic script: the page shares one global scope with
// app.js, so the only top-level name is this function; Node loads it with require().

// the objects whose id was selected, in the selected order, each once; ids that are gone drop out
function idsToReselect(selectedIds, objectsAfter) {
  const byId = new Map();
  for (const o of objectsAfter) if (o.id != null && !byId.has(o.id)) byId.set(o.id, o);
  return [...new Set(selectedIds)].map(id => byId.get(id)).filter(Boolean);
}

if (typeof module === 'object') module.exports = { idsToReselect };
