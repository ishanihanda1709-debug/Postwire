// Tell the owner about every new sign-up by posting it to a Formspree form (which emails it / keeps a list).
// Only name, email and sign-up details are sent. Never the password. Set SIGNUP_FORM_URL to your Formspree form address to switch it on; leave it empty for no notifications.
// The form address is a setting, not part of the code, so a public copy of the code cannot be used to spam your inbox.
export const signupFormUrl = () => (process.env.SIGNUP_FORM_URL || '').trim();

export async function notifySignup(user, { isOwner = false } = {}) {
  const url = signupFormUrl();
  if (!url || isOwner) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        _subject: `New ${process.env.APP_NAME || 'Postwire'} sign-up: ${user.email}`,
        name: user.name || '',
        email: user.email,
        signedUpAt: user.createdAt || new Date().toISOString(),
        trialEndsAt: user.trialEndsAt || '',
        source: 'app sign-up',
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) console.warn(`Sign-up notification failed: the form answered ${res.status}`);
    return res.ok;
  } catch (e) {
    console.warn(`Sign-up notification failed: ${e.message}`);
    return false;
  }
}
