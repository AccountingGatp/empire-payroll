// Rules are stored as config.json; the admin page can override them in this browser.
export const CFG_KEY = 'empire-payroll-rules-v1';
const safeGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
export const safeSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
export const safeDel = k => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

export async function loadDefaults() { return (await fetch('config.json')).json(); }
export async function loadConfig() {
  const defaults = await loadDefaults();
  const saved = safeGet(CFG_KEY);
  try { return { cfg: saved ? JSON.parse(saved) : structuredClone(defaults), defaults, custom: !!saved }; }
  catch { return { cfg: structuredClone(defaults), defaults, custom: false }; }
}
