import Link from "next/link";
import { SaathLogo } from "@/components/SaathLogo";
import {
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  Lock,
  EyeOff,
  Scale,
  HeartHandshake,
  FileCheck2,
  Sparkles,
  PhoneCall,
  KeyRound,
  CheckCircle2,
  Users2,
  AlertCircle,
  HelpCircle,
} from "lucide-react";

const GUARANTEES = [
  {
    icon: Lock,
    title: "1. Radical Consent & Zero Surveillance",
    desc: "You have complete autonomy. You choose when to check in, what details to share, and who can view your notes. There is zero algorithmic profiling and no hidden telemetry tracking.",
    badge: "Privacy Guarantee",
  },
  {
    icon: EyeOff,
    title: "2. Cryptographic Anonymity & Data Isolation",
    desc: "Personal identification details and clinical check-in logs are stored in strictly isolated silos with military-grade encryption. No unauthenticated third-party can connect your grievance identity to your check-in history.",
    badge: "Data Security",
  },
  {
    icon: Scale,
    title: "3. Direct Linkage to PoA Statutory Rights",
    desc: "Under the Scheduled Castes and Scheduled Tribes (Prevention of Atrocities) Act, survivors are entitled to immediate relief, travel allowances, and rehabilitation. SAATH provides transparent tracking of every stage.",
    badge: "Legal Protection",
  },
  {
    icon: HeartHandshake,
    title: "4. Compassionate, Trauma-Informed Protocol",
    desc: "All connected counsellors undergo specialized trauma-informed sensitization. They listen without judgment, respect boundaries, and follow up only with your explicit permission.",
    badge: "Clinical Standard",
  },
];

const FAQS = [
  {
    q: "Is it mandatory to register a police case (FIR) to use SAATH?",
    a: "No. Anyone seeking emotional support, grounding exercises, or general welfare information can access the survivor space freely without linking a legal case.",
  },
  {
    q: "Who can see what I write in my check-ins?",
    a: "Only your assigned district welfare counsellor has authorized read access to assist with follow-ups. State and district administrative officers only see aggregated, anonymized resolution statistics.",
  },
  {
    q: "Can I delete or pause my participation at any time?",
    a: "Yes. In your profile settings, you can revoke access, pause counsellor reminders, or request complete redaction of voluntary check-in notes.",
  },
];

