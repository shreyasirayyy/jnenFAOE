"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Lock,
  Scale,
  ShieldCheck,
  MousePointer,
  X,
  FileText,
} from "lucide-react";

interface LiveCaseTrackingShowcaseProps {
  id?: string;
}

const STAGES = [
  { id: "Registered", label: "Registered", description: "Your case has been formally recorded." },
  { id: "Investigation", label: "Being looked into", description: "Authorities are actively working on your case." },
  { id: "Trial", label: "Legal proceedings", description: "Your case is moving through the court process." },
  { id: "Compensation", label: "Relief & support", description: "Financial relief and welfare entitlements are being processed." },
  { id: "Rehabilitation", label: "Rebuilding", description: "Support for your future — housing, livelihood, and wellbeing." },
];

export function LiveCaseTrackingShowcase({ id = "case-tracking-feature" }: LiveCaseTrackingShowcaseProps) {
  // Animation state (runs once, stays completed until page reload):
  // step 0: "My Case" preview card visible with cursor hovering
  // step 1: Click simulated on "View case journey" button
  // step 2: Transitions and displays the live 5-stage case journey timeline (stays permanently)
  const [step, setStep] = useState<number>(0);
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const sectionRef = useRef<HTMLElement | null>(null);

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
      // Hold initial "My Case" card for 1.4s, then simulate click
      timer = setTimeout(() => {
        setStep(1);
      }, 1400);
    } else if (step === 1) {
      // Simulate click tap duration 400ms, then reveal live timeline
      timer = setTimeout(() => {
        setStep(2);
      }, 450);
    }
    // step === 2: stays permanently in the completed timeline view

    return () => clearTimeout(timer);
  }, [step, isVisible]);

  return (
    <section
      ref={sectionRef}
      id={id}
      className="relative z-20 mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8 lg:py-10 scroll-mt-[65px] min-h-[calc(100vh-65px)] flex flex-col justify-center"
    >
      {/* Background ambient lighting */}
      <div className="pointer-events-none absolute -left-20 top-1/2 -translate-y-1/2 h-80 w-80 rounded-full bg-[#dcebdd]/35 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-1/3 h-80 w-80 rounded-full bg-[#d69e2e]/5 blur-3xl" />

      <div className="relative grid items-center gap-8 lg:grid-cols-2 lg:gap-14 my-auto">
        {/* ── LEFT HALF: Text Presentation (Same standard as Feature 1 & 2) ── */}
        <div
          className={`w-full max-w-xl transition-all duration-700 ease-out ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          {/* Main Display Heading */}
          <h2
            className="text-[2.4rem] sm:text-[3rem] lg:text-[3.6rem] font-normal leading-[1.06] tracking-tight text-[#1c2b2e]"
            style={{ fontFamily: '"Instrument Serif", "DM Serif Display", Georgia, serif' }}
          >
            Track your journey, <span className="italic text-[#0f766e]">step by step.</span>
          </h2>

          {/* Description */}
          <p className="mt-4 text-[15.5px] sm:text-[17px] leading-[1.6] text-[#46565a]">
            Never wonder what comes next. Follow your case from formal recording through court proceedings and rehabilitation, with clear explanations at every milestone.
          </p>

          {/* Green CTA Button */}
          <div className="mt-7">
            <Link
              href="/welcome"
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-[#0f766e] px-6 py-2.5 sm:px-7 sm:py-3 text-[13.5px] sm:text-[14px] font-semibold text-white shadow-sm transition-all duration-200 hover:bg-[#0c6460] hover:shadow-md"
            >
              <span>View live case tracking</span>
              <ArrowRight size={15} className="transition-transform duration-200 group-hover:translate-x-[3px]" />
            </Link>
          </div>
        </div>

        {/* ── RIGHT HALF: Live Application of Case Tracking (Compact Mockup) ── */}
        <div
          className={`w-full transition-all duration-700 delay-100 ease-out ${
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
                    <p className="text-[12.5px] font-semibold text-[#1c2b2e]">Docket: NDLS/2026/089</p>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#dcebdd]/70 px-1.5 py-0.2 text-[9.5px] font-medium text-[#0f766e]"> 
                    </span>
                  </div>
                  </div>
              </div>

              
            </div>

            {/* 3. Main Interactive Body (Compact Length-wise) */}
            <div className="min-h-[260px] sm:min-h-[280px] max-h-[300px] bg-[#fafbf9] p-4 flex flex-col justify-center">
              {/* STEP 0 & 1: "My Case" Card with simulated click */}
              {step < 2 ? (
                <div className="relative mx-auto w-full max-w-md rounded-xl border border-[#c8d3d0]/75 bg-white p-4 shadow-sm transition-all duration-300">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#d69e2e]" />
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#61706d]">
                        Case Status Overview
                      </span>
                    </div>
                    <span className="rounded-full bg-[#fef3c7] px-2 py-0.5 text-[10.5px] font-semibold text-[#b45309]">
                      Being looked into
                    </span>
                  </div>

                  <h3 className="mt-2.5 text-[14px] font-semibold text-[#1c2b2e]">
                    State vs. Incident Investigation
                  </h3>
                  <p className="mt-1 text-[12px] text-[#61706d]">
                    Assigned to Fast-Track Special Court. Authorities are actively working on preliminary filings.
                  </p>

                  <div className="mt-4 flex items-center justify-between border-t border-[#c8d3d0]/40 pt-3">
                    <span className="text-[11px] text-[#87938f]">Updated 2 days ago</span>
                    <div
                      className={`relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all ${
                        step === 1
                          ? "bg-[#0c6460] text-white scale-95 ring-2 ring-[#0f766e]/30"
                          : "bg-[#0f766e] text-white shadow-xs"
                      }`}
                    >
                      <span>View case journey</span>
                      <ArrowRight size={13} />

                      {/* Simulated clicking cursor */}
                      {step === 0 && (
                        <div className="absolute -bottom-3 -right-2 flex items-center gap-1 animate-bounce">
                          <MousePointer size={18} className="fill-[#1c2b2e] text-white drop-shadow-sm" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* STEP 2: Live Case Journey Timeline (Exactly matching the screenshot) */
                <div className="w-full rounded-xl border border-[#c8d3d0]/60 bg-white p-4 sm:p-5 shadow-2xs animate-in fade-in zoom-in-95 duration-400">
                  {/* Journey Header */}
                  <div>
                    <h3 className="text-[12px] sm:text-[12.5px] font-bold uppercase tracking-[0.1em] text-[#1c2b2e]">
                      YOUR CASE JOURNEY
                    </h3>
                    
                  </div>

                  {/* 5-Stage Timeline Bar */}
                  <div className="mt-4 flex items-start justify-between">
                    {STAGES.map((stage, i) => {
                      const isCompleted = i === 0;
                      const isCurrent = i === 1;

                      return (
                        <div key={stage.id} className={`flex ${i < STAGES.length - 1 ? "flex-1" : ""}`}>
                          <div className="flex flex-col items-center text-center w-14 sm:w-16 shrink-0">
                            {/* Circle Indicator */}
                            <div
                              className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold transition-transform ${
                                isCompleted
                                  ? "bg-[#0f766e] text-white shadow-xs"
                                  : isCurrent
                                  ? "bg-[#d69e2e] text-white ring-4 ring-[#d69e2e]/25 scale-105"
                                  : "bg-[#dcebdd]/70 text-[#61706d]"
                              }`}
                            >
                              {isCompleted ? <Check size={14} className="stroke-[2.5]" /> : i + 1}
                            </div>

                            {/* Stage Label */}
                            <p
                              className={`mt-1.5 text-[10px] sm:text-[10.5px] leading-tight ${
                                isCurrent
                                  ? "font-bold text-[#1c2b2e]"
                                  : isCompleted
                                  ? "text-[#1c2b2e] font-medium"
                                  : "text-[#87938f]"
                              }`}
                            >
                              {stage.label}
                            </p>

                            {/* "Current" badge under step 2 */}
                            {isCurrent && (
                              <span className="mt-0.5 text-[10px] font-bold text-[#d69e2e]">
                                Current
                              </span>
                            )}
                          </div>

                          {/* Connecting Line between stages */}
                          {i < STAGES.length - 1 && (
                            <div
                              className={`mt-3.5 h-[1.5px] flex-1 mx-1 ${
                                isCompleted ? "bg-[#0f766e]" : "bg-[#c8d3d0]/80"
                              }`}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Callout box at bottom (matches screenshot) */}
                  <div className="mt-4 rounded-lg bg-[#dcebdd]/45 px-3 py-2 text-[12px] text-[#46565a] leading-relaxed">
                    <strong className="font-semibold text-[#1c2b2e]">Being looked into:</strong> Authorities are actively working on your case.
                  </div>
                </div>
              )}
            </div>

            {/* 4. Footer status bar */}
            <div className="border-t border-[#c8d3d0]/60 bg-white px-4 py-2 flex items-center justify-between text-[11px] text-[#87938f]">
              <div className="flex items-center gap-1.5">
              </div>
              <span className="font-medium text-[#0f766e]">
                {step >= 2 ? "Live Timeline" : "Case Overview"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
