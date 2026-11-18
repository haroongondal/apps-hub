// Pure selection helper for undo and redo. Classic script: the page shares one global scope with
// app.js, so the only top-level names are these functions; Node loads it with require().

// the objects whose id was selected, in the selected order, each once; ids that are gone drop out
function idsToReselect(selectedIds, objectsAfter) {
  const byId = new Map();
  for (const o of objectsAfter) if (o.id != null && !byId.has(o.id)) byId.set(o.id, o);
  return [...new Set(selectedIds)].map(id => byId.get(id)).filter(Boolean);
}

// gives each of a page's objects (saved JSON) an id unique on that page, so a design saved before ids
// existed gets them all at load, not page by page on a visit, which would dirty the design
function giveIds(objects, makeId) {
  const seen = new Set();
  for (const o of objects) {
    if (!o.id || seen.has(o.id)) do o.id = makeId(); while (seen.has(o.id) || objects.some(x => x !== o && x.id === o.id));
    seen.add(o.id);
  }
  return objects;
}

if (typeof module === 'object') module.exports = { idsToReselect, giveIds };
