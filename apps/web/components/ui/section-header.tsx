"use client";

export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
      {description && <p className="mt-2 text-sm text-slate-400">{description}</p>}
    </div>
  );
}
