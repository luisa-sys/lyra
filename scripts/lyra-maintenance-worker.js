const MAINTENANCE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lyra — Coming Soon</title>
  <meta name="description" content="Lyra is a calm profile platform. Launching soon." />
  <meta name="robots" content="noindex" />
  <meta property="og:title" content="Lyra — Coming Soon" />
  <meta property="og:description" content="A calm profile platform. Launching soon." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&family=DM+Serif+Display&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background-color: #fafaf9;
      color: #1c1917;
      font-family: 'DM Sans', system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
      padding: 2rem;
    }
    .container {
      max-width: 32rem;
      text-align: center;
    }
    .logo {
      font-family: 'DM Serif Display', serif;
      font-size: 2.5rem;
      color: #1c1917;
      letter-spacing: -0.02em;
      margin-bottom: 2rem;
    }
    .sage-dot {
      display: inline-block;
      width: 3rem;
      height: 3rem;
      border-radius: 50%;
      background-color: #6b8f71;
      margin-bottom: 1.5rem;
    }
    h1 {
      font-family: 'DM Serif Display', serif;
      font-size: 2rem;
      font-weight: 400;
      line-height: 1.2;
      margin-bottom: 1rem;
      color: #1c1917;
    }
    .notify-text {
      font-size: 1.125rem;
      line-height: 1.7;
      color: #78716c;
      margin-bottom: 2rem;
    }
    .email-form {
      display: flex;
      gap: 0.5rem;
      max-width: 24rem;
      margin: 0 auto 1rem;
    }
    .email-input {
      flex: 1;
      padding: 0.75rem 1rem;
      border-radius: 9999px;
      border: 1px solid #d6d3d1;
      font-family: 'DM Sans', system-ui, sans-serif;
      font-size: 0.875rem;
      color: #1c1917;
      background: white;
      outline: none;
      transition: border-color 0.2s;
    }
    .email-input:focus {
      border-color: #6b8f71;
    }
    .email-input::placeholder {
      color: #a8a29e;
    }
    .submit-btn {
      padding: 0.75rem 1.5rem;
      border-radius: 9999px;
      background-color: #6b8f71;
      color: white;
      font-family: 'DM Sans', system-ui, sans-serif;
      font-size: 0.875rem;
      font-weight: 500;
      border: none;
      cursor: pointer;
      transition: opacity 0.2s;
      white-space: nowrap;
    }
    .submit-btn:hover { opacity: 0.9; }
    .submit-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .form-message {
      font-size: 0.8125rem;
      margin-top: 0.5rem;
      min-height: 1.25rem;
    }
    .form-message.success { color: #6b8f71; }
    .form-message.error { color: #dc2626; }
    .app-description {
      font-size: 0.9375rem;
      line-height: 1.7;
      color: #78716c;
      margin-bottom: 2rem;
      max-width: 28rem;
      margin-left: auto;
      margin-right: auto;
    }
    .footer {
      margin-top: 3rem;
      font-size: 0.75rem;
      color: #a8a29e;
      display: flex;
      gap: 1.5rem;
      align-items: center;
      flex-wrap: wrap;
      justify-content: center;
    }
    .footer a {
      color: #78716c;
      text-decoration: none;
      transition: color 0.2s;
    }
    .footer a:hover {
      color: #6b8f71;
    }
    @media (max-width: 640px) {
      h1 { font-size: 1.5rem; }
      .notify-text { font-size: 1rem; }
      .logo { font-size: 2rem; }
      .email-form { flex-direction: column; }
      .submit-btn { width: 100%; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">lyra</div>
    <div class="sage-dot"></div>
    <h1>Something calm is coming</h1>
    <p class="notify-text">We're putting the finishing touches on things.</p>
    <p class="app-description">Lyra is a profile platform where you share your preferences, gift ideas, and boundaries — so the people in your life never have to guess. Sign in with Google or email to create your profile, then share it with friends, family, and AI companions.</p>
    <form class="email-form" id="interestForm" method="POST" action="/">
      <input
        type="email"
        name="email"
        class="email-input"
        placeholder="your@email.com"
        required
        autocomplete="email"
        aria-label="Email address"
      />
      <button type="submit" class="submit-btn" id="submitBtn">Notify me</button>
    </form>
    <div class="form-message" id="formMessage" role="status" aria-live="polite"></div>
  </div>
  <div class="footer">
    <span>&copy; 2026 Lyra</span>
    <a href="https://checklyra.com/privacy">Privacy Policy</a>
    <a href="https://checklyra.com/terms">Terms of Service</a>
    <a href="https://checklyra.com/cookies">Cookie Policy</a>
  </div>
  <script>
    document.getElementById('interestForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('submitBtn');
      const msg = document.getElementById('formMessage');
      const email = this.email.value.trim();

      if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
        msg.textContent = 'Please enter a valid email address.';
        msg.className = 'form-message error';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Sending...';
      msg.textContent = '';
      msg.className = 'form-message';

      try {
        const res = await fetch('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (res.ok) {
          msg.textContent = data.message || "Thanks! We'll be in touch.";
          msg.className = 'form-message success';
          this.email.value = '';
          btn.textContent = 'Notify me';
          btn.disabled = false;
        } else {
          msg.textContent = data.error || 'Something went wrong. Please try again.';
          msg.className = 'form-message error';
          btn.textContent = 'Notify me';
          btn.disabled = false;
        }
      } catch (err) {
        msg.textContent = 'Network error. Please try again.';
        msg.className = 'form-message error';
        btn.textContent = 'Notify me';
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;


// Simple in-memory rate limiter — max 5 submissions per IP per hour
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const rateLimitMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return true;
  }
  entry.count++;
  return false;
}

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  if (email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const hostname = url.hostname;

    // Only apply to checklyra.com (not subdomains)
    if (hostname !== 'checklyra.com') {
      return fetch(request);
    }

    // Allow these paths through to Vercel (discovery, SEO, legal)
    const allowedPaths = [
      '/.well-known/',
      '/robots.txt',
      '/sitemap.xml',
      '/llms.txt',
      '/privacy',
      '/terms',
      '/cookies',
      '/auth/'
    ];

    const path = url.pathname;
    for (const allowed of allowedPaths) {
      if (path.startsWith(allowed) || path === allowed) {
        return fetch(request);
      }
    }

    // Handle POST — email interest capture
    if (request.method === 'POST') {
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';

      // Rate limit check
      if (isRateLimited(ip)) {
        return new Response(
          JSON.stringify({ error: 'Too many requests. Please try again later.' }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' } }
        );
      }

      try {
        const body = await request.json();
        const email = (body.email || '').trim().toLowerCase();

        // Server-side email validation
        if (!isValidEmail(email)) {
          return new Response(
            JSON.stringify({ error: 'Please enter a valid email address.' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Check for KV binding
        if (!env.INTEREST_EMAILS) {
          console.error('KV binding INTEREST_EMAILS not configured');
          return new Response(
            JSON.stringify({ error: 'Service temporarily unavailable.' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Check for duplicate
        const existing = await env.INTEREST_EMAILS.get(email);
        if (existing) {
          return new Response(
            JSON.stringify({ message: "You're already on the list! We'll be in touch." }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Store email with timestamp and IP (hashed for privacy)
        const record = JSON.stringify({
          email,
          timestamp: new Date().toISOString(),
          source: 'maintenance-page'
        });

        await env.INTEREST_EMAILS.put(email, record);

        // Send notification email (non-blocking — don't delay the user response)
        if (env.RESEND_API_KEY) {
          try {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: 'Lyra Notifications <notifications@checklyra.com>',
                to: ['luisa@checklyra.com'],
                subject: `New Lyra interest signup: ${email}`,
                html: `<p>Someone just signed up for Lyra launch notifications.</p>
                       <p><strong>Email:</strong> ${email}</p>
                       <p><strong>Time:</strong> ${new Date().toISOString()}</p>
                       <p><strong>Source:</strong> Maintenance page (checklyra.com)</p>`,
              }),
            });
          } catch (notifyErr) {
            // Notification failure should not affect the user — log and continue
            console.error('Failed to send signup notification:', notifyErr);
          }
        }

        return new Response(
          JSON.stringify({ message: "Thanks! We'll let you know when Lyra launches." }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: 'Invalid request.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // Serve maintenance page for GET and everything else
    return new Response(MAINTENANCE_HTML, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex',
      },
    });
  },
};
