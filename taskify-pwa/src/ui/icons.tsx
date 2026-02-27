import React from "react";

export function VerifiedBadgeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l.967 2.329a1.125 1.125 0 0 0 1.304.674l2.457-.624c1.119-.285 2.114.71 1.829 1.829l-.624 2.457a1.125 1.125 0 0 0 .674 1.304l2.329.967c1.077.448 1.077 1.976 0 2.424l-2.329.967a1.125 1.125 0 0 0-.674 1.304l.624 2.457c.285 1.119-.71 2.114-1.829 1.829l-2.457-.624a1.125 1.125 0 0 0-1.304.674l-.967 2.329c-.448 1.077-1.976 1.077-2.424 0l-.967-2.329a1.125 1.125 0 0 0-1.304-.674l-2.457.624c-1.119.285-2.114-.71-1.829-1.829l.624-2.457a1.125 1.125 0 0 0-.674-1.304l-2.329-.967c-1.077-.448-1.077-1.976 0-2.424l2.329-.967a1.125 1.125 0 0 0 .674-1.304l-.624-2.457c-.285-1.119.71-2.114 1.829-1.829l2.457.624a1.125 1.125 0 0 0 1.304-.674l.967-2.329Z"
      />
      <path
        d="m9.4 12.75 1.9 1.9 3.85-3.85"
        fill="none"
        stroke="var(--surface-base)"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ShareBoardIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
    </svg>
  );
}
