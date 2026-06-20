import Link from "next/link";

/**
 * KAN-272 — preserved marketing sections.
 *
 * The June-2026 redesign replaced the long marketing landing page with a
 * minimal, Google-like homepage (see src/app/page.tsx). These section
 * components are NOT deleted — they are kept here as reusable building blocks
 * (some are reused on the new /about page, e.g. <AboutTrio>) and remain
 * available should a fuller marketing surface be wanted again. Moving them out
 * of page.tsx is what makes the homepage minimal; the files live on.
 *
 * Components below are the verbatim sections that used to compose page.tsx
 * (KAN-138/156/157/158/159), now exported by name.
 */

/**
 * KAN-272 — the mock-up "About Lyra" trio: 📖 In your own words / 🤝 For real
 * life / 🕊️ Calm by design. Lifted off the old homepage and onto /about per
 * the brief. Styled with the warm tokens.
 */
export function AboutTrio() {
  const points = [
    {
      icon: "📖",
      title: "In your own words",
      desc: "A simple page that says who you are: what you love, what matters, a few honest answers.",
    },
    {
      icon: "🤝",
      title: "For real life",
      desc: "Made for reading about someone you already know — before you meet, or to understand them better.",
    },
    {
      icon: "🕊️",
      title: "Calm by design",
      desc: "No direct messages, no friend requests, no comments, no likes. Nothing to keep up with.",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 not-prose my-8">
      {points.map((p) => (
        <div
          key={p.title}
          className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-accent-soft)] p-6"
        >
          <div className="text-2xl mb-2" aria-hidden="true">
            {p.icon}
          </div>
          <h3 className="font-medium text-[var(--color-ink)] mb-1">{p.title}</h3>
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            {p.desc}
          </p>
        </div>
      ))}
    </div>
  );
}

export function Hero() {
  return (
    <section className="pt-40 pb-24 px-6">
      <div className="max-w-3xl mx-auto text-center">
        <p className="text-sm font-medium tracking-widest uppercase text-[var(--color-lyra-sage)] mb-6">
          A profile that speaks for you
        </p>
        <h1 className="font-[family-name:var(--font-serif)] text-5xl sm:text-6xl lg:text-7xl text-[var(--color-ink)] leading-[1.1] mb-8">
          Let people<br />know you
        </h1>
        <p className="text-lg sm:text-xl text-[var(--color-muted)] leading-relaxed max-w-xl mx-auto mb-12">
          Share your preferences, gift ideas, and boundaries in one place
          — so the people in your life never have to guess.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/signup"
            className="px-8 py-4 rounded-full bg-[var(--color-lyra-sage)] text-white font-medium text-base hover:bg-[var(--color-lyra-sage-hover)] transition-colors shadow-sm"
          >
            Create your profile
          </Link>
          <Link
            href="#how-it-works"
            className="px-8 py-4 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] font-medium text-base hover:border-[var(--color-border)] hover:text-[var(--color-ink)] transition-colors"
          >
            See how it works
          </Link>
        </div>
      </div>
    </section>
  );
}

export function ProfilePreview() {
  return (
    <section className="py-16 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-3xl border border-[var(--color-border)]/80 shadow-sm p-8 sm:p-12">
          <div className="flex flex-col sm:flex-row gap-8 items-start">
            <div className="w-20 h-20 rounded-full bg-[var(--color-lyra-sage-light)] flex items-center justify-center text-2xl font-[family-name:var(--font-serif)] text-[var(--color-lyra-sage)]">
              SA
            </div>
            <div className="flex-1 space-y-6">
              <div>
                <h3 className="font-[family-name:var(--font-serif)] text-2xl text-[var(--color-ink)]">Sarah Ashworth</h3>
                <p className="text-[var(--color-muted)] mt-1">Mum of two, book lover, based in Manchester</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-lyra-sage)] mb-3">Gift ideas</h4>
                  <div className="space-y-2">
                    <span className="inline-block px-3 py-1.5 bg-[var(--color-lyra-sage-50)] text-[var(--color-ink)] text-sm rounded-full">Waterstones gift card</span>
                    <span className="inline-block px-3 py-1.5 bg-[var(--color-lyra-sage-50)] text-[var(--color-ink)] text-sm rounded-full ml-2">Toast clothing</span>
                    <span className="inline-block px-3 py-1.5 bg-[var(--color-lyra-sage-50)] text-[var(--color-ink)] text-sm rounded-full">Spa experiences</span>
                  </div>
                </div>
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-lyra-blush)] mb-3">Please avoid</h4>
                  <div className="space-y-2">
                    <span className="inline-block px-3 py-1.5 bg-red-50 text-[var(--color-muted)] text-sm rounded-full">Scented candles</span>
                    <span className="inline-block px-3 py-1.5 bg-red-50 text-[var(--color-muted)] text-sm rounded-full ml-2">Novelty mugs</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <p className="text-center text-sm text-[var(--color-muted)] mt-6">
          An example Lyra profile — yours will be uniquely you
        </p>
      </div>
    </section>
  );
}

