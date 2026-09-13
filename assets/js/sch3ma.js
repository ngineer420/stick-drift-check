/* stickdriftcheck.com — the sch3ma link. Imported by history.js on the drift pages and by
   signin.html. The project id and the publishable key live here and nowhere else.

   sch3ma is a hosted database with sign-in built in. This site uses it for one thing: the
   drift history a visitor keeps by pressing Save. Until the two values below are real, the
   history stays hidden and no page asks sch3ma for anything. */

const PROJECT = "prj_01M2C235AFWM979H3STRNDJ8FB";
const KEY = "pk_live_01M2C24DDG5HJKEQM0M2C06ESQ_ZpOTVOEtl6D3tLj6XfRntek7FeXP1INC"; // publishable: it ships in the page by design

export function configured() {
  return !PROJECT.endsWith("_PENDING") && !KEY.endsWith("_PENDING");
}

let dbPromise = null;

// The SDK loads on first use, not on page load. A failed load is forgotten, so the next
// press tries again rather than failing for the life of the tab.
export function client() {
  if (!configured()) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = import("https://sch3ma.com/sdk/1.js")
      .then((m) => m.sch3ma({ project: PROJECT, key: KEY }))
      .catch(() => { dbPromise = null; return null; });
  }
  return dbPromise;
}

// True when this browser already holds a sch3ma session for this project. The SDK keeps
// its refresh credential under this key (sch3ma docs 03 §06), so a browser that never
// saved has nothing here and the page sends nothing for it.
export function hasSession() {
  try {
    return localStorage.getItem("sch3ma:rt:" + PROJECT) !== null;
  } catch {
    return false;
  }
}
