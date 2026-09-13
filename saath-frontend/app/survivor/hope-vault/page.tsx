"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookHeart,
  Camera,
  FileText,
  ImagePlus,
  Mic,
  MessageCircleHeart,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { hopeVaultService } from "@/services/hope-vault";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
 
// Tab definitions for the history section below the "Add" buttons.
// Each tab maps to one item "type" saved in the vault.
const TABS = [
  { key: "all", label: "All", icon: BookHeart },
  { key: "photo", label: "Photos", icon: Camera },
  { key: "memory", label: "Memories", icon: Mic },
  { key: "message", label: "Messages", icon: FileText },
  { key: "achievement", label: "Achievements", icon: Sparkles },
] as const;
 
function formatDate(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
 
export default function HopeVaultPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["key"]>("all");
  const [modal, setModal] = useState<{ type: string; isOpen: boolean }>({ type: "", isOpen: false });
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const STORAGE_KEY = "saath_hope_vault_items";
 
  // Single source of truth for persisting the vault's history to localStorage,
  // so every mutation (add / delete / upload) saves the same way.
  function persist(next: any[]) {
    setItems(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage full or unavailable — vault still works in-memory for this session
      }
    }
  }
 
  useEffect(() => {
    // 1. Immediately hydrate from localStorage so it never gets stuck on "Loading..."
    if (typeof window !== "undefined") {
      try {
        const cached = window.localStorage.getItem(STORAGE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setItems(parsed);
            setLoading(false);
          }
        }
      } catch {
        // ignore parse error
      }
    }
 
    // 2. Fetch from backend with timeout/catch so loading always terminates
    let cancelled = false;
    hopeVaultService
      .getItems()
      .then((data: any) => {
        if (cancelled) return;
        if (Array.isArray(data)) {
          persist(data);
        }
      })
      .catch((e) => {
        console.warn("Hope vault fetch failed, using local vault:", e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
 
    return () => {
      cancelled = true;
    };
  }, []);
 
  async function handleSave() {
    if (!title.trim() || !content.trim()) {
      setError("Title and content are required.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const newItem = await hopeVaultService.createItem({ type: modal.type, title, content });
      persist([...items, { created_at: new Date().toISOString(), ...newItem }]);
      setModal({ type: "", isOpen: false });
      setTitle("");
      setContent("");
    } catch (e) {
      // Fallback: save locally so survivor's vault still works even if the backend call fails
      const fallbackItem = { id: crypto.randomUUID(), type: modal.type, title, content, created_at: new Date().toISOString() };
      persist([...items, fallbackItem]);
      setModal({ type: "", isOpen: false });
      setTitle("");
      setContent("");
    } finally {
      setSubmitting(false);
    }
  }
 
  async function deleteItem(id: string) {
    try {
      await hopeVaultService.deleteItem(id);
    } catch {
      // ignore network failure, remove locally
    }
    persist(items.filter((i) => i.id !== id));
  }
 
  async function addItem(type: string, file?: File) {
    setSubmitting(true);
    setError("");
    try {
      let newItem;
      if (type === "photo" && file) {
        newItem = await hopeVaultService.uploadPhoto(file, "Photo");
        persist([...items, { created_at: new Date().toISOString(), ...newItem }]);
      }
    } catch (e) {
      setError("Failed to save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }
 
  const filteredItems = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const ta = new Date(a.created_at ?? 0).getTime();
      const tb = new Date(b.created_at ?? 0).getTime();
      return tb - ta;
    });
    if (activeTab === "all") return sorted;
    return sorted.filter((i) => i.type === activeTab);
  }, [items, activeTab]);
 
  const countFor = (key: string) => (key === "all" ? items.length : items.filter((i) => i.type === key).length);
 
  return (
    <div className="px-5 pb-10 md:px-10 xl:px-14">
      <Link href="/survivor/my-space" className="inline-flex items-center gap-2 text-sm font-semibold text-[#75857f]">
        <ArrowLeft size={16} /> My space
      </Link>
 
      <div className="relative overflow-hidden rounded-4xl bg-[#fff0e5] p-8 md:p-12 mt-6">
        <div className="absolute -right-12 -top-16 h-56 w-56 rounded-full bg-[#f5c4a7]/35 blur-2xl" />
        <div className="relative max-w-2xl">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/80 text-[#b56e4e]"><BookHeart size={23} /></span>
          <h1 className="mt-7 font-display text-5xl leading-none text-[#4a352d] md:text-6xl">Your Hope Vault</h1>
          <p className="mt-5 text-lg leading-relaxed text-[#7a5c4e]">Keep the things that remind you what matters. The little things count.</p>
        </div>
      </div>
 
      <div className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-4">
        <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => e.target.files?.[0] && addItem('photo', e.target.files[0])} />
        <button onClick={() => fileInputRef.current?.click()} className="flex min-h-28 flex-col items-center justify-center gap-3 rounded-[22px] border border-[#e9d5ca] bg-white/80 text-sm font-bold text-[#6b4b3d] hover:-translate-y-0.5 hover:bg-white"><ImagePlus size={20} className="text-[#c77d5c]" />Add Photo</button>
        <button onClick={() => setModal({ type: "memory", isOpen: true })} className="flex min-h-28 flex-col items-center justify-center gap-3 rounded-[22px] border border-[#e9d5ca] bg-white/80 text-sm font-bold text-[#6b4b3d] hover:-translate-y-0.5 hover:bg-white"><BookHeart size={20} className="text-[#c77d5c]" />Add Memory</button>
        <button onClick={() => setModal({ type: "message", isOpen: true })} className="flex min-h-28 flex-col items-center justify-center gap-3 rounded-[22px] border border-[#e9d5ca] bg-white/80 text-sm font-bold text-[#6b4b3d] hover:-translate-y-0.5 hover:bg-white"><MessageCircleHeart size={20} className="text-[#c77d5c]" />Add Message</button>
        <button onClick={() => setModal({ type: "achievement", isOpen: true })} className="flex min-h-28 flex-col items-center justify-center gap-3 rounded-[22px] border border-[#e9d5ca] bg-white/80 text-sm font-bold text-[#6b4b3d] hover:-translate-y-0.5 hover:bg-white"><Sparkles size={20} className="text-[#c77d5c]" />Add Achievement</button>
      </div>
 
      {modal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold capitalize">Add {modal.type}</h2>
              <button onClick={() => setModal({ type: "", isOpen: false })}><X size={20} /></button>
            </div>
            <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="mb-3" />
            <textarea placeholder="Content" value={content} onChange={(e) => setContent(e.target.value)} className="w-full rounded-xl border border-border-color p-3 text-sm mb-3" rows={4} />
            {error && <p className="text-sm text-warm-peach mb-3">{error}</p>}
            <Button onClick={handleSave} disabled={submitting} className="w-full">{submitting ? "Saving..." : "Save"}</Button>
          </div>
        </div>
      )}
 
      {/* ── Hope Vault Tapes — history section ─────────────────────── */}
      <div className="mt-10 rounded-[26px] border border-[#e9d5ca] bg-[#fffaf5] p-6 md:p-8">
        <p className="eyebrow text-[#b56e4e]">Hope Vault Tapes</p>
        <p className="mt-1 text-sm leading-relaxed text-[#856f64]">
          Everything you&apos;ve filed in your Hope Vault, sorted so you can read and look back on it.
        </p>
 
        {/* Tab pills */}
        <div className="mt-5 flex flex-wrap gap-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold transition-all ${
                  active
                    ? "bg-[#c77d5c] text-white shadow-sm"
                    : "border border-[#e9d5ca] bg-white/80 text-[#6b4b3d] hover:bg-white"
                }`}
              >
                <Icon size={14} />
                {t.label}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    active ? "bg-white/25 text-white" : "bg-[#f0ddd0] text-[#8a6a58]"
                  }`}
                >
                  {countFor(t.key)}
                </span>
              </button>
            );
          })}
        </div>
 
        {/* History content */}
        <div className="mt-6">
          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-40 animate-pulse rounded-2xl bg-[#f0e2d6]" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-[#ddbbaa] bg-white/60 p-10 text-center">
              <h2 className="font-display text-2xl text-[#513b31]">The little things matter.</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[#856f64]">
                Your Hope Vault is a gentle place for memories, messages, and moments. Add your first one above.
              </p>
            </div>
          ) : filteredItems.length === 0 ? (
            <p className="rounded-2xl bg-white/60 p-6 text-center text-sm text-[#8a6a58]">
              Nothing filed under {TABS.find((t) => t.key === activeTab)?.label.toLowerCase()} yet.
            </p>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {filteredItems.map((item) =>
                item.type === "photo" ? (
                  <PhotoTape key={item.id} item={item} onDelete={() => deleteItem(item.id)} />
                ) : (
                  <ScrapTape key={item.id} item={item} onDelete={() => deleteItem(item.id)} />
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
 
// ── Polaroid-style card for photo entries ──────────────────────────
function PhotoTape({ item, onDelete }: { item: any; onDelete: () => void }) {
  return (
    <div className="group relative mx-auto w-full max-w-[280px] rounded-lg bg-white p-3 pb-5 shadow-[0_10px_30px_rgba(74,53,45,0.12)] transition-transform hover:-translate-y-1">
      <button
        onClick={onDelete}
        className="absolute right-2 top-2 z-10 rounded-full bg-black/40 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
        title="Remove item"
      >
        <Trash2 size={14} />
      </button>
      <div className="aspect-square w-full overflow-hidden rounded-sm bg-[#f0e2d6]">
        {item.image_url ? (
          <img src={item.image_url} alt={item.title ?? "Photo"} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[#c77d5c]">
            <Camera size={28} />
          </div>
        )}
      </div>
      <p className="mt-3 text-center font-display text-lg text-[#4a352d]">{formatDate(item.created_at)}</p>
    </div>
  );
}
 
// ── Text-scrap card for memory / message / achievement entries ─────
function ScrapTape({ item, onDelete }: { item: any; onDelete: () => void }) {
  const iconFor: Record<string, any> = { memory: BookHeart, message: MessageCircleHeart, achievement: Sparkles };
  const Icon = iconFor[item.type] ?? FileText;
  return (
    <div className="group relative rounded-2xl border border-[#e9d5ca] bg-white/90 p-5 transition-all hover:-translate-y-0.5 hover:shadow-md">
      <button
        onClick={onDelete}
        className="absolute right-3 top-3 rounded-lg p-1.5 text-[#c77d5c] opacity-0 transition-opacity hover:bg-[#fff0e5] group-hover:opacity-100"
        title="Remove item"
      >
        <Trash2 size={16} />
      </button>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fff0e5] text-[#b56e4e]">
        <Icon size={16} />
      </span>
      <h3 className="mt-3 pr-6 font-bold text-[#4a352d]">{item.title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-[#7a5c4e]">{item.content}</p>
      {item.created_at && <p className="mt-3 text-xs font-semibold text-[#b09084]">{formatDate(item.created_at)}</p>}
    </div>
  );
}