export default function AboutPage() {
  return (
    <div className="relative min-h-screen bg-[#faf8f5] text-[#172326] selection:bg-[#dcebdd] selection:text-[#0f766e]">
      {/* Background Ambience */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute top-[-10%] right-[10%] h-[500px] w-[600px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(220,235,221,0.5),transparent_70%)] blur-3xl" />
        <div className="absolute bottom-[20%] left-[-5%] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle_at_center,rgba(232,154,120,0.1),transparent_70%)] blur-3xl" />
      </div>

      {/* Navigation */}
      <header className="relative z-30 mx-auto max-w-6xl px-5 pt-7 sm:px-8">
        <nav className="flex items-center justify-between border-b border-[#c8d3d0]/60 pb-5">
          <Link href="/landing" className="flex items-center gap-3 group">
            <SaathLogo className="h-9 w-auto transition-transform duration-200 group-hover:scale-105" size={38} />
            <span className="font-display text-3xl font-bold tracking-tight text-[#0f766e]">
              SAATH
            </span>
            <span className="hidden h-4 w-px bg-[#c8d3d0] sm:inline" />
            <span className="hidden text-[11px] font-semibold tracking-wide text-[#61706d] sm:inline">
              You Don't Have to Walk Alone
            </span>
          </Link>

          <div className="flex items-center gap-4">
            <Link
              href="/landing"
              className="inline-flex items-center gap-1.5 rounded-full border border-[#c8d3d0] bg-white px-4 py-2 text-xs font-bold text-[#172326] hover:border-[#0f766e] hover:text-[#0f766e] transition-all shadow-xs"
            >
              <ArrowLeft size={14} /> Back to Home
            </Link>
            <Link
              href="/welcome"
              className="rounded-full bg-[#0f766e] px-5 py-2 text-xs font-bold text-white hover:bg-[#0c625c] transition-all shadow-xs"
            >
              Enter Sanctuary
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero Header */}
      <section className="relative z-20 mx-auto max-w-5xl px-5 pt-14 pb-16 text-center sm:pt-20 sm:pb-24">
        

        <h1 className="mx-auto mt-6 max-w-4xl font-display text-4xl sm:text-6xl font-semibold tracking-tight text-[#172326] leading-[1.1]">
          Built from the ground up to <br />
          <span className="font-editorial italic font-normal text-[#0f766e]">
            protect your dignity, privacy & rights.
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-base sm:text-lg leading-relaxed text-[#46565a]">
          Traditional grievance portals track case numbers. SAATH stays with the human being. Here is exactly how we ensure you are safe, supported, and always in control.
        </p>
      </section>

      {/* 4 Core Protection Pillars */}
      <section className="relative z-20 mx-auto max-w-6xl px-5 py-6">
        <div className="grid gap-6 md:grid-cols-2">
          {GUARANTEES.map(({ icon: Icon, title, desc, badge }) => (
            <div
              key={title}
              className="flex flex-col justify-between rounded-3xl border border-[#c8d3d0]/80 bg-white p-8 shadow-sm transition-all hover:border-[#0f766e]/50 hover:shadow-md"
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#dcebdd] text-[#0f766e]">
                    <Icon size={22} />
                  </div>
                  <span className="rounded-full bg-[#f4f6ec] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#0f766e]">
                    {badge}
                  </span>
                </div>

                <h3 className="mt-6 font-display text-2xl font-bold text-[#172326]">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[#46565a]">{desc}</p>
              </div>

              <div className="mt-8 flex items-center gap-2 pt-4 border-t border-[#c8d3d0]/40 text-xs font-semibold text-[#0f766e]">
                <CheckCircle2 size={14} />
                <span>Audited for constitutional & statutory compliance</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Statutory PoA Entitlements Overview */}
      <section className="relative z-20 mx-auto max-w-6xl px-5 py-12">
        <div className="rounded-3xl border border-[#c8d3d0]/80 bg-[#172e29] p-8 text-white shadow-xl sm:p-12 md:p-14">
          <div className="max-w-3xl">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#7faf86]">
              STATUTORY ENTITLEMENTS UNDER THE POA ACT
            </span>
            <h2 className="mt-2 font-display text-3xl sm:text-4xl font-bold text-white">
              Rights Guaranteed by Law
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-white/80">
              The Scheduled Castes and the Scheduled Tribes (Prevention of Atrocities) Act 1989 (and 2016 Amendment) outlines comprehensive socio-economic rehabilitation beyond legal prosecution:
            </p>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            <div className="rounded-2xl bg-white/5 p-6 border border-white/10">
              <span className="font-editorial text-2xl italic text-[#7faf86]">01</span>
              <h4 className="mt-3 font-display text-lg font-bold text-white">Immediate Relief (Annexure I)</h4>
              <p className="mt-2 text-xs leading-relaxed text-white/70">
                Statutory financial relief deposited directly into victim bank accounts within 7 days of FIR registration.
              </p>
            </div>

            <div className="rounded-2xl bg-white/5 p-6 border border-white/10">
              <span className="font-editorial text-2xl italic text-[#7faf86]">02</span>
              <h4 className="mt-3 font-display text-lg font-bold text-white">Legal Aid & Protection</h4>
              <p className="mt-2 text-xs leading-relaxed text-white/70">
                Free designated Senior Public Prosecutors, witness protection, and complete travel/daily allowances for court appearances.
              </p>
            </div>

            <div className="rounded-2xl bg-white/5 p-6 border border-white/10">
              <span className="font-editorial text-2xl italic text-[#7faf86]">03</span>
              <h4 className="mt-3 font-display text-lg font-bold text-white">Rehabilitation & Livelihood</h4>
              <p className="mt-2 text-xs leading-relaxed text-white/70">
                State-mandated housing allocation, educational scholarships for children, and priority livelihood recovery support.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Frequently Asked Questions */}
      <section className="relative z-20 mx-auto max-w-5xl px-5 py-10">
        <div className="text-center">
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#0f766e]">
            COMMON QUESTIONS
          </span>
          <h2 className="mt-2 font-display text-3xl font-bold text-[#172326]">
            Clear Answers for Your Peace of Mind
          </h2>
        </div>

        <div className="mt-8 space-y-4">
          {FAQS.map(({ q, a }) => (
            <div key={q} className="rounded-2xl border border-[#c8d3d0]/80 bg-white p-6 shadow-xs">
              <h4 className="font-display text-lg font-bold text-[#172326] flex items-center gap-2">
                <HelpCircle size={18} className="text-[#0f766e] shrink-0" />
                <span>{q}</span>
              </h4>
              <p className="mt-2 text-sm leading-relaxed text-[#46565a] pl-6">{a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Connect Case CTA */}
      <section className="relative z-20 mx-auto max-w-6xl px-5 py-10 mb-10">
        <div className="flex flex-col items-center justify-between gap-6 rounded-3xl border border-[#c8d3d0] bg-[#dcebdd]/50 p-8 text-center sm:flex-row sm:text-left">
          <div>
            <h3 className="font-display text-2xl font-bold text-[#172326]">
              Have a registered case number?
            </h3>
            <p className="mt-1 text-sm text-[#46565a]">
              Link your case securely to track compensation timelines and access your assigned district counsellor.
            </p>
          </div>
          <Link
            href="/connect-case"
            className="shrink-0 inline-flex items-center gap-2 rounded-2xl bg-[#0f766e] px-7 py-3.5 text-sm font-bold text-white shadow-md hover:bg-[#0c625c] transition-all"
          >
            <span>Connect Registered Case</span>
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-20 mx-auto max-w-6xl border-t border-[#c8d3d0]/80 px-5 pt-8 pb-14 text-xs text-[#61706d]">
        <div className="flex flex-col items-center justify-between gap-5 md:flex-row">
          <div className="flex items-center gap-2.5">
            <ShieldCheck size={18} className="text-[#0f766e]" />
            <span className="font-medium text-[#172326]">
              SAATH • Ministry of Social Justice and Empowerment Initiative
            </span>
          </div>

          <div className="flex items-center gap-6 font-semibold">
            <Link href="/landing" className="hover:text-[#0f766e] transition-colors">
              Home
            </Link>
            <Link href="/welcome" className="hover:text-[#0f766e] transition-colors">
              Survivor Space
            </Link>
            <Link href="/staff-login" className="hover:text-[#0f766e] transition-colors">
              Staff Portal
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}