
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function initAnimations() {
    // Respetar las preferencias de accesibilidad
    const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    ).matches;

    if (reduceMotion) return;

    // Evitar duplicar animaciones
    const context = gsap.context(() => {
        // ----------------------------------
        // HERO
        // ----------------------------------

        const heroElements = gsap.utils.toArray<HTMLElement>(
            "[data-hero-reveal]"
        );

        if (heroElements.length) {
            gsap.fromTo(
                heroElements,
                {
                    y: 45,
                    opacity: 0,
                },
                {
                    y: 0,
                    opacity: 1,
                    duration: 1,
                    stagger: 0.12,
                    ease: "power3.out",
                    clearProps: "transform,opacity",
                }
            );
        }

        // ----------------------------------
        // SCROLL REVEAL
        // ----------------------------------

        gsap.utils
            .toArray<HTMLElement>("[data-reveal]")
            .forEach((element) => {
                gsap.fromTo(
                    element,
                    {
                        y: 40,
                        opacity: 0,
                    },
                    {
                        y: 0,
                        opacity: 1,
                        duration: 0.85,
                        ease: "power3.out",
                        clearProps: "transform,opacity",
                        scrollTrigger: {
                            trigger: element,
                            start: "top 90%",
                            once: true,
                        },
                    }
                );
            });

        // ----------------------------------
        // PROJECTS
        // ----------------------------------

        gsap.utils
            .toArray<HTMLElement>("[data-project]")
            .forEach((project) => {
                gsap.fromTo(
                    project,
                    {
                        y: 65,
                        opacity: 0,
                    },
                    {
                        y: 0,
                        opacity: 1,
                        duration: 1,
                        ease: "power3.out",
                        clearProps: "transform,opacity",
                        scrollTrigger: {
                            trigger: project,
                            start: "top 88%",
                            once: true,
                        },
                    }
                );
            });

        // ----------------------------------
        // SUBTLE PROJECT VISUAL PARALLAX
        // ----------------------------------

        gsap.utils
            .toArray<HTMLElement>("[data-project-visual]")
            .forEach((visual) => {
                gsap.fromTo(
                    visual,
                    { yPercent: -3 },
                    {
                        yPercent: 3,
                        ease: "none",
                        scrollTrigger: {
                            trigger: visual,
                            start: "top bottom",
                            end: "bottom top",
                            scrub: 1.2,
                        },
                    }
                );
            });
    });

    return () => context.revert();
}
