"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUp,
  Mic,
  Lock,
  CheckCheck,
  X,
} from "lucide-react";

interface LiveSahayakShowcaseProps {
  id?: string;
}

export function LiveSahayakShowcase({ id = "features" }: LiveSahayakShowcaseProps) {
  // Chat animation state (runs once, stays completed until page reload):
  // step 0: Sahayak greeting visible
  // step 1: User typing in input bar
  // step 2: User message sent (pops into chat feed)
  // step 3: Sahayak typing/thinking indicator
  // step 4: Sahayak reply pops in + interactive suggestion chips (stays permanently)
  const [step, setStep] = useState<number>(0);
  const [typedInput, setTypedInput] = useState<string>("");
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  const chatFeedRef = useRef<HTMLDivElement | null>(null);

  const userQuery = "I've been feeling really overwhelmed about my court hearing this week.";

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

  // Main animated sequence controller (runs once without looping)
  useEffect(() => {
    if (!isVisible) return;

    let timer: ReturnType<typeof setTimeout>;

    if (step === 0) {
      setTypedInput("");
      // Hold initial greeting for 1.2 seconds before survivor starts typing
      timer = setTimeout(() => {
        setStep(1);
      }, 1200);
    } else if (step === 1) {
      // Simulate live typing
      let charIndex = 0;
      const interval = setInterval(() => {
        charIndex += 2;
        setTypedInput(userQuery.slice(0, charIndex));
        if (charIndex >= userQuery.length) {
          clearInterval(interval);
          timer = setTimeout(() => {
            setStep(2);
            setTypedInput("");
          }, 400);
        }
      }, 24);

      return () => {
        clearInterval(interval);
        clearTimeout(timer);
      };
    } else if (step === 2) {
      // User message sent; very brief pause before Sahayak typing indicator
      timer = setTimeout(() => {
        setStep(3);
      }, 200);
    } else if (step === 3) {
      // Sahayak responds almost immediately (~350ms)
      timer = setTimeout(() => {
        setStep(4);
      }, 350);
    }
    // step === 4: stays permanently on the completed state until page reload

    return () => clearTimeout(timer);
  }, [step, isVisible]);

  // Auto-scroll chat feed smoothly as new messages appear
  useEffect(() => {
    if (chatFeedRef.current) {
      chatFeedRef.current.scrollTo({
        top: chatFeedRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [step]);

  return (
    <section
      ref={sectionRef}
      id={id}
      className="relative z-20 mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8 lg:py-10 scroll-mt-[65px] min-h-[calc(100vh-65px)] flex flex-col justify-center"
    >
      {/* Background ambient lighting */}
      <div className="pointer-events-none absolute -left-20 top-1/2 -translate-y-1/2 h-80 w-80 rounded-full bg-[#dcebdd]/35 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-1/3 h-80 w-80 rounded-full bg-[#0f766e]/5 blur-3xl" />

      <div className="relative grid items-center gap-8 lg:grid-cols-2 lg:gap-14 my-auto">
        {/* ── LEFT COLUMN: Clean Editorial Presentation ── */}
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
            Always-there <span className="italic text-[#0f766e]">support.</span>
          </h2>

          {/* Description */}
          <p className="mt-4 text-[15.5px] sm:text-[17px] leading-[1.6] text-[#46565a]">
            Unpack what's on your mind with our empathetic AI companion, Sahayak. It helps you process daily stress and navigate mild anxiety. 
          </p>

          {/* CTA Button */}
          <div className="mt-7">
            <Link
              href="/welcome"
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-[#0f766e] px-6 py-2.5 sm:px-7 sm:py-3 text-[13.5px] sm:text-[14px] font-semibold text-white shadow-sm transition-all duration-200 hover:bg-[#0c6460] hover:shadow-md"
            >
              <span>Talk with Sahayak</span>
              <ArrowRight size={15} className="transition-transform duration-200 group-hover:translate-x-[3px]" />
            </Link>
          </div>
        </div>

        {/* ── RIGHT COLUMN: Live Application of Sahayak (Compact Right Half) ── */}
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

                {/* Active Tab (Gemini Chrome style) */}
                
              </div>

              {/* Status Pill */}
              
            </div>

            {/* 2. Sahayak In-App Header */}
            <div className="flex items-center justify-between border-b border-[#c8d3d0]/40 bg-white px-4 py-2 sm:px-4.5">
              <div className="flex items-center gap-2">
                <p className="text-[12.5px] font-semibold text-[#1c2b2e]">Sahayak</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#dcebdd]/70 px-1.5 py-0.2 text-[9.5px] font-medium text-[#0f766e]">
                </span>
              </div>
            </div>

            {/* 3. Live Chat Messages Area (Compact Length-wise) */}
            <div
              ref={chatFeedRef}
              className="min-h-[250px] sm:min-h-[270px] max-h-[290px] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] bg-[#fafbf9] p-3 sm:p-4 flex flex-col justify-between"
            >
              <div className="space-y-2.5">
                {/* ── MESSAGE 1: Sahayak asks "Hi, how can I help you?" ── */}
                <div
                  className={`flex items-start transition-all duration-500 ease-out ${
                    step >= 0 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
                  }`}
                >
                  <div className="max-w-[85%] sm:max-w-[80%]">
                    <div className="rounded-2xl rounded-tl-sm border border-[#c8d3d0]/60 bg-white px-3 py-2 text-[12.5px] sm:text-[13px] leading-relaxed text-[#172326] shadow-xs">
                      Hi, how can I help you today?
                    </div>
                    <span className="mt-0.5 block text-[10px] text-[#87938f] pl-1">Sahayak · 10:14 AM</span>
                  </div>
                </div>

                {/* ── MESSAGE 2: User responds ── */}
                {step >= 2 && (
                  <div className="flex justify-end transition-all duration-400 ease-out">
                    <div className="max-w-[88%] sm:max-w-[82%]">
                      <div className="rounded-2xl rounded-tr-sm bg-[#0f766e] px-3 py-2 text-[12.5px] sm:text-[13px] leading-relaxed text-white shadow-xs">
                        {userQuery}
                      </div>
                      <div className="mt-0.5 flex items-center justify-end gap-1 pr-1 text-[10px] text-[#87938f]">
                        <span>You · 10:15 AM</span>
                        <CheckCheck size={11} className="text-[#0f766e]" />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── SAHAYAK TYPING INDICATOR ── */}
                {step === 3 && (
                  <div className="flex items-start transition-all duration-300 ease-out">
                    <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-[#c8d3d0]/60 bg-white px-3 py-2 shadow-xs">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#0f766e] animate-bounce [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-[#0f766e] animate-bounce [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-[#0f766e] animate-bounce" />
                      <span className="ml-1 text-[10.5px] font-medium text-[#61706d]">Sahayak is listening...</span>
                    </div>
                  </div>
                )}

                {/* ── MESSAGE 3: Sahayak empathetic reply ── */}
                {step >= 4 && (
                  <div className="flex items-start transition-all duration-500 ease-out">
                    <div className="max-w-[90%] sm:max-w-[85%] space-y-2">
                      <div className="rounded-2xl rounded-tl-sm border border-[#c8d3d0]/60 bg-white px-3 py-2 text-[12.5px] sm:text-[13px] leading-relaxed text-[#172326] shadow-xs">
                        It is completely understandable to feel overwhelmed right now. You are safe here. Would you like to talk through what to expect, or try a quick calming exercise together?
                      </div>

                      {/* Interactive suggestion quick-reply chips */}
                      <span className="block text-[10px] text-[#87938f] pl-1">Sahayak · 10:16 AM</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 4. Mock Chat Input Bar */}
            <div className="border-t border-[#c8d3d0]/60 bg-white p-2.5 sm:p-3">
              <div className="flex items-center gap-2 rounded-full border border-[#c8d3d0]/80 bg-[#f9faf7] px-3 py-1 transition-all focus-within:border-[#0f766e] focus-within:ring-2 focus-within:ring-[#0f766e]/10">
                <input
                  type="text"
                  readOnly
                  value={step === 1 ? typedInput : step >= 2 ? "" : ""}
                  placeholder={step === 1 ? "" : "Share how you are feeling..."}
                  className="min-w-0 flex-1 bg-transparent py-1 text-[12.5px] sm:text-[13px] text-[#1c2b2e] outline-none placeholder-[#87938f]"
                />

                {/* Typing cursor when in step 1 */}
                {step === 1 && (
                  <span className="inline-block h-3.5 w-0.5 animate-pulse bg-[#0f766e] mr-1" />
                )}

                {/* Voice mic icon */}
                <button
                  type="button"
                  aria-label="Voice check-in"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[#61706d] transition-colors hover:bg-white hover:text-[#0f766e]"
                >
                  <Mic size={15} />
                </button>

                {/* Send Button */}
                <button
                  type="button"
                  aria-label="Send message"
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition-all ${
                    step === 1 && typedInput.length > 0
                      ? "bg-[#0f766e] text-white scale-105 shadow-xs"
                      : "bg-[#dcebdd] text-[#0f766e]"
                  }`}
                >
                  <ArrowUp size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
