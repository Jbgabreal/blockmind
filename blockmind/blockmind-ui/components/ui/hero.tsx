"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { renderCanvas } from "@/components/ui/canvas";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight, Zap, Code } from "lucide-react";

export function Hero() {
  const router = useRouter();

  useEffect(() => {
    renderCanvas();
  }, []);

  return (
    <section id="home" className="relative">
      <div className="animation-delay-8 animate-fadeIn mt-8 flex flex-col items-center justify-center px-4 text-center md:mt-12">
        <div className="mb-10">
          <div className="px-2">
            <div className="relative mx-auto h-full max-w-7xl border border-cyan-500/20 bg-black/20 backdrop-blur-xl p-6 rounded-3xl [mask-image:radial-gradient(800rem_96rem_at_center,white,transparent)] md:px-12 md:py-20 hover:border-cyan-500/30 transition-all duration-500">
              {/* Corner accents */}
              <Zap
                strokeWidth={3}
                className="absolute -left-5 -top-5 h-10 w-10 text-cyan-400 animate-pulse"
              />
              <Code
                strokeWidth={3}
                className="absolute -bottom-5 -left-5 h-10 w-10 text-blue-400 animate-pulse"
                style={{ animationDelay: "0.5s" }}
              />
              <Sparkles
                strokeWidth={3}
                className="absolute -right-5 -top-5 h-10 w-10 text-purple-400 animate-pulse"
                style={{ animationDelay: "1s" }}
              />
              <ArrowRight
                strokeWidth={3}
                className="absolute -bottom-5 -right-5 h-10 w-10 text-pink-400 animate-pulse"
                style={{ animationDelay: "1.5s" }}
              />

              <h1 className="flex select-none flex-col px-3 py-2 text-center text-5xl font-extrabold leading-tight tracking-tight md:flex-col md:text-7xl lg:flex-row lg:text-8xl">
                <span className="bg-gradient-to-r from-white via-cyan-200 to-white bg-clip-text text-transparent">
                  Build something with{" "}
                </span>
                <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent mt-2 lg:mt-0 lg:ml-4">
                  Blockmind
                </span>
              </h1>
              <div className="flex items-center justify-center gap-2 mt-6">
                <span className="relative flex h-3 w-3 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
                </span>
                <p className="text-sm font-semibold text-green-400">Ready to Generate</p>
              </div>
            </div>
          </div>
          <h2 className="mt-10 text-2xl md:text-3xl text-gray-200 font-semibold">
            Turn your ideas into{" "}
            <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent font-bold">
              production-ready code
            </span>
          </h2>
          <p className="mx-auto mb-12 mt-4 max-w-2xl px-6 text-base text-gray-400 sm:px-6 md:max-w-4xl md:px-20 lg:text-lg leading-relaxed">
            Powered by Claude's advanced AI capabilities. Build modern web applications
            in minutes, not hours. No coding experience required.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Button
              variant="default"
              size="lg"
              onClick={() => router.push("/generate?newProject=true")}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-600 hover:to-blue-700 shadow-lg shadow-cyan-500/30 hover:shadow-cyan-500/50 hover:scale-105 transition-all duration-200 text-base font-semibold px-8 py-6 group"
            >
              Start Building
              <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                const promptSection = document.querySelector('textarea');
                promptSection?.focus();
                promptSection?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              className="border-gray-700 text-gray-200 hover:bg-white/5 hover:text-white hover:border-gray-600 transition-all duration-200 text-base font-semibold px-8 py-6 backdrop-blur-sm"
            >
              See Examples
            </Button>
          </div>
        </div>
      </div>
      <canvas
        className="pointer-events-none absolute inset-0 mx-auto opacity-60"
        id="canvas"
      ></canvas>
    </section>
  );
}

