import Link from "next/link";
import { SaathLogo } from "@/components/SaathLogo";
import { HeroSupportPathsReveal } from "@/components/landing/HeroSupportPathsReveal";
import { LiveSahayakShowcase } from "@/components/landing/LiveSahayakShowcase";
import { LiveVoiceCheckInShowcase } from "@/components/landing/LiveVoiceCheckInShowcase";
import { LiveCaseTrackingShowcase } from "@/components/landing/LiveCaseTrackingShowcase";
// import { HumanSupportScrollSection } from "@/components/landing/HumanSupportScrollSection";
import {
  ArrowRight,
  Lock,
  Smile,
  Users,
  LineChart,
  CheckCircle2,
  PhoneCall,
  KeyRound,
  ShieldCheck,
  Scale,
  ShieldAlert,
  EyeOff,
  UserCheck,
  Activity,
  HeartHandshake,
} from "lucide-react";

/* â”€â”€â”€ DATA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */


const STEPS = [
  { num: "01", title: "CHECK IN", desc: "A private moment to note how you are feeling over text or voice note." },
  { num: "02", title: "UNDERSTAND", desc: "Notice patterns in your emotional state over time with clear, gentle insight." },
  { num: "03", title: "CONNECT", desc: "Stay linked to your assigned counsellor who receives context at your pace." },
  { num: "04", title: "ACCESS RIGHTS", desc: "Verify PoA relief, legal aid, and welfare provisions without bureaucracy." },
  { num: "05", title: "KEEP MOVING", desc: "No forced timelines. A space that stays with you as long as you need." },
];

const PRIVACY = [
  { tag: "Consent first", title: "You stay in control", desc: "Every interaction is voluntary. Zero mandatory logs, zero hidden tracking.", icon: UserCheck },
  { tag: "Private by design", title: "Data isolation", desc: "Your identity and health logs live in encrypted silos. No commercial profiling.", icon: Lock },
  { tag: "Human review", title: "AI assists, people care", desc: "Critical wellbeing decisions are always reviewed by qualified human counsellors.", icon: HeartHandshake },
  { tag: "No forced disclosure", title: "Reflect without fear", desc: "Using grounding tools never triggers automatic police escalation or intervention.", icon: EyeOff },
];

const METRICS = [
  { value: "100%", label: "Consent-led", detail: "Zero mandatory reporting" },
  { value: "24/7", label: "Crisis support", detail: "Via national helplines" },
  { value: "3-tier", label: "Support architecture", detail: "Survivor Â· Counsellor Â· State" },
  { value: "10+", label: "Regional languages", detail: "Voice & text check-in" },
];

