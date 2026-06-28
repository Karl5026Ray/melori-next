import Image from "next/image";

export default function HomePage() {
  return (
    <section className="relative overflow-hidden">
      <div className="hero-glow absolute inset-0 -z-10" aria-hidden />
      <div className="max-w-5xl mx-auto px-6 py-24 flex flex-col items-center text-center">
        <Image
          src="/logo/logo.png"
          alt="MELORI Music logo"
          width={120}
          height={120}
          priority
          className="mb-8"
        />
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight">
          MELORI MUSIC
        </h1>
        <p className="mt-4 text-lg md:text-xl text-text-secondary">
          Stream freely. Support directly. Create endlessly.
        </p>
        <div className="mt-10 flex gap-4">
          <a
            href="/music"
            className="px-6 py-3 rounded-full font-semibold bg-brand-primary hover:bg-brand-primary-dark transition-colors text-white"
          >
            Browse Music
          </a>
          <a
            href="/artists"
            className="px-6 py-3 rounded-full font-semibold border border-brand-border hover:border-brand-primary transition-colors"
          >
            Artists
          </a>
        </div>
      </div>
    </section>
  );
}
