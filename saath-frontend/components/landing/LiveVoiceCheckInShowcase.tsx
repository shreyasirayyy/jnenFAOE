"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Mic,
  Check,
  Lock,
  Sparkles,
  ShieldCheck,
  Moon,
  Heart,
  Volume2,
  X,
} from "lucide-react";

interface LiveVoiceCheckInShowcaseProps {
  id?: string;
}

export function LiveVoiceCheckInShowcase({ id = "voice-feature" }: LiveVoiceCheckInShowcaseProps) {
  // Animation state (runs once, stays completed until page reload):
  // step 0: Ready to listen (mic idle)
  // step 1: Listening (mic active, audio ripples, live transcript "Hello. I am scared")
  // step 2: Processing (analyzing wellbeing signals)
  // step 3: Complete (Sent to Assigned Counsellor with signals breakdown)
  const [step, setStep] = useState<number>(0);
  const [liveTranscript, setLiveTranscript] = useState<string>("");
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const sectionRef = useRef<HTMLElement | null>(null);

  const fullText = "Hello. I am scared";

  // Scroll detection via IntersectionObserver
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!("IntersectionObserver" in window)) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -60px 0px" }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Main animated sequence controller
  useEffect(() => {
    if (!isVisible) return;

    let timer: ReturnType<typeof setTimeout>;

    if (step === 0) {
      setLiveTranscript("");
      // Hold ready state for 1.2s then simulate user speaking
      timer = setTimeout(() => {
        setStep(1);
      }, 1200);
    } else if (step === 1) {
      // Live speech typing simulation: "Hello. I am scared"
      let charIndex = 0;
      const interval = setInterval(() => {
        charIndex += 1;
        setLiveTranscript(fullText.slice(0, charIndex));
        if (charIndex >= fullText.length) {
          clearInterval(interval);
          // Brief pause after finishing speech before processing
          timer = setTimeout(() => {
            setStep(2);
          }, 45);
        }
      }, 70);

      return () => {
        clearInterval(interval);
        clearTimeout(timer);
      };
    } else if (step === 2) {
      // Quick analyzing state (~350ms) then immediately show sent to counsellor
      timer = setTimeout(() => {
        setStep(3);
      }, 350);
    }
    // step === 3: stays permanently on the "Sent to counsellor" state

    return () => clearTimeout(timer);
  }, [step, isVisible]);

  return (
    <section
      ref={sectionRef}
      id={id}
      className="relative z-20 mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8 lg:py-10 scroll-mt-[65px] min-h-[calc(100vh-65px)] flex flex-col justify-center"
    >
      {/* Ambient background lighting */}
      <div className="pointer-events-none absolute -right-20 top-1/2 -translate-y-1/2 h-80 w-80 rounded-full bg-[#dcebdd]/30 blur-3xl" />
      <div className="pointer-events-none absolute -left-20 top-1/3 h-80 w-80 rounded-full bg-[#e89a78]/5 blur-3xl" />

      <div className="relative grid items-center gap-8 lg:grid-cols-2 lg:gap-14 my-auto">
        {/* ── LEFT HALF: Live Application of Voice Check-In (Compact Length-wise) ── */}
        <div
          className={`w-full transition-all duration-700 ease-out order-2 lg:order-1 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          {/* Outer Browser Mockup Window */}
          <div className="overflow-hidden rounded-2xl border border-[#c8d3d0]/85 bg-white shadow-lg shadow-[#0f766e]/6 transition-all duration-300">
            {/* 1. Browser Chrome Header Bar */}
            <div className="flex items-center justify-between border-b border-[#c8d3d0]/60 bg-[#f4f6ec]/80 px-4 py-2 sm:px-4.5">
              <div className="flex items-center gap-3">
                {/* Window Dots */}
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-[#ef4444]/75" />
                  <div className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]/75" />
                  <div className="h-2.5 w-2.5 rounded-full bg-[#10b981]/75" />
                </div>

                {/* Active Tab */}
                
              </div>

              {/* Status Pill */}
              <div className="flex items-center gap-2">
                
              </div>
            </div>

            {/* 2. In-App Header */}
            <div className="flex items-center justify-between border-b border-[#c8d3d0]/40 bg-white px-4 py-2 sm:px-4.5">
              <div className="flex items-center gap-2.5">
                
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[12.5px] font-semibold text-[#1c2b2e]">Voice Check-in</p>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Live Voice Interactive Body (Compact Length-wise) */}
            <div className="min-h-[260px] sm:min-h-[280px] max-h-[300px] bg-[#fafbf9] p-4 flex flex-col justify-center items-center text-center">
              {/* STATE 0: Ready */}
              {step === 0 && (
                <div className="space-y-3 animate-in fade-in duration-300">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#dcebdd]/50 shadow-[0_0_0_12px_rgba(220,235,221,.4)]">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0f766e] text-white shadow-md transition-transform hover:scale-105">
                      <Mic size={22} />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold text-[#1c2b2e]">Ready to listen</h3>
                    <p className="mt-1 text-[12px] text-[#61706d] max-w-xs">
                      Tap the microphone when you’re ready to speak.
                    </p>
                  </div>
                </div>
              )}

              {/* STATE 1: Listening */}
              {step === 1 && (
                <div className="w-full space-y-3 animate-in fade-in duration-300">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#e89a78]/20 shadow-[0_0_0_12px_rgba(232,154,120,.25)]">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e89a78] text-white shadow-md animate-pulse">
                      <Mic size={22} className="animate-bounce" />
                    </div>
                  </div>

                  {/* Audio wave pulse bars */}
                  <div className="flex items-center justify-center gap-1">
                    <span className="h-3 w-1 rounded-full bg-[#0f766e] animate-pulse [animation-delay:-0.4s]" />
                    <span className="h-5 w-1 rounded-full bg-[#0f766e] animate-pulse [animation-delay:-0.2s]" />
                    <span className="h-6 w-1 rounded-full bg-[#0f766e] animate-pulse" />
                    <span className="h-4 w-1 rounded-full bg-[#0f766e] animate-pulse [animation-delay:-0.1s]" />
                    <span className="h-2 w-1 rounded-full bg-[#0f766e] animate-pulse [animation-delay:-0.3s]" />
                  </div>

                  {/* Real-time transcript box */}
                  <div className="mx-auto max-w-xs rounded-xl border border-[#c8d3d0]/60 bg-white p-2.5 text-left shadow-2xs">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#61706d] flex items-center gap-1">
                       Heard so far:
                    </p>
                    <p className="mt-1 text-[13px] font-medium text-[#1c2b2e] italic">
                      &ldquo;{liveTranscript}&rdquo;
                      <span className="inline-block h-3.5 w-0.5 bg-[#0f766e] animate-pulse ml-0.5" />
                    </p>
                  </div>
                </div>
              )}

              {/* STATE 2: Processing */}
              {step === 2 && (
                <div className="space-y-3 animate-in fade-in duration-300">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#dcebdd]/50">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0f766e] text-white shadow-md">
                      <Sparkles size={22} className="animate-spin" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold text-[#1c2b2e]">Analyzing voice signals</h3>
                    <p className="mt-1 text-[12px] text-[#61706d]">
                      Extracting acoustic features and emotional safety indicators...
                    </p>
                  </div>
                </div>
              )}

              {/* STATE 3: Sent to Counsellor (Complete) */}
              {step >= 3 && (
                <div className="w-full space-y-2.5 animate-in fade-in slide-in-from-bottom-2 duration-400">
                  {/* Sent badge */}
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-[#dfeee4] px-3 py-1 text-[12px] font-semibold text-[#2e8b57]">
                    <Check size={14} className="stroke-[2.5]" />
                    <span>Sent to Assigned Counsellor</span>
                  </div>

                  {/* Transcript quote */}
                  <div className="mx-auto max-w-sm rounded-xl bg-white border border-[#c8d3d0]/60 p-2.5 text-left shadow-2xs">
                    <p className="text-[10px] uppercase font-semibold text-[#87938f] tracking-wide">Transcript Recorded</p>
                    <p className="mt-0.5 text-[13px] font-semibold text-[#1c2b2e] italic">
                      &ldquo;Hello. I am scared&rdquo;
                    </p>
                  </div>

                  {/* Wellbeing Signals Pill Grid */}
                  <div className="grid grid-cols-2 gap-1.5 max-w-sm mx-auto text-left text-[11px]">
                    <div className="flex items-center gap-1.5 rounded-lg bg-white border border-[#c8d3d0]/50 p-1.5">
                      <span><strong>Distress:</strong> Elevated (review needed)</span>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-lg bg-white border border-[#c8d3d0]/50 p-1.5">
                      <span><strong>Counsellor:</strong> Alert flagged</span>
                    </div>
                  </div>

                  <p className="text-[11px] text-[#61706d] max-w-xs mx-auto">
                    Your voice check-in and wellbeing signals have been securely delivered to your counsellor.
                  </p>
                </div>
              )}
            </div>

            {/* 4. Footer status bar */}
            <div className="border-t border-[#c8d3d0]/60 bg-white px-4 py-2 flex items-center justify-between text-[11px] text-[#87938f]">
              <div className="flex items-center gap-1.5">
                
                
              </div>
              <span className="font-medium text-[#0f766e]">
                {step >= 3 ? "Delivered ✓" : step === 1 ? "Recording..." : "Ready"}
              </span>
            </div>
          </div>
        </div>

        {/* ── RIGHT HALF: Text Presentation (Same structure as Feature 1) ── */}
        <div
          className={`w-full max-w-xl transition-all duration-700 delay-100 ease-out order-1 lg:order-2 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          {/* Main Display Heading */}
          <h2
            className="text-[2.4rem] sm:text-[3rem] lg:text-[3.6rem] font-normal leading-[1.06] tracking-tight text-[#1c2b2e]"
            style={{ fontFamily: '"Instrument Serif", "DM Serif Display", Georgia, serif' }}
          >
            Speak in your <span className="italic text-[#0f766e]">own voice.</span>
          </h2>

          {/* Description */}
          <p className="mt-4 text-[15.5px] sm:text-[17px] leading-[1.6] text-[#46565a]">
            Share what is on your mind without having to type. Your voice check-in safely captures wellbeing signals and keeps your counsellor updated in real time.
          </p>

          {/* Green Button */}
          <div className="mt-7">
            <Link
              href="/welcome"
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-[#0f766e] px-6 py-2.5 sm:px-7 sm:py-3 text-[13.5px] sm:text-[14px] font-semibold text-white shadow-sm transition-all duration-200 hover:bg-[#0c6460] hover:shadow-md"
            >
              <span>Try voice check-in</span>
              <ArrowRight size={15} className="transition-transform duration-200 group-hover:translate-x-[3px]" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
