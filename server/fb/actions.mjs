// Login detection ported from scripts/trial.mjs (proven on the real site). baseUrl is a parameter so tests can use a fake page on 127.0.0.1.
// c_user is set before email-code / 2FA / checkpoint steps finish, so it alone never means "logged in"
export const GATE=/\/(checkpoint|confirmemail\.php|two_step_verification|two_factor|login|recover|authentication|device-based)/i;
const bare=h=>h.replace(/^www\./,'');
// the page must be on the site itself (or a subdomain): about:blank or an error page with an old c_user cookie is not "logged in"
function onSite(url,baseUrl){
  try{const h=bare(new URL(url).hostname),b=bare(new URL(baseUrl).hostname);return h===b||h.endsWith('.'+b);}catch{return false;}
}
export async function ownProfileId(ctx,baseUrl){
  const c=(await ctx.cookies(baseUrl)).find(c=>c.name==='c_user');
  return c?.value||null;
}
// any error (page or context closed, navigation in flight) means we cannot tell: 'unknown'
export async function loginState(ctx,page,baseUrl){
  try{
    if(page.isClosed())return 'unknown';
    const url=page.url();
    if(!onSite(url,baseUrl))return 'unknown';
    if(GATE.test(url))return /\/login|recover/i.test(url)?'logged_out':'checkpoint';
    if(!await ownProfileId(ctx,baseUrl))return 'logged_out';
    if(await page.locator('input[name="pass"]').count())return 'logged_out';
    return 'logged_in';
  }catch{return 'unknown';}
}