export function HowItWorks() {
  const steps = [
    {
      number: "01",
      title: "Share what matters",
      description: "Add your likes, dislikes, gift ideas, boundaries, and the little things that make you, you.",
      color: "var(--color-lyra-sage)",
    },
    {
      number: "02",
      title: "Publish your profile",
      description: "Get a clean, shareable link at checklyra.com/your-name that anyone can visit.",
      color: "var(--color-lyra-warm)",
    },
    {
      number: "03",
      title: "People check before they guess",
      description: "Friends, family, and colleagues can look you up before buying a gift or making plans.",
      color: "var(--color-lyra-blush)",
    },
  ];

  return (
    <section id="how-it-works" className="py-24 px-6 bg-white">
      <div className="max-w-4xl mx-auto">
        <h2 className="font-[family-name:var(--font-serif)] text-3xl sm:text-4xl text-[var(--color-ink)] text-center mb-4">
          Three steps to being understood
        </h2>
        <p className="text-[var(--color-muted)] text-center mb-16 max-w-lg mx-auto">
          No accounts needed to view your profile. No social features. Just a quiet page that helps.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          {steps.map((step) => (
            <div key={step.number} className="text-center sm:text-left">
              <div
                className="inline-block text-sm font-semibold mb-4 px-3 py-1 rounded-full"
                style={{ backgroundColor: step.color + "18", color: step.color }}
              >
                {step.number}
              </div>
              <h3 className="text-lg font-medium text-[var(--color-ink)] mb-2">{step.title}</h3>
              <p className="text-[var(--color-muted)] text-sm leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Sections() {
  const sections = [
    { icon: "🎁", title: "Gift ideas", desc: "What you actually want — specific shops, experiences, price ranges" },
    { icon: "💛", title: "Likes & interests", desc: "Hobbies, passions, guilty pleasures, and current obsessions" },
    { icon: "🚫", title: "Things to avoid", desc: "Allergies, dislikes, gifts that miss the mark" },
    { icon: "🤝", title: "Boundaries", desc: "Communication preferences, visiting etiquette, comfort levels" },
    { icon: "📝", title: "Helpful to know", desc: "Dietary needs, sizing, the little details that matter" },
    { icon: "🔗", title: "Links & wishlists", desc: "Direct links to your favourite shops and wishlist pages" },
  ];

  return (
    <section className="py-24 px-6">
      <div className="max-w-4xl mx-auto">
        <h2 className="font-[family-name:var(--font-serif)] text-3xl sm:text-4xl text-[var(--color-ink)] text-center mb-4">
          Everything in one place
        </h2>
        <p className="text-[var(--color-muted)] text-center mb-16 max-w-lg mx-auto">
          Your profile has space for all the things people should know — organised into sections that make sense.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {sections.map((s) => (
            <div key={s.title} className="bg-white rounded-2xl border border-[var(--color-border)]/80 p-6 hover:shadow-sm transition-shadow">
              <div className="text-2xl mb-3">{s.icon}</div>
              <h3 className="font-medium text-[var(--color-ink)] mb-1">{s.title}</h3>
              <p className="text-sm text-[var(--color-muted)] leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function UseCases() {
  const cases = [
    {
      title: "Parents",
      desc: "Invite your children’s teachers to create a quick profile. End-of-term gifts become easy instead of stressful. Two minutes is all it takes.",
    },
    {
      title: "Friends & family",
      desc: "Birthdays, Christmas, just because. Stop guessing. Check their Lyra profile and find something they’ll actually love.",
    },
    {
      title: "Colleagues",
      desc: "New team member? Secret Santa? Share preferences and boundaries without the awkward conversations.",
    },
    {
      title: "Teachers & carers",
      desc: "A simple way to let parents know what you’d appreciate — without asking. Just share your profile link.",
    },
  ];

  return (
    <section className="py-24 px-6 bg-white">
      <div className="max-w-4xl mx-auto">
        <h2 className="font-[family-name:var(--font-serif)] text-3xl sm:text-4xl text-[var(--color-ink)] text-center mb-4">
          Who it&apos;s for
        </h2>
        <p className="text-[var(--color-muted)] text-center mb-16 max-w-lg mx-auto">
          Anyone who&apos;s ever thought &ldquo;I wish they just knew what I wanted.&rdquo; Which is everyone.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-8 max-w-3xl mx-auto">
          {cases.map((c) => (
            <div key={c.title}>
              <h3 className="font-medium text-[var(--color-ink)] mb-2">{c.title}</h3>
              <p className="text-sm text-[var(--color-muted)] leading-relaxed">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function WhatLyraIsNot() {
  // KAN-156: anti-social features.
  // KAN-154-A: explicit privacy trust signal — surfaces the no-contact-display
  // promise alongside the existing anti-social "no" list.
  const items = [
    "No display of email, phone, or contact details (opt-in discovery only)",
    "No likes, followers, or feeds",
    "No friend requests, direct or group messages",
    "No algorithms deciding what you see",
    "No pressure to post or engage",
    "No selling your data",
    "No notifications or FOMO",
    "No endless scrolling",
  ];

  return (
    <section className="py-24 px-6">
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="font-[family-name:var(--font-serif)] text-3xl sm:text-4xl text-[var(--color-ink)] mb-12">
          What Lyra is not
        </h2>
        <div className="space-y-4">
          {items.map((item) => (
            <div
              key={item}
              className="flex items-center gap-3 text-left max-w-md mx-auto"
            >
              <span className="text-[var(--color-lyra-blush)] font-semibold text-sm shrink-0">No</span>
              <span className="text-[var(--color-muted)] text-sm">{item.replace(/^No /, "")}</span>
            </div>
          ))}
          {/* KAN-156: positive counterpoint to the No list. */}
          <div className="flex items-center gap-3 text-left max-w-md mx-auto pt-2">
            <span className="text-[var(--color-lyra-sage)] font-semibold text-sm shrink-0" aria-hidden="true">✓</span>
            <span className="text-[var(--color-ink)] text-sm font-medium">Only see what you want to see</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * KAN-157: About Lyra — mission statement + practical use cases.
 */
export function AboutLyra() {
  const useCases = [
    "Gift-giving — know what people actually want",
    "Understanding sensitive topics before conversations",
    "Finding common interests and things you share",
    "Learning from tips and recommendations others share",
    "Understanding house rules before visiting someone",
    "Anything else that improves relationships offline",
  ];

  return (
    <section id="about" className="py-24 px-6 bg-[var(--color-accent-soft)]">
      <div className="max-w-3xl mx-auto text-center">
        <p className="text-sm font-medium tracking-widest uppercase text-[var(--color-lyra-sage)] mb-4">
          About Lyra
        </p>
        <h2 className="font-[family-name:var(--font-serif)] text-3xl sm:text-4xl text-[var(--color-ink)] mb-6">
          For real-life relationships, not screen time
        </h2>
        <p className="text-[var(--color-muted)] leading-relaxed mb-12 max-w-xl mx-auto">
          Lyra exists to improve people&apos;s relationships in real life — not to make them
          spend time online. There&apos;s nothing to scroll, no feed to refresh, no metrics to chase.
          Just a quiet profile that helps the people you care about know you a little better.
        </p>
        <ul className="text-left max-w-2xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-3">
          {useCases.map((u) => (
            <li key={u} className="flex items-start gap-3 text-[var(--color-muted)] text-sm leading-relaxed">
              <span className="text-[var(--color-lyra-sage)] font-semibold shrink-0 mt-0.5" aria-hidden="true">→</span>
              <span>{u}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * KAN-158: ParentTeacherCallout — both audiences side-by-side.
 */
export function ParentTeacherCallout() {
  return (
    <section className="py-16 px-6">
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-2xl border-2 border-[var(--color-lyra-sage-light)] bg-[var(--color-lyra-sage-50)] p-8 sm:p-10 text-center flex flex-col">
          <h2 className="font-[family-name:var(--font-serif)] text-2xl text-[var(--color-ink)] mb-4">
            Are you a parent?
          </h2>
          <p className="text-[var(--color-muted)] leading-relaxed mb-4 max-w-lg mx-auto flex-1">
            End of year is coming. Instead of guessing what your children&apos;s teachers would like,
            invite them to create a Lyra profile. It takes two minutes &mdash; just gift ideas and
            things to avoid &mdash; and it makes everything easier for everyone.
          </p>
          <p className="text-sm text-[var(--color-muted)] italic mb-6 max-w-md mx-auto">
            &ldquo;Hi! I&apos;m using Lyra to help people know what I&apos;d appreciate.
            It only takes a couple of minutes. Here&apos;s where you can create yours&hellip;&rdquo;
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-3 rounded-full bg-[var(--color-lyra-sage)] text-white font-medium text-sm hover:bg-[var(--color-lyra-sage-hover)] transition-colors"
          >
            Create your free profile
          </Link>
        </div>
        <div className="rounded-2xl border-2 border-[var(--color-lyra-warm-light,#E8DFD3)] bg-[var(--color-lyra-warm-50,#FAF6F0)] p-8 sm:p-10 text-center flex flex-col">
          <h2 className="font-[family-name:var(--font-serif)] text-2xl text-[var(--color-ink)] mb-4">
            Are you a teacher?
          </h2>
          <p className="text-[var(--color-muted)] leading-relaxed mb-4 max-w-lg mx-auto flex-1">
            Share the gifts you really want and make it easy for parents to venture outside
            chocolate and wine. End-of-year gifts become easy and more likely to be really
            needed or appreciated. Two minutes is all it takes.
          </p>
          <p className="text-sm text-[var(--color-muted)] italic mb-6 max-w-md mx-auto">
            &ldquo;Thanks for thinking of me! Here&apos;s a quick Lyra profile of things I&apos;d love.&rdquo;
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-3 rounded-full bg-[var(--color-lyra-warm,#B89F7A)] text-white font-medium text-sm hover:opacity-90 transition-opacity"
          >
            Create your free profile
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * KAN-159: two motivational sections.
 */
export function WishKnowFindFirstHand() {
  const cards = [
    {
      title: "Wish people just knew?",
      desc: "If there is something you want others to know but it feels awkward to deliver unrequested, add it here and send a hint.",
      bgVar: "var(--color-lyra-blush-50, #FCF3F2)",
      borderVar: "var(--color-lyra-blush-light, #F2D9D5)",
    },
    {
      title: "Want to find information first hand?",
      desc: "No longer depend on guesses or others to find out what matters to someone you want to please. Ask them for their Lyra profile.",
      bgVar: "var(--color-lyra-sage-50)",
      borderVar: "var(--color-lyra-sage-light)",
    },
  ];

  return (
    <section className="py-16 px-6">
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
        {cards.map((c) => (
          <div
            key={c.title}
            className="rounded-2xl border-2 p-8 sm:p-10 text-center flex flex-col"
            style={{ borderColor: c.borderVar, backgroundColor: c.bgVar }}
          >
            <h2 className="font-[family-name:var(--font-serif)] text-2xl text-[var(--color-ink)] mb-4">
              {c.title}
            </h2>
            <p className="text-[var(--color-muted)] leading-relaxed max-w-lg mx-auto">
              {c.desc}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CTA() {
  return (
    <section className="py-24 px-6 bg-[var(--color-lyra-sage-50)]">
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="font-[family-name:var(--font-serif)] text-3xl sm:text-4xl text-[var(--color-ink)] mb-4">
          Ready to be understood?
        </h2>
        <p className="text-[var(--color-muted)] mb-8 max-w-md mx-auto">
          Create your Lyra profile in minutes. It&apos;s free, calm, and entirely yours.
        </p>
        <Link
          href="/signup"
          className="inline-block px-8 py-4 rounded-full bg-[var(--color-lyra-sage)] text-white font-medium text-base hover:bg-[var(--color-lyra-sage-hover)] transition-colors shadow-sm"
        >
          Create your profile
        </Link>
      </div>
    </section>
  );
}