/* â”€â”€â”€ COMPONENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export default function LandingPage() {
  return (
    <div className="relative min-h-screen bg-[#faf8f5] text-[#172326]" style={{ fontFamily: '"Inter", "DM Sans", ui-sans-serif, system-ui, sans-serif' }}>

      {/* Atmosphere: very restrained warm glows */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-[16%] left-1/2 -translate-x-1/2 h-[700px] w-[1000px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(220,235,221,0.42),transparent_68%)] blur-3xl" />
        <div className="absolute top-[55%] right-[-8%] h-[460px] w-[460px] rounded-full bg-[radial-gradient(circle_at_center,rgba(91,141,184,0.06),transparent_70%)] blur-3xl" />
      </div>

      {/* ── NAVIGATION ───────────────────────────── */}
      <header className="sticky top-0 z-50 w-full border-b border-[#c8d3d0]/70 bg-[#faf8f5] transition-all duration-200">
        <div className="mx-auto max-w-7xl px-6 py-3.5 sm:px-10 sm:py-4">
          <nav className="flex items-center justify-between" aria-label="Main">
            {/* Extreme left: Logo and primary navigation links */}
            <div className="flex items-center gap-6 sm:gap-8 md:gap-10">
              <a
                href="#hero"
                className="flex items-center gap-2.5 sm:gap-3 group shrink-0"
              >
                <SaathLogo className="h-8 w-auto transition-transform duration-200 group-hover:scale-[1.04]" size={34} />
                <span className="font-display text-[1.5rem] sm:text-[1.6rem] font-normal tracking-tight text-[#0f766e]">SAATH</span>
              </a>

              {/* Navigation links directly beside the logo */}
              <div className="flex items-center gap-5 sm:gap-7">
                <a
                  href="#features"
                  className="saath-nav-link text-[13px] sm:text-[13.5px] font-medium tracking-[0.01em] text-[#46565a] transition-colors duration-200"
                >
                  Features
                </a>
                <a
                  href="#how-it-works"
                  className="saath-nav-link text-[13px] sm:text-[13.5px] font-medium tracking-[0.01em] text-[#46565a] transition-colors duration-200"
                >
                  How It Works
                </a>
                <a
                  href="#privacy"
                  className="saath-nav-link text-[13px] sm:text-[13.5px] font-medium tracking-[0.01em] text-[#46565a] transition-colors duration-200"
                >
                  Privacy
                </a>
                <a
                  href="#human-connection"
                  className="saath-nav-link text-[13px] sm:text-[13.5px] font-medium tracking-[0.01em] text-[#46565a] transition-colors duration-200"
                >
                  Human Connection
                </a>
                <Link
                  href="/about"
                  className="saath-nav-link text-[13px] sm:text-[13.5px] font-medium tracking-[0.01em] text-[#46565a] transition-colors duration-200"
                >
                  About
                </Link>
              </div>
            </div>

            {/* Extreme right: User Log In (black text link) and Admin Log In button */}
            <div className="flex items-center gap-5 sm:gap-6 shrink-0">
              <Link
                href="/connect-case"
                className="text-[13px] sm:text-[13.5px] font-medium text-[#172326] transition-colors duration-200 hover:text-[#0f766e]"
              >
                User Log In
              </Link>
              <Link
                href="/staff-login?tab=admin"
                className="inline-flex items-center justify-center rounded-full bg-[#0f766e] px-4 py-1.5 sm:py-2 text-[12.5px] sm:text-[13px] font-semibold text-white shadow-xs transition-all duration-200 hover:bg-[#0c6460] hover:shadow-sm"
              >
                Admin Log In
              </Link>
            </div>
          </nav>
        </div>
      </header>

      {/* ── HERO ──────────────────────────────────── */}
      <section id="hero" className="relative z-20 w-full min-h-[calc(100vh-68px)] flex flex-col justify-center pb-14 pt-8 scroll-mt-20 overflow-hidden">
        {/* Subtle organic mouse morph-reveal behind hero */}
        <HeroSupportPathsReveal />

        <div className="relative z-10 mx-auto max-w-4xl px-6 text-center sm:px-10 w-full">
          {/* Headline — Instrument Serif, mixed weight treatment */}
          <h1
            className="mx-auto mt-2 max-w-3xl leading-[1.06] tracking-tight"
            style={{
              fontFamily: '"Instrument Serif", "DM Serif Display", Georgia, serif',
              fontSize: "clamp(2.4rem, 5.5vw, 3.75rem)",
            }}
          >
            <span className="block font-normal text-[#1c2b2e]">You do not have to</span>
            <span className="block italic text-[#0f766e] mt-0.5">carry it alone.</span>
          </h1>

          {/* Sub-copy */}
          <p className="mx-auto mt-5 max-w-xl text-[15px] leading-[1.65] text-[#46565a] sm:text-[16px]">
            SAATH gives survivors a private space to check in, understand how they are doing, stay connected to support, and{" "}
            <strong className="font-semibold text-[#1c2b2e]">move forward at their own pace.</strong>
          </p>

          {/* CTAs */}
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/welcome"
              className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#0f766e] px-7 py-3 text-[14px] font-semibold text-white shadow-sm transition-all duration-200 hover:bg-[#0c6460] hover:shadow-md sm:w-auto"
            >
              Enter survivor space
              <ArrowRight size={15} className="transition-transform duration-200 group-hover:translate-x-[3px]" />
            </Link>
            <Link
              href="/about"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#0f766e]/35 bg-transparent px-7 py-3 text-[14px] font-medium text-[#0f766e] transition-all duration-200 hover:border-[#0f766e]/70 hover:bg-[#dcebdd]/30 sm:w-auto"
            >
              How SAATH protects you
            </Link>
          </div>
        </div>
      </section>

      {/* ── LIVE FEATURE 01: SAHAYAK AI COMPANION ── */}
      <LiveSahayakShowcase id="features" />

      {/* ── LIVE FEATURE 02: VOICE CHECK-IN ── */}
      <LiveVoiceCheckInShowcase id="voice-feature" />

      {/* ── LIVE FEATURE 03: LIVE CASE TRACKING ── */}
      <LiveCaseTrackingShowcase id="case-tracking-feature" />



      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="relative z-20 mx-auto max-w-7xl px-6 py-16 sm:px-10 sm:py-20 scroll-mt-20">
        <div className="mb-12 max-w-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0f766e]"></p>
          <h2
            className="mt-3 leading-[1.1] tracking-tight text-[#1c2b2e]"
            style={{
              fontFamily: '"Instrument Serif", "DM Serif Display", Georgia, serif',
              fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)",
            }}
          >
            Support doesn't happen<br />
            <em className="italic text-[#0f766e]">all at once.</em>
          </h2>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map(({ num, title, desc }) => (
            <div key={num} className="rounded-xl border border-[#c8d3d0]/60 bg-white/80 p-5 hover:border-[#0f766e]/40 hover:shadow-sm transition-all duration-200">
              <span
                className="block text-[2rem] italic text-[#0f766e] leading-none"
                style={{ fontFamily: '"Instrument Serif", "DM Serif Display", Georgia, serif' }}
              >
                {num}
              </span>
              <h3 className="mt-3 text-[14px] font-semibold text-[#1c2b2e] leading-snug">{title}</h3>
              <p className="mt-1.5 text-[12.5px] leading-[1.6] text-[#61706d]">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── PRIVACY ───────────────────────────────── */}
      <section id="privacy" className="relative z-20 mx-auto max-w-7xl px-6 py-16 sm:px-10 sm:py-20 scroll-mt-20">
        <div className="mb-10 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2
              className="mt-3 text-[#1c2b2e] leading-tight"
              style={{
                fontFamily: '"Instrument Serif", "DM Serif Display", Georgia, serif',
                fontSize: "clamp(1.7rem, 3vw, 2.4rem)",
              }}
            >
              Your data is <em className="italic text-[#0f766e]">yours.</em>
            </h2>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PRIVACY.map(({ tag, title, desc, icon: Icon }) => (
            <div key={tag} className="rounded-2xl border border-[#c8d3d0]/60 bg-white p-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f4f6ec] text-[#0f766e]">
                <Icon size={18} />
              </div>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0f766e]">{tag}</p>
              <h3 className="mt-1.5 text-[15px] font-semibold text-[#1c2b2e] leading-snug">{title}</h3>
              <p className="mt-2 text-[12.5px] leading-[1.65] text-[#46565a]">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── HUMAN SUPPORT ── */}
      <section id="human-connection" className="relative z-20 mx-auto max-w-7xl px-6 py-16 sm:px-10 sm:py-20 scroll-mt-20">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0f766e]">Human connection</p>
            <h2
              className="mt-3 leading-[1.08] text-[#1c2b2e]"
              style={{
                fontFamily: '"Instrument Serif", "DM Serif Display", Georgia, serif',
                fontSize: "clamp(1.7rem, 3vw, 2.5rem)",
              }}
            >
              Technology can listen.{" "}
              <em style={{ fontStyle: "italic", color: "#0f766e" }}>People still matter.</em>
            </h2>
            <p className="mt-4 text-[14px] leading-[1.7] text-[#46565a]">
              SAATH supports care networks rather than replacing them. District welfare counsellors get the context they need to reach you â€” when you are ready.
            </p>
            <ul className="mt-5 space-y-2.5">
              {[
                "Dedicated district counsellor allocation",
                "Trauma-informed follow-up protocols",
                "Linkage to statutory PoA rehabilitation schemes",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-[13px] font-medium text-[#1c2b2e]">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[#0f766e]" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-[#c8d3d0]/60 bg-[#162924] p-8 text-white sm:p-10">
            <div className="flex items-center gap-2.5 text-[#7faf86]">
              
              
            </div>
            <h3
              className="mt-4 font-normal text-white leading-snug"
              style={{
                fontFamily: '"Instrument Serif", "DM Serif Display", Georgia, serif',
                fontSize: "clamp(1.3rem, 2.5vw, 1.7rem)",
              }}
            >
              Support that stays beyond legal timelines.
            </h3>
            <p className="mt-3 text-[13px] leading-[1.7] text-white/75">
              Cases move through institutional calendars. Personal recovery moves on human time. SAATH ensures you are never lost in bureaucratic transitions.
            </p>
            <div className="mt-7 border-t border-white/10 pt-5 flex items-center justify-between">
              <span className="text-[12px] text-white/50">Ready to enter your space?</span>
              <Link
                href="/welcome"
                className="group inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#7faf86] hover:text-white transition-colors duration-200"
              >
                Enter SAATH
                <ArrowRight size={13} className="transition-transform duration-200 group-hover:translate-x-[3px]" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* â”€â”€ METRICS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <section className="relative z-20 mx-auto max-w-7xl px-6 py-12 sm:px-10 border-t border-[#c8d3d0]/50">
        <div className="grid grid-cols-2 gap-y-8 lg:grid-cols-4 divide-[#c8d3d0]/40 sm:divide-x">
          {METRICS.map(({ value, label, detail }) => (
            <div key={label} className="px-6 text-center sm:text-left first:pl-0">
              <p
                className="italic text-[#0f766e] leading-none"
                style={{
                  fontFamily: '"Instrument Serif", "DM Serif Display", Georgia, serif',
                  fontSize: "clamp(2rem, 4vw, 3rem)",
                }}
              >
                {value}
              </p>
              <p className="mt-1.5 text-[14px] font-semibold text-[#1c2b2e]">{label}</p>
              <p className="mt-0.5 text-[12px] text-[#61706d]">{detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* â”€â”€ EMERGENCY BAND â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <section className="relative z-20 mx-auto max-w-7xl px-6 py-6 sm:px-10">
        <div className="flex flex-col items-start justify-between gap-5 rounded-xl border border-[#e8cdc9] bg-[#fdf6f5] p-6 md:flex-row md:items-center md:p-7">
          <div className="flex items-start gap-4">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f7e2dd] text-[#b86a59]">
              <ShieldAlert size={20} />
            </div>
            <div>
              <p className="text-[14px] font-semibold text-[#1c2b2e]">In immediate danger?</p>
              <p className="mt-0.5 text-[12.5px] leading-[1.6] text-[#61706d]">
                Toll-free national helplines available 24 hours with confidential first responders.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href="tel:112"
              className="inline-flex items-center gap-2 rounded-full bg-[#b86a59] px-5 py-2.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#a05449]"
            >
               National emergency: 112
            </a>
            <a
              href="tel:14566"
              className="inline-flex items-center gap-2 rounded-full border border-[#c8d3d0] bg-white px-5 py-2.5 text-[12.5px] font-semibold text-[#172326] transition-all hover:border-[#b86a59]/40 hover:bg-[#fdf6f5]"
            >
              NHAA Atrocity Helpline: 14566
            </a>
          </div>
        </div>
      </section>

      {/* â”€â”€ FINAL CTA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <section className="relative z-20 mx-auto max-w-7xl px-6 py-16 sm:px-10 sm:py-20 border-t border-[#c8d3d0]/50">
        <div className="rounded-2xl bg-[#0f766e] p-10 text-center sm:p-14">
          
          <h2
            className="mx-auto mt-3 max-w-lg font-normal text-white leading-[1.1]"
            style={{
              fontFamily: '"Instrument Serif", "DM Serif Display", Georgia, serif',
              fontSize: "clamp(1.9rem, 4vw, 3rem)",
            }}
          >
            Support that stays with you.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-[14px] leading-[1.65] text-white/75">
            Move forward at your own pace, with a space built around dignity, privacy and genuine human care.
          </p>
          <div className="mt-8 flex justify-center">
            <Link
              href="/welcome"
              className="group inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-[14px] font-semibold text-[#0f766e] shadow-sm transition-all duration-200 hover:bg-[#f4faf9] hover:shadow-md"
            >
              Enter SAATH
              <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-[3px]" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────── */}
      <footer className="relative z-20 mx-auto max-w-7xl border-t border-[#c8d3d0]/60 px-6 pb-12 pt-7 sm:px-10">
        <div className="flex items-center justify-center">
          <div className="flex items-center gap-2">
            <ShieldCheck size={15} className="text-[#0f766e]" />
            <span className="text-[12.5px] font-medium text-[#1c2b2e]">SAATH · Support After Trauma & Healing</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
