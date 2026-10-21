import React, { useEffect, useRef } from 'react';

/**
 * Screen heading that takes focus when a screen is entered, so keyboard and screen-reader users land at the new screen.
 * The very first page load does not move focus, which keeps the skip link the first stop.
 */
export function ScreenHeading({ children, id, focus = true }: { children: React.ReactNode; id?: string; focus?: boolean }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focus) ref.current?.focus(); }, [focus]);
  return <h1 ref={ref} tabIndex={-1} id={id}>{children}</h1>;
}

export function ErrorNotice({ title = 'Das hat nicht geklappt.', children }: { title?: string; children: React.ReactNode }) {
  return <div className="notice error" role="alert"><strong>{title}</strong><p>{children}</p></div>;
}

export function Spinner() { return <span className="spinner" aria-hidden="true" />; }

/** Shown in place of an input path that cannot be used right now, with a way forward. */
export function Unavailable({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <div className="unavailable"><strong>{title}</strong><p>{children}</p>{action}</div>;
}
