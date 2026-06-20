/**
 * Homepage content tests
 *
 * KAN-138: original — restore marketing homepage content.
 * KAN-272: the June-2026 redesign replaced the long marketing landing page
 *   with a MINIMAL, Google-like homepage (centred green logo + "Be
 *   understood." + two CTAs, then a live "A few people to meet" grid). The
 *   marketing section components were NOT deleted — they were moved to
 *   src/app/_marketing/sections.tsx (preserved as files) and the "trio" moved
 *   to the /about page. These tests now assert (a) the new minimal homepage,
 *   and (b) that the marketing sections are preserved in the module.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const homepagePath = path.join(root, 'src/app/page.tsx');
const marketingPath = path.join(root, 'src/app/_marketing/sections.tsx');
const aboutPath = path.join(root, 'src/app/(legal)/about/page.tsx');

describe('KAN-272: Minimal homepage (June-2026 redesign)', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(homepagePath, 'utf8');
  });

  test('homepage file exists', () => {
    expect(fs.existsSync(homepagePath)).toBe(true);
  });

  test('renders the green logo image (centred hero)', () => {
    expect(content).toContain('/lyra-logo.png');
    expect(content).toContain('next/image');
  });

  test('shows the "Be understood." tagline', () => {
    expect(content).toContain('Be understood.');
  });

  test('has the two hero CTAs — primary "Find someone" and ghost "See example profiles"', () => {
    expect(content).toContain('Find someone');
    expect(content).toContain('See example profiles');
    // Primary CTA targets search.
    expect(content).toContain('href="/search"');
  });

  test('queries up to 6 published profiles for the "A few people to meet" band', () => {
    expect(content).toContain('A few people to meet');
    expect(content).toContain('is_published');
    expect(content).toContain('.limit(6)');
  });

  test('nav matches the mock-up — Home / Find someone / Create your profile + de-emphasised Sign in', () => {
    expect(content).toMatch(/>\s*Home\s*</);
    expect(content).toContain('Find someone');
    expect(content).toContain('Create your profile');
    expect(content).toContain('Sign in');
  });

  test('keeps the WebSite JSON-LD structured data (SEO)', () => {
    expect(content).toContain('application/ld+json');
    expect(content).toContain('WebSite');
  });

  test('does NOT render an inline <footer> (the site-wide footer lives in the root layout)', () => {
    // The minimal homepage must not paint its own footer — that would double
    // the site-wide footer added in layout.tsx (KAN-272 gap D).
    expect(content).not.toMatch(/<footer/);
  });

  test('no longer composes the long marketing sections inline', () => {
    // The marketing sections were moved to _marketing/sections.tsx. They must
    // not be defined or rendered in page.tsx any more.
    expect(content).not.toContain('function Hero');
    expect(content).not.toContain('<ParentTeacherCallout');
    expect(content).not.toContain('<WishKnowFindFirstHand');
  });
});

describe('KAN-272: Marketing sections preserved as files', () => {
  let marketing;

  beforeAll(() => {
    marketing = fs.readFileSync(marketingPath, 'utf8');
  });

  test('_marketing/sections.tsx exists', () => {
    expect(fs.existsSync(marketingPath)).toBe(true);
  });

  test('preserves the previously-composed marketing components', () => {
    for (const name of [
      'Hero',
      'AboutLyra',
      'ProfilePreview',
      'HowItWorks',
      'Sections',
      'UseCases',
      'WhatLyraIsNot',
      'ParentTeacherCallout',
      'WishKnowFindFirstHand',
      'CTA',
    ]) {
      expect(marketing).toContain(`export function ${name}`);
    }
  });

  test('UseCases still includes all four audience segments', () => {
    expect(marketing).toContain('Parents');
    expect(marketing).toContain('Friends');
    expect(marketing).toContain('Colleagues');
    expect(marketing).toContain('Teachers');
  });

  test('WhatLyraIsNot still includes the KAN-156 anti-social items', () => {
    expect(marketing).toContain('No friend requests, direct or group messages');
    expect(marketing).toContain('No endless scrolling');
    expect(marketing).toContain('Only see what you want to see');
    expect(marketing).toContain('followers');
    expect(marketing).toContain('algorithms');
    expect(marketing).toContain('notifications');
  });

  test('ParentTeacherCallout still references both audiences with KAN-156 copy', () => {
    expect(marketing).toContain('Are you a parent?');
    expect(marketing).toContain('Are you a teacher?');
    expect(marketing).toContain('End of year');
  });

  test('WishKnowFindFirstHand sections preserved', () => {
    expect(marketing).toContain('Wish people just knew?');
    expect(marketing).toContain('Want to find information first hand?');
  });

  test('exports the AboutTrio (📖 / 🤝 / 🕊️) used on the /about page', () => {
    expect(marketing).toContain('export function AboutTrio');
    expect(marketing).toContain('In your own words');
    expect(marketing).toContain('For real life');
    expect(marketing).toContain('Calm by design');
  });
});

describe('KAN-272: About page hosts the moved trio', () => {
  let about;

  beforeAll(() => {
    about = fs.readFileSync(aboutPath, 'utf8');
  });

  test('about page exists and renders AboutTrio', () => {
    expect(fs.existsSync(aboutPath)).toBe(true);
    expect(about).toContain('AboutTrio');
  });
});

describe('KAN-273/287: Production waitlist front door', () => {
  let home;
  let signup;
  const signupPath = path.join(root, 'src/app/(auth)/signup/page.tsx');

  beforeAll(() => {
    home = fs.readFileSync(homepagePath, 'utf8');
    signup = fs.readFileSync(signupPath, 'utf8');
  });

  test('homepage gates a waitlist landing on the prod deploy, with a ?preview=waitlist hatch', () => {
    expect(home).toContain('isProdDeploy');
    expect(home).toContain('WaitlistLanding');
    // Preview hatch so the prod landing is verifiable on non-prod deploys.
    expect(home).toContain('preview === "waitlist"');
  });

  test('homepage waitlist landing leads with "join the waitlist" → /signup', () => {
    expect(home).toContain('Join the waitlist');
    expect(home).toContain('opening Lyra a few people at a time');
    expect(home).toContain('href="/signup"');
  });

  test('the default (non-prod) homepage is unchanged — product homepage preserved', () => {
    // The prod branch must be ADDITIVE: dev/stage/beta keep the product home.
    expect(home).toContain('Be understood.');
    expect(home).toContain('Find someone');
    expect(home).toContain('A few people to meet');
  });

  test('signup page reframes as "join the waitlist" on prod / preview', () => {
    expect(signup).toContain('isProdDeploy');
    expect(signup).toContain('Join the Lyra waitlist');
    expect(signup).toContain('Join the waitlist');
    // Default copy preserved for the non-prod path.
    expect(signup).toContain('Create your profile');
    expect(signup).toContain('Create account');
  });
});
